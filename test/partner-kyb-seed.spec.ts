import { ConfigService } from '@nestjs/config';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { HashService } from '../src/common/crypto/hash.service';
import { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import {
  buildPartnerKybCompiled,
  PARTNER_KYB_CASES,
  PARTNER_KYB_INVALID_CASES,
} from '../src/modules/seeding/data/partner-kyb.graph';
import type { ArtifactGraphSnapshot } from '../src/modules/graph/graph.types';

/**
 * El artefacto que decide si un comercio puede operar, ejecutado de verdad.
 *
 * Los desenlaces sembrados sólo valen si el motor produce exactamente esos: un seeder que
 * afirma «este expediente se aprueba» y un motor que lo rechaza es peor que no tener el
 * artefacto, porque la demo enseña una decisión que en producción no ocurre. Aquí se ejecuta
 * con el motor real y se compara.
 */
const config = new ConfigService({
  MAX_EXECUTION_STEPS: 64,
  SCRIPT_NODES_ENABLED: false,
  AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
});
const engine = new ExecutionEngineService(
  new ExpressionEvaluator(),
  config,
  new ScriptNodeRunnerService(config),
  new MetricsService(),
);
const resolver = new VariableResolutionService(
  config,
  new HashService(config),
  new MetricsService(),
);
const compiled = buildPartnerKybCompiled({ id: '1', tenantId: '1' }, { id: '1' }, {});

const inputContracts = compiled.variables.filter(
  (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
);
const resolve = (input: Record<string, unknown>) =>
  resolver.resolve(inputContracts, input, {
    tenantId: 1n,
    artifactCode: compiled.artifact.code,
    requestId: 'seed-check',
    allowExternal: false,
  });

describe('verificación KYB del comercio', () => {
  it('el grafo sembrado pasa la validación completa', () => {
    const snapshot: ArtifactGraphSnapshot = {
      artifact: compiled.artifact,
      version: compiled.version,
      variables: compiled.variables,
      intermediates: compiled.intermediates,
      outputContract: compiled.outputContract,
      conditions: Object.values(compiled.conditions),
      actions: Object.values(compiled.actions),
      nodes: Object.values(compiled.nodes),
      edges: Object.values(compiled.edgesByNode).flat(),
    };
    const report = new GraphValidatorService(
      new ExpressionEvaluator(),
      new HashService(config),
    ).validate(snapshot);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it.each(PARTNER_KYB_CASES)('$name', async ({ input, expectedOutput }) => {
    const resolution = await resolve(input);
    expect(resolution.valid).toBe(true);

    const result = await engine.execute(compiled, resolution.values);
    expect(result.status).toBe('SUCCEEDED');
    for (const [code, expected] of Object.entries(expectedOutput)) {
      expect(result.output[code]).toBe(expected);
    }
  });

  it.each(PARTNER_KYB_INVALID_CASES)(
    '$name es rechazado por el contrato',
    async ({ input, expectedError }) => {
      const resolution = await resolve(input);
      expect(resolution.valid).toBe(false);
      expect(resolution.errors[0].code).toBe(expectedError);
    },
  );

  /*
   * La regla que hace útil al artefacto: un requisito duro no se compensa.
   *
   * Sin esto, un expediente impecable en todo lo demás podría aprobarse sin QR bancario — es
   * decir, habilitar a cobrar a un comercio que no ha dicho a qué cuenta va el dinero.
   */
  it('faltar un requisito duro manda a RECHAZADO aunque no haya ninguna señal', async () => {
    const resolution = await resolve({
      kyb_tiene_matricula: true,
      kyb_representante_acreditado: true,
      kyb_qr_negocio: true,
      kyb_qr_bancario: false,
      kyb_correo_verificado: true,
      kyb_sucursales: 4,
      kyb_antiguedad_dias: 1,
    });
    const result = await engine.execute(compiled, resolution.values);
    expect(result.output.kyb_decision).toBe('RECHAZADO');
    expect(result.output.kyb_senales_operativas).toBe(0);
  });

  it('las intermedias no se filtran a la respuesta pública', async () => {
    const resolution = await resolve(PARTNER_KYB_CASES[0].input);
    const result = await engine.execute(compiled, resolution.values);
    expect(Object.keys(result.output)).not.toContain('requisitos_faltantes');
    expect(Object.keys(result.output)).not.toContain('senales_operativas');
  });

  /*
   * Un expediente completo NUNCA se aprueba solo si trae señales.
   *
   * Es la línea entre automatizar y delegar: el artefacto puede decir «esto está completo», pero
   * habilitar a un comercio a cobrar cuando su correo no está verificado o no se sabe dónde opera
   * es una decisión con consecuencias que firma una persona.
   */
  it('ninguna señal operativa termina en APROBADO', async () => {
    const conSenales = PARTNER_KYB_CASES.filter(
      (caso) => Number(caso.expectedOutput.kyb_senales_operativas) > 0,
    );
    expect(conSenales.length).toBeGreaterThan(0);
    for (const caso of conSenales) {
      const resolution = await resolve(caso.input);
      const result = await engine.execute(compiled, resolution.values);
      expect(result.output.kyb_decision).not.toBe('APROBADO');
    }
  });
});
