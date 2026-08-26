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
  /*
   * `CLEAR` explícito, porque la política 1.2.0 lo EXIGE explícito.
   *
   * El intermedio por defecto es `UNKNOWN` —la llamada no llegó a producir
   * análisis— y `UNKNOWN` no aprueba: cae por la arista por defecto y termina
   * delante de una persona. Que el doble tenga que declararlo es la prueba de que
   * la condición no se puede satisfacer por omisión.
   */
  fraudVerdict: 'CLEAR',
  fraudRisk: 0.04,
};

/**
 * Las entradas que NO salen de las fotos: el registro estatal y la agenda.
 *
 * Se pasan a `decide` por separado para que cada prueba pueda mover UNA y ver qué
 * cambia. El valor por defecto es el del alta limpia — SEGIP confirma y la agenda
 * es la de alguien que vive con su teléfono— porque es el caso contra el que se
 * miden todas las desviaciones.
 */
const CONTEXTO_LIMPIO: Record<string, unknown> = {
  [V.segipEstado]: 'FOUND',
  [V.segipCoincidencia]: 0.98,
  [V.agendaDisponible]: true,
  [V.agendaTotal]: 180,
  [V.agendaUnicosRatio]: 0.94,
  [V.agendaBoliviaRatio]: 0.86,
  [V.agendaReferenciasPresentes]: 2,
  [V.agendaCoincidenciasRiesgo]: 0,
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

async function decide(
  serviceInvoker: WorkerServiceInvoker,
  contexto: Record<string, unknown> = CONTEXTO_LIMPIO,
): Promise<Record<string, unknown>> {
  const resolution = await resolver.resolve(
    inputContracts,
    {
      // El contenido da igual aquí: quien lo interpreta es el worker, y el
      // worker es un doble.
      [V.carnetFrente]: '/9j/4AAQSkZJRg==',
      [V.carnetReverso]: '/9j/4AAQSkZJRg==',
      [V.selfie]: '/9j/4AAQSkZJRg==',
      [V.pais]: 'BO',
      ...contexto,
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

/**
 * Las tres fuentes que la versión 1.2.0 añadió, y la razón de añadirlas.
 *
 * Hasta 1.1.1 el veredicto salía de UNA fuente —lo que el worker leyó en la foto— y una foto es
 * exactamente lo que un suplantador puede conseguir. Cada prueba de aquí mueve UNA de las tres
 * entradas nuevas dejando las otras dos limpias, que es la única forma de demostrar que cada una
 * hace algo por su cuenta.
 *
 * Ninguna aprueba: todas escalan. Sumar fuentes tiene que endurecer la puerta, nunca abrirla.
 */
describe('las tres fuentes nuevas', () => {
  it('un documento con sospecha de fraude va a SU cola, con su propio motivo', async () => {
    const output = await decide(invoker(worker({ fraudVerdict: 'FRAUD_SUSPECTED', fraudRisk: 0.71 })));

    expect(output[V.decision]).toBe('REVISION_HUMANA');
    // Motivo propio y no `REQUIERE_REVISION`: un caso que llega porque la foto salió movida y uno
    // que llega porque el documento parece falsificado necesitan analistas y tiempos distintos.
    expect(output[V.motivo]).toBe('SOSPECHA_DE_FRAUDE');
    expect(output[V.fraude]).toBeCloseTo(0.71, 2);
  });

  it('la autenticidad SIN COMPROBAR tampoco aprueba', async () => {
    /*
     * `UNKNOWN` es el valor por defecto del intermedio: la llamada no llegó a producir análisis.
     * Con `neq FRAUD_SUSPECTED` esto aprobaría, y ahí está la diferencia entre exigir una prueba y
     * aceptar su ausencia.
     */
    const output = await decide(invoker(worker({ fraudVerdict: 'UNKNOWN', fraudRisk: 0 })));

    expect(output[V.decision]).toBe('REVISION_HUMANA');
    expect(output[V.motivo]).toBe('REQUIERE_REVISION');
  });

  it('sin confirmación del registro estatal no se aprueba solo, pero TAMPOCO se rechaza', async () => {
    /*
     * Un homónimo, una tilde y un apellido compuesto producen coincidencias parciales sobre gente
     * perfectamente real. Rechazar ahí sería el falso positivo más caro de este flujo: le cierra el
     * producto a alguien por la ortografía de un registro ajeno.
     */
    for (const estado of ['PARTIAL_MATCH', 'NOT_FOUND', 'PROVIDER_UNAVAILABLE', 'NO_CONSULTADO']) {
      const output = await decide(invoker(worker()), { ...CONTEXTO_LIMPIO, [V.segipEstado]: estado });
      expect(output[V.decision]).toBe('REVISION_HUMANA');
    }
  });

  it('una agenda sospechosa por DOS motivos manda el caso a una persona', async () => {
    /*
     * Agenda diminuta (30) y ninguna referencia dentro de ella (25) suman 55… que NO llega al
     * umbral de 60. Hace falta la tercera: sin arraigo local (20). Es deliberado — el corte está
     * puesto para que dos señales pequeñas no basten, porque estrenar teléfono no es un delito.
     */
    const output = await decide(invoker(worker()), {
      ...CONTEXTO_LIMPIO,
      [V.agendaTotal]: 6,
      [V.agendaBoliviaRatio]: 0.1,
      [V.agendaReferenciasPresentes]: 0,
    });

    expect(output[V.decision]).toBe('REVISION_HUMANA');
    expect(output[V.motivo]).toBe('REQUIERE_REVISION');
    expect(Number(output[V.riesgoAgenda])).toBeGreaterThanOrEqual(0.6);
  });

  it('UNA sola señal de la agenda nunca alcanza para escalar', async () => {
    /*
     * La afirmación que protege al producto de sí mismo. Tener pocos contactos, o no reconocer una
     * referencia, o tener la agenda de otro país, son cosas que le pasan a gente que no hizo nada
     * mal. Si una sola bastara, el alta empezaría a mandar a revisión a quien acaba de estrenar
     * teléfono — y una cola llena de casos buenos deja de revisarse.
     */
    const output = await decide(invoker(worker()), { ...CONTEXTO_LIMPIO, [V.agendaTotal]: 6 });

    expect(output[V.decision]).toBe('VERIFICADO');
    expect(Number(output[V.riesgoAgenda])).toBeLessThan(0.6);
  });

  it('no compartir la agenda NO impide aprobar', async () => {
    /*
     * Negarse a dar el permiso es un derecho, no una señal de fraude. Suma veinte puntos —hay MENOS
     * evidencia, no evidencia en contra— y veinte no llegan a sesenta. Puntuarlo alto convertiría un
     * derecho en una penalización y empujaría a la app a pedir el permiso de formas que no debería.
     */
    const output = await decide(invoker(worker()), {
      ...CONTEXTO_LIMPIO,
      [V.agendaDisponible]: false,
      [V.agendaTotal]: 0,
      [V.agendaUnicosRatio]: 0,
      [V.agendaBoliviaRatio]: 0,
      [V.agendaReferenciasPresentes]: 0,
      [V.agendaCoincidenciasRiesgo]: 0,
    });

    expect(output[V.decision]).toBe('VERIFICADO');
    expect(Number(output[V.riesgoAgenda])).toBeCloseTo(0.2, 2);
  });

  it('un teléfono ya marcado en la agenda, MÁS cualquier otra señal, escala', async () => {
    const output = await decide(invoker(worker()), {
      ...CONTEXTO_LIMPIO,
      [V.agendaCoincidenciasRiesgo]: 2,
      [V.agendaReferenciasPresentes]: 0,
    });

    expect(output[V.decision]).toBe('REVISION_HUMANA');
  });

  it('omitir por completo las entradas nuevas empuja a revisión, nunca a aprobar', async () => {
    /*
     * Es la garantía que hace seguro que las ocho entradas sean opcionales: un llamante antiguo
     * —otra versión de AtlasBackend, el laboratorio, una prueba— sigue obteniendo decisión, y esa
     * decisión es la cauta.
     */
    const output = await decide(invoker(worker()), {});

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
