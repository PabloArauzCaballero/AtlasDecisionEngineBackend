import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';

/**
 * Exercises the Code -> Flow import pipeline (Fase 5) end to end against a real
 * Postgres: analyze -> preview -> reject blocking issues -> save draft -> confirm
 * (validate + compile) -> simulate the resulting artifact.
 */
describe('Code to Flow import (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const author = managementHeaders('e2e.code-import-author', ['RISK_ANALYST']);
  const qaApprover = managementHeaders('e2e.code-import-qa', ['QA_ANALYST']);
  const riskApprover = managementHeaders('e2e.code-import-risk', ['RISK_APPROVER']);
  const deployer = managementHeaders('e2e.code-import-deployer', ['PLATFORM_ADMIN']);

  const validJsSource = `// @atlas-contract
// { "contractVersion": "1",
//   "inputs": [{ "id": "age", "name": "Age", "type": "INTEGER", "required": true }],
//   "outputs": [{ "id": "riskLevel", "name": "Risk Level", "type": "STRING", "required": true }] }
return { riskLevel: variables.age >= 21 ? 'LOW' : 'HIGH' };
`;

  beforeAll(async () => {
    app = await createTestApp();

    /**
     * La salida que el contrato del código declara tiene que existir en el catálogo.
     *
     * El analizador rechaza importar código que nombra variables que nadie definió
     * (`CODE_IMPORT_VARIABLE_NOT_IN_CATALOG`), porque el grafo resultante no podría
     * resolverlas. `riskLevel` no está en el catálogo sembrado —que usa snake_case— así que
     * la crea la propia prueba, igual que crea sus artefactos. Sembrarla en
     * `variable-catalog.data.ts` metería un dato de prueba en el catálogo de referencia que
     * se mantiene en producción.
     */
    await request(server())
      .post('/v1/variables')
      .set(author)
      .send({
        variableCode: 'riskLevel',
        canonicalName: 'Nivel de riesgo',
        businessDescription: 'Salida declarada por el código importado en esta prueba.',
        dataClassification: 'INTERNAL',
        ownerTeam: 'RISK_DECISIONING',
        isSensitive: false,
        initialVersion: {
          dataType: 'STRING',
          nullable: false,
          sources: [],
          validationRules: [],
        },
      });
    // Sin `.expect(...)`: si ya existe de una corrida anterior responde 409 y da igual, lo
    // que importa es que esté antes de analizar.
  });

  afterAll(async () => {
    // Test artifacts are cleaned by the suite-wide global teardown
    // (test/e2e/support/global-teardown.ts), not per-spec.
    await app.close();
  });

  it('analyzes valid JavaScript and returns a clean preview with no blocking issues', async () => {
    const response = await request(server())
      .post('/v1/code-imports')
      .set(author)
      .send({ language: 'JAVASCRIPT', sourceCode: validJsSource })
      .expect(201);

    expect(response.body.issues).toEqual([]);
    expect(response.body.generatedGraph.nodes.map((node: { type: string }) => node.type)).toEqual([
      'START',
      'RESULT',
    ]);
    expect(response.body.generatedGraph.dependencies).toEqual([
      expect.objectContaining({ variableCode: 'age', usageType: 'INPUT' }),
      expect.objectContaining({ variableCode: 'riskLevel', usageType: 'OUTPUT_PRIMARY' }),
    ]);
  });

  it('reports line-numbered syntax, security and contract issues together', async () => {
    const badSource = `const fs = require('fs');
const x = ;
`;
    const response = await request(server())
      .post('/v1/code-imports')
      .set(author)
      .send({ language: 'JAVASCRIPT', sourceCode: badSource })
      .expect(201);

    const codes = response.body.issues.map((issue: { code: string }) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining(['JS_SYNTAX_ERROR', 'JS_REQUIRE', 'CONTRACT_MARKER_MISSING']),
    );
    expect(response.body.generatedGraph.nodes).toEqual([]);
  });

  it('rejects saving a draft when the code import still has blocking issues', async () => {
    const analyzed = await request(server())
      .post('/v1/code-imports')
      .set(author)
      .send({ language: 'JAVASCRIPT', sourceCode: 'const x = ;' })
      .expect(201);

    const artifact = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode: `E2E_CODE_IMPORT_BLOCKED_${runId}`,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E code import (blocked)',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Verifies save-draft rejects blocking issues.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);

    await request(server())
      .post(`/v1/code-imports/${analyzed.body.id}/save-draft`)
      .set(author)
      .send({ artifactVersionId: artifact.body.versions[0].id, expectedLockVersion: 1 })
      .expect(409);
  });

  it('saves a draft, writing the generated graph onto a DRAFT artifact version', async () => {
    const analyzed = await request(server())
      .post('/v1/code-imports')
      .set(author)
      .send({ language: 'JAVASCRIPT', sourceCode: validJsSource })
      .expect(201);

    const artifact = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode: `E2E_CODE_IMPORT_DRAFT_${runId}`,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E code import (draft)',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Verifies save-draft writes the generated graph.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    const versionId = artifact.body.versions[0].id;

    const saved = await request(server())
      .post(`/v1/code-imports/${analyzed.body.id}/save-draft`)
      .set(author)
      .send({ artifactVersionId: versionId, expectedLockVersion: 1 })
      .expect(201);
    expect(saved.body.updatedVersion.status).toBe('DRAFT');
    expect(saved.body.updatedVersion.lockVersion).toBe(2);

    const graph = await request(server())
      .get(`/v1/artifact-versions/${versionId}/graph`)
      .set(author)
      .expect(200);
    const nodeTypes = graph.body.nodes.map((node: { type: string }) => node.type).sort();
    expect(nodeTypes).toEqual(['RESULT', 'START']);
    const resultNode = graph.body.nodes.find((node: { type: string }) => node.type === 'RESULT');
    expect(resultNode.config.mode).toBe('SCRIPT');
    expect(resultNode.config.script.language).toBe('JAVASCRIPT');

    const fetched = await request(server())
      .get(`/v1/code-imports/${analyzed.body.id}`)
      .set(author)
      .expect(200);
    expect(fetched.body.status).toBe('DRAFT_SAVED');
  });

  it('confirms an import: validates, compiles, and the resulting artifact runs a real decision', async () => {
    const analyzed = await request(server())
      .post('/v1/code-imports')
      .set(author)
      .send({ language: 'JAVASCRIPT', sourceCode: validJsSource })
      .expect(201);

    const artifact = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode: `E2E_CODE_IMPORT_CONFIRM_${runId}`,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E code import (confirm)',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Verifies confirm validates, compiles and executes.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    const versionId = artifact.body.versions[0].id;
    const artifactCode = artifact.body.artifactCode;

    const confirmed = await request(server())
      .post(`/v1/code-imports/${analyzed.body.id}/confirm`)
      .set(author)
      .send({ artifactVersionId: versionId, expectedLockVersion: 1 })
      .expect(201);
    expect(confirmed.body.validation.valid).toBe(true);
    expect(confirmed.body.compiledArtifact.compileStatus).toBe('SUCCESS');

    if (process.env.SCRIPT_NODES_ENABLED !== 'true') {
      // The in-process script runner is disabled by default in production and in a
      // plain test run (defense in depth — see script-node-runner.service.ts); the
      // full governed-deploy-and-execute path below requires it, since a blocking
      // test suite run also executes the SCRIPT node. Run this file with
      // SCRIPT_NODES_ENABLED=true SCRIPT_RUNNER_MODE=IN_PROCESS to exercise it — the
      // pipeline itself (analyze/save-draft/confirm/validate/compile) is already
      // fully covered above regardless.
      return;
    }

    const suite = await request(server())
      .post(`/v1/artifact-versions/${versionId}/test-suites`)
      .set(author)
      .send({
        suiteCode: `${artifactCode}_REGRESSION`,
        name: 'Code import regression',
        suiteType: 'REGRESSION',
        isBlocking: true,
        cases: [
          {
            caseCode: 'ADULT',
            testName: 'Low risk for an adult',
            input: { age: 30 },
            expectedResult: { riskLevel: 'LOW' },
          },
        ],
      })
      .expect(201);
    const queued = await request(server())
      .post(`/v1/test-suites/${suite.body.id}/runs`)
      .set(author)
      .send({})
      .expect(202);
    const deadline = Date.now() + 15_000;
    let run = queued;
    while (Date.now() < deadline) {
      run = await request(server()).get(`/v1/test-runs/${queued.body.id}`).set(author).expect(200);
      if (['PASSED', 'FAILED', 'ERROR'].includes(run.body.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(run.body.status).toBe('PASSED');

    const submitted = await request(server())
      .post(`/v1/artifact-versions/${versionId}/submit-for-review`)
      .set(author)
      .send({ requireCompliance: false })
      .expect(201);
    const [qaStep, riskStep] = submitted.body.steps.sort(
      (a: { stepOrder: number }, b: { stepOrder: number }) => a.stepOrder - b.stepOrder,
    );
    await request(server())
      .post(`/v1/approval-steps/${qaStep.id}/decisions`)
      .set(qaApprover)
      .send({ decision: 'APPROVE', evidence: [] })
      .expect(201);
    await request(server())
      .post(`/v1/approval-steps/${riskStep.id}/decisions`)
      .set(riskApprover)
      .send({ decision: 'APPROVE', evidence: [] })
      .expect(201);
    await request(server())
      .post(`/v1/artifact-versions/${versionId}/deployments`)
      .set(deployer)
      .send({ environmentCode: 'SANDBOX', deploymentMode: 'DIRECT', traffic: [] })
      .expect(201);

    const simulated = await request(server())
      .post(`/v1/simulations/${artifactCode}`)
      .set(author)
      .send({
        requestId: `code-import-sim-${runId}`,
        environmentCode: 'SANDBOX',
        variables: { age: 30 },
      })
      .expect(201);
    expect(simulated.body.output.riskLevel).toBe('LOW');
  }, 20_000);

  it('cancels a code import', async () => {
    const analyzed = await request(server())
      .post('/v1/code-imports')
      .set(author)
      .send({ language: 'JAVASCRIPT', sourceCode: validJsSource })
      .expect(201);

    const cancelled = await request(server())
      .post(`/v1/code-imports/${analyzed.body.id}/cancel`)
      .set(author)
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
  });
});
