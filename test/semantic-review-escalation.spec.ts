import { SemanticAnalysisProcessor } from '../src/modules/workers/semantic-analysis/core/application/semantic-analysis.processor';
import type {
  SemanticAuditRepository,
  SemanticMetricsRecorder,
  UnresolvedSink,
} from '../src/modules/workers/semantic-analysis/core/application/ports';
import type { SemanticAnalysisPipeline } from '../src/modules/workers/semantic-analysis/core/application/semantic-analysis.pipeline';
import {
  SemanticConfigurationError,
  SemanticProviderError,
  SemanticTimeoutError,
} from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.errors';
import type {
  SemanticAnalysisRequest,
  SemanticAnalysisResult,
} from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';
import type { TracingService } from '../src/common/observability/tracing.service';

/**
 * Una glosa LENTA no es una glosa ROTA.
 *
 * Ésta era la pérdida silenciosa: cuando el análisis agotaba su reloj, la
 * ejecución se marcaba fallida y ahí terminaba todo. Y «fallido» y «tardó
 * demasiado» no se tratan igual en ninguna parte del circuito —lo fallido se
 * reintenta y se olvida; lo lento suele ser justo lo que MÁS necesita que lo
 * mire una persona, porque tardar es lo que hacen los casos ambiguos y las
 * redacciones que el modelo no había visto—. El resultado era que esas glosas no
 * llegaban nunca a la bandeja de revisión: no se podían asignar, no se podían
 * contar y no dejaban rastro de por qué habían desaparecido.
 *
 * Lo que se fija aquí es esa frontera, en las dos direcciones: qué se escala y
 * qué NO, porque una bandeja que recoge también lo que nadie puede resolver
 * desde ella es tan inútil como una que no recoge nada.
 */

const PETICION: SemanticAnalysisRequest = {
  requestId: 'req-lenta',
  idempotencyKey: 'clave-1',
  text: 'TRASPASO CA/CC CON QR (MOVIL)',
  tenantId: '7',
  requestedBy: 'pruebas',
};

/**
 * Un veredicto que el modelo NO resolvió, tal como sale hoy del pipeline.
 *
 * Ojo al detalle que cambió: el estado publicado ya no es `UNKNOWN` a secas ni
 * es lo que decide el escalado. El worker rescata la glosa por reglas —aquí,
 * `GASTOS.TRANSFERENCIAS`, que es lo que `TRASPASO` afirma por sí solo— y marca
 * el caso con `requiresReview`. La bandeja se llena por esa bandera, no por el
 * estado, y eso es justo lo que este fichero vigila: dejar de abstenerse no
 * puede significar dejar de escalar.
 */
const RESULTADO: SemanticAnalysisResult = {
  requestId: 'req-lenta',
  status: 'MATCH',
  normalizedText: 'TRASPASO CA/CC CON QR (MOVIL)',
  entities: [],
  matches: [{ categoryCode: 'GASTOS.TRASPASO', confidence: 0.41 }],
  evaluatedCategoryCodes: ['GASTOS.TRASPASO'],
  categoryPaths: { 'GASTOS.TRASPASO': ['Gastos', 'Traspaso'] },
  tierUsed: 'FAST',
  processingTimeMs: 120,
  decidedBy: 'RULE',
  requiresReview: true,
  reviewReason: 'LOW_CONFIDENCE',
} as unknown as SemanticAnalysisResult;

/** El mismo veredicto pero resuelto de verdad: nadie tiene que mirarlo. */
const RESUELTO: SemanticAnalysisResult = {
  ...RESULTADO,
  decidedBy: 'MODEL',
  requiresReview: false,
  reviewReason: null,
} as unknown as SemanticAnalysisResult;

interface Montaje {
  procesador: SemanticAnalysisProcessor;
  bandeja: { record: jest.Mock };
  metricas: SemanticMetricsRecorder & { recordReviewEscalation: jest.Mock };
  auditoria: { claim: jest.Mock; complete: jest.Mock; fail: jest.Mock; exhaust: jest.Mock };
}

/** El procesador con todo simulado salvo lo que se está midiendo. */
function montar(analyze: jest.Mock): Montaje {
  const bandeja = { record: jest.fn().mockResolvedValue({ status: 'PENDING' }) };
  const metricas = {
    recordAnalysis: jest.fn(),
    recordProviderCall: jest.fn(),
    recordFailure: jest.fn(),
    recordQueueDepth: jest.fn(),
    recordReviewEscalation: jest.fn(),
  };
  const auditoria = {
    claim: jest.fn().mockResolvedValue({ state: 'ACQUIRED' }),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    exhaust: jest.fn().mockResolvedValue(undefined),
  };
  // El trazado ejecuta el trabajo tal cual: aquí no se mide la traza.
  const tracing = {
    runInSpan: (_nombre: string, _atributos: unknown, trabajo: (span: unknown) => Promise<void>) =>
      trabajo({ setAttribute: jest.fn() }),
    setAttributes: jest.fn(),
    recordException: jest.fn(),
  } as unknown as TracingService;

  const procesador = new SemanticAnalysisProcessor(
    auditoria as unknown as SemanticAuditRepository,
    metricas as unknown as SemanticMetricsRecorder,
    { analyze } as unknown as SemanticAnalysisPipeline,
    tracing,
    bandeja as unknown as UnresolvedSink,
  );
  return { procesador, bandeja, metricas, auditoria };
}

/** El contexto con el que se escribió en la bandeja. */
function contextoEscrito(bandeja: { record: jest.Mock }): Record<string, unknown> {
  return (bandeja.record.mock.calls[0]?.[0] as { context: Record<string, unknown> }).context;
}

