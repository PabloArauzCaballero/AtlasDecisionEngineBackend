import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import {
  buildIdentityMobileCompiled,
  IDENTITY_MOBILE_VARIABLES as V,
} from '../src/modules/seeding/data/identity-mobile.graph';
import type {
  ArtifactGraphSnapshot,
  WorkerServiceInvoker,
  WorkerServiceOutcome,
} from '../src/modules/graph/graph.types';
import { DomainException } from '../src/common/errors/domain-exception';

/**
 * El artefacto que consume el front móvil, ejecutado con el motor REAL.
 *
 * El worker de identidad se sustituye por un doble. No es un atajo: verificar de
 * verdad arrastra Tesseract y las cinco redes de `@vladmandic/human`, que ya
 * tienen sus propias pruebas —`identity-verification-pipeline.spec.ts` y
 * `identity-document-gate.spec.ts`— y meterlas aquí haría que un cambio en la
 * biometría rompiera la prueba del ALGORITMO. Lo que se comprueba aquí es que,
 * dada una respuesta del worker, el artefacto decide lo que dice que decide.
 *
 * La afirmación que más importa de este fichero es la última: **la salida por
 * defecto nunca aprueba**. En un flujo de identidad, un fallo del motor o una
 * situación no contemplada no pueden abrir la puerta.
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
const compiled = buildIdentityMobileCompiled({ id: '1', tenantId: '1' }, { id: '1' }, {});

/** Lo que el worker devuelve cuando todo salió bien. */
const VERIFICADO = {
  decision: 'VERIFIED',
  reasonCodes: [] as string[],
  documentType: 'BOLIVIA_CI',
  documentCountry: 'BO',
  documentEvidence: 0.92,
  classificationConfidence: 0.94,
  faceSimilarity: 0.897,
  faceDecision: 'MATCH',
  liveness: 'PASSED',
  thresholdProfileVersion: 'sintetico-60x3',
  documentExpiresAt: '2031-07-20',
  riskFlags: [] as string[],
};

function invoker(outcome: WorkerServiceOutcome | (() => Promise<never>)): WorkerServiceInvoker {
  return { invoke: () => (typeof outcome === 'function' ? outcome() : Promise.resolve(outcome)) };
}

const worker = (
  overrides: Partial<typeof VERIFICADO> = {},
  status: WorkerServiceOutcome['status'] = 'SUCCEEDED',
): WorkerServiceOutcome => ({
  status,
  result: { ...VERIFICADO, ...overrides },
  warnings: [],
  durationMs: 6_400,
});