describe('una glosa que tarda demasiado va a REVISIÓN, no a fallida', () => {
  it('escala con motivo TIMEOUT cuando el análisis agota su reloj', async () => {
    const { procesador, bandeja, auditoria } = montar(
      jest.fn().mockRejectedValue(new SemanticTimeoutError('El proveedor no respondió.')),
    );

    // Se sigue relanzando: la cola es quien decide el reintento, y tragarse el
    // error aquí la dejaría creyendo que el trabajo salió bien.
    await expect(procesador.execute(PETICION)).rejects.toThrow(SemanticTimeoutError);

    // La ejecución se marca fallida —eso no cambia, es su desenlace técnico—
    // pero además el término queda en la bandeja, que es lo que faltaba.
    expect(auditoria.fail).toHaveBeenCalled();
    expect(bandeja.record).toHaveBeenCalledTimes(1);
    expect(contextoEscrito(bandeja)).toMatchObject({
      reason: 'TIMEOUT',
      errorCode: 'SEMANTIC_TIMEOUT',
      requestId: 'req-lenta',
    });
  });

  it('guarda el valor TAL CUAL llegó, que es lo único que permite revisarlo', async () => {
    const { procesador, bandeja } = montar(
      jest.fn().mockRejectedValue(new SemanticTimeoutError('tardó')),
    );
    await expect(procesador.execute(PETICION)).rejects.toThrow();

    expect(bandeja.record.mock.calls[0][0]).toMatchObject({
      rawValue: 'TRASPASO CA/CC CON QR (MOVIL)',
      source: 'semantic-analysis',
      tenantId: 7n,
      correlationId: 'req-lenta',
    });
  });

  it('mide la escalada con su motivo, para poder distinguir lentitud de duda', async () => {
    const { procesador, metricas } = montar(
      jest.fn().mockRejectedValue(new SemanticTimeoutError('tardó')),
    );
    await expect(procesador.execute(PETICION)).rejects.toThrow();

    expect(metricas.recordReviewEscalation).toHaveBeenCalledWith({
      reason: 'TIMEOUT',
      tenantId: '7',
    });
  });

  it('un fallo transitorio que no es el reloj escala como PROCESSING_ERROR', async () => {
    const { procesador, bandeja } = montar(
      jest.fn().mockRejectedValue(new SemanticProviderError('502 del proveedor', true)),
    );
    await expect(procesador.execute(PETICION)).rejects.toThrow();

    expect(contextoEscrito(bandeja)).toMatchObject({ reason: 'PROCESSING_ERROR' });
  });

  it('un incumplimiento PERMANENTE del proveedor también escala', async () => {
    // Categoría alucinada, JSON truncado, esquema incumplido: no se reintentan
    // —repetirlos da lo mismo— pero la glosa se lee perfectamente y alguien la
    // clasifica en dos segundos. Tratarlos como una credencial ausente los
    // sacaba del circuito y el movimiento desaparecía del informe.
    const { procesador, bandeja } = montar(
      jest
        .fn()
        .mockRejectedValue(
          new SemanticProviderError('El proveedor devolvió una categoría no candidata.', false),
        ),
    );
    await expect(procesador.execute(PETICION)).rejects.toThrow();

    expect(contextoEscrito(bandeja)).toMatchObject({ reason: 'PROCESSING_ERROR' });
  });

  it('un error de CONFIGURACIÓN no ensucia la bandeja', async () => {
    // Nadie arregla una credencial ausente desde una pantalla de clasificación.
    // Escalarlo llenaría la cola de trabajo con avisos que sus destinatarios no
    // pueden atender, y escondería el fallo real detrás de cientos de pendientes.
    const { procesador, bandeja, auditoria } = montar(
      jest.fn().mockRejectedValue(new SemanticConfigurationError('falta el modelo')),
    );
    await expect(procesador.execute(PETICION)).rejects.toThrow();

    expect(auditoria.fail).toHaveBeenCalled();
    expect(bandeja.record).not.toHaveBeenCalled();
  });

  it('un fallo de la bandeja no convierte en fallido un análisis que sí terminó', async () => {
    const { procesador, auditoria, bandeja } = montar(jest.fn().mockResolvedValue(RESULTADO));
    // La bandeja revienta DESPUÉS de que el análisis se auditara. Propagar ese
    // fallo haría que la cola reintentara un trabajo que salió bien.
    bandeja.record.mockRejectedValue(new Error('la bandeja está caída'));

    await expect(procesador.execute(PETICION)).resolves.toBeUndefined();
    expect(auditoria.complete).toHaveBeenCalled();
    expect(auditoria.fail).not.toHaveBeenCalled();
  });
});

describe('la abstención sigue escalando, ahora con su motivo escrito', () => {
  it('un veredicto UNKNOWN se escala como LOW_CONFIDENCE con sus candidatas', async () => {
    const { procesador, bandeja } = montar(jest.fn().mockResolvedValue(RESULTADO));

    await procesador.execute(PETICION);

    expect(contextoEscrito(bandeja)).toMatchObject({
      reason: 'LOW_CONFIDENCE',
      decidedBy: 'RULE',
    });
    // Las candidatas evaluadas viajan aunque ninguna alcanzara su umbral: son
    // la recomendación que permite decidir de un vistazo.
    expect(bandeja.record.mock.calls[0][0]).toMatchObject({
      candidates: [{ categoryCode: 'GASTOS.TRASPASO', confidence: 0.41 }],
    });
  });

  it('un veredicto resuelto no abre ningún pendiente', async () => {
    const { procesador, bandeja } = montar(jest.fn().mockResolvedValue(RESUELTO));

    await procesador.execute(PETICION);

    expect(bandeja.record).not.toHaveBeenCalled();
  });
});