const inputContracts = compiled.variables.filter(
  (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
);

async function decide(serviceInvoker: WorkerServiceInvoker): Promise<Record<string, unknown>> {
  const resolution = await resolver.resolve(
    inputContracts,
    {
      // El contenido da igual aquí: quien lo interpreta es el worker, y el
      // worker es un doble.
      [V.carnetFrente]: '/9j/4AAQSkZJRg==',
      [V.carnetReverso]: '/9j/4AAQSkZJRg==',
      [V.selfie]: '/9j/4AAQSkZJRg==',
      [V.pais]: 'BO',
    },
    {
      tenantId: 1n,
      artifactCode: compiled.artifact.code,
      requestId: 'seed-check',
      allowExternal: false,
    },
  );
  expect(resolution.valid).toBe(true);
  const result = await engine.execute(
    compiled,
    resolution.values,
    undefined,
    undefined,
    undefined,
    serviceInvoker,
  );
  return result.output;
}

describe('el artefacto de identidad sembrado', () => {
  it('pasa la validación completa del grafo', () => {
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
});

describe('lo que el artefacto decide', () => {
  it('verifica cuando el worker verifica y los suelos de la política se cumplen', async () => {
    const output = await decide(invoker(worker()));

    expect(output[V.decision]).toBe('VERIFICADO');
    expect(output[V.motivo]).toBe('IDENTIDAD_CONFIRMADA');
    expect(output[V.parecido]).toBeCloseTo(0.897, 3);
  });

  it('rechaza cuando el worker afirma que no es la misma persona', async () => {
    const output = await decide(
      invoker(
        worker({ decision: 'NOT_VERIFIED', faceSimilarity: 0.31 }, 'SUCCEEDED_WITH_WARNINGS'),
      ),
    );

    expect(output[V.decision]).toBe('RECHAZADO');
    expect(output[V.motivo]).toBe('IDENTIDAD_NO_COINCIDE');
  });

  it('rechaza, sin molestar a nadie, la foto que no era un carnet', async () => {
    // El worker lanza; el nodo continúa con los valores por defecto y el
    // algoritmo enruta por el CÓDIGO del error, que es el contrato.
    const output = await decide(
      invoker(() =>
        Promise.reject(
          new DomainException(
            'IDENTITY_DOCUMENT_NOT_IDENTITY',
            'La imagen no se reconoce como un documento de identidad.',
            422,
          ),
        ),
      ),
    );

    expect(output[V.decision]).toBe('RECHAZADO');
    expect(output[V.motivo]).toBe('DOCUMENTO_NO_VALIDO');
  });

  it('rechaza un documento válido que este trámite no admite, con su propio motivo', async () => {
    const output = await decide(
      invoker(() =>
        Promise.reject(
          new DomainException(
            'IDENTITY_DOCUMENT_TYPE_NOT_ACCEPTED',
            'Ese documento no es el que este trámite admite.',
            422,
          ),
        ),
      ),
    );

    expect(output[V.decision]).toBe('RECHAZADO');
    expect(output[V.motivo]).toBe('DOCUMENTO_NO_VALIDO');
  });

  it('deriva a una persona lo que el worker dejó en duda', async () => {
    const output = await decide(
      invoker(
        worker(
          { decision: 'REVIEW_REQUIRED', reasonCodes: ['AMBIGUOUS_MATCH'] },
          'SUCCEEDED_WITH_WARNINGS',
        ),
      ),
    );

    expect(output[V.decision]).toBe('REVISION_HUMANA');
    expect(output[V.motivo]).toBe('REQUIERE_REVISION');
  });

  it('deriva también lo que el worker no pudo concluir', async () => {
    const output = await decide(
      invoker(
        worker(
          { decision: 'INCONCLUSIVE', faceSimilarity: null as unknown as number },
          'SUCCEEDED_WITH_WARNINGS',
        ),
      ),
    );

    expect(output[V.decision]).toBe('REVISION_HUMANA');
  });
});

describe('la política es del artefacto, no del worker', () => {
  it('un VERIFIED justo por debajo del suelo de parecido va a revisión', async () => {
    // El worker aplicó SU umbral calibrado y dijo que sí. Este artefacto puede
    // ser más exigente sin tocar la calibración: de eso trata separarlos.
    const output = await decide(invoker(worker({ faceSimilarity: 0.79 })));

    expect(output[V.decision]).toBe('REVISION_HUMANA');
    expect(output[V.motivo]).toBe('REQUIERE_REVISION');
  });

  it('un VERIFIED con evidencia de documento raspando también va a revisión', async () => {
    const output = await decide(invoker(worker({ documentEvidence: 0.6 })));

    expect(output[V.decision]).toBe('REVISION_HUMANA');
  });
});

describe('fail-closed', () => {
  it('una caída del worker NO aprueba: deriva a una persona', async () => {
    const output = await decide(
      invoker(() =>
        Promise.reject(
          new DomainException('IDENTITY_PROVIDER_UNAVAILABLE', 'El proveedor no responde.', 503),
        ),
      ),
    );

    expect(output[V.decision]).toBe('REVISION_HUMANA');
    expect(output[V.motivo]).toBe('REQUIERE_REVISION');
  });

  it('la arista por defecto del grafo apunta a revisión, nunca a aprobar', () => {
    // Se comprueba sobre el GRAFO y no sólo por sus efectos: una rama nueva mal
    // conectada cambiaría el destino por defecto sin que ninguna de las pruebas
    // de arriba lo notara.
    const desdeEvaluar = compiled.edgesByNode['EVALUAR'] ?? [];
    const pordefecto = desdeEvaluar.filter((arista) => arista.default);

    expect(pordefecto).toHaveLength(1);
    expect(pordefecto[0]?.to).toBe('REVISAR');
  });
});
