import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../../common/errors/domain-exception';
import type { WorkerServiceOutcome } from '../../graph/graph.types';
import { SemanticAnalysisPipeline } from '../semantic-analysis/core/application/semantic-analysis.pipeline';
import type { SemanticAnalysisResult } from '../semantic-analysis/core/domain/semantic-analysis.types';
import {
  assertAvailable,
  MAX_CALL_TIMEOUT_MS,
  stringArgument,
  timeoutFor,
  toDomainException,
  withTimeout,
  type WorkerServiceCall,
  type WorkerServiceHandler,
} from './worker-call';

/** Clasifica un texto libre contra el catálogo semántico del tenant. */
@Injectable()
export class SemanticClassificationCallHandler implements WorkerServiceHandler {
  readonly key = 'semantic-analysis.classify';

  constructor(
    private readonly config: ConfigService,
    private readonly semantic: SemanticAnalysisPipeline,
  ) {}

  async handle({
    tenantId,
    principal,
    request,
    started,
  }: WorkerServiceCall): Promise<WorkerServiceOutcome> {
    assertAvailable(
      'semantic-analysis',
      (this.config.get<boolean>('SEMANTIC_ANALYSIS_WORKER_ENABLED') ?? false) &&
        (this.config.get<string>('SEMANTIC_ANALYSIS_PROVIDER') ?? '') !== '',
      request.nodeKey,
    );

    const text = stringArgument(request, 'text');
    if (!text) {
      throw new DomainException(
        'WORKER_ARGUMENT_MISSING',
        `El nodo ${request.nodeKey} llama a semantic-analysis.classify sin el argumento text`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const maxLength = this.config.get<number>('SEMANTIC_ANALYSIS_MAX_TEXT_LENGTH') ?? 8_000;
    if (text.length > maxLength) {
      throw new DomainException(
        'WORKER_ARGUMENT_TOO_LONG',
        `El texto que el nodo ${request.nodeKey} envía a clasificar supera los ${maxLength} caracteres`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // La clave de idempotencia se deriva del texto y del nodo, no de un aleatorio: dos
    // ejecuciones iguales del mismo algoritmo sobre el mismo texto deben poder reconocerse
    // como el mismo trabajo aguas abajo, que es justo lo que una clave sortea.
    const idempotencyKey = createHash('sha256')
      .update(`${tenantId.toString()}|${request.nodeKey}|${text}`)
      .digest('hex');

    try {
      const result = await withTimeout(
        this.semantic.analyze({
          requestId: randomUUID(),
          idempotencyKey,
          text,
          tenantId: tenantId.toString(),
          requestedBy: principal.id,
        }),
        timeoutFor(request, MAX_CALL_TIMEOUT_MS),
        request,
      );
      /*
       * El worker ya NO devuelve `UNKNOWN`: una glosa que el modelo no resolvió
       * sale con la categoría que sus reglas afirman —o con el cajón de su
       * sentido— y con `requiresReview` puesto. Enrutar por el estado, como se
       * hacía aquí, habría dejado de desviar el día que dejamos de abstenernos:
       * todo llegaría como `SUCCEEDED` y el algoritmo no podría distinguir lo
       * que el modelo entendió de lo que se dedujo de la palabra «TRASPASO».
       */
      const dudosa = result.requiresReview;
      return {
        status: dudosa ? 'SUCCEEDED_WITH_WARNINGS' : 'SUCCEEDED',
        result: toClassificationResult(result),
        warnings: dudosa
          ? [
              `Categoría decidida por ${result.decidedBy} y marcada para revisión (${String(result.reviewReason)})`,
            ]
          : [],
        durationMs: Date.now() - started,
      };
    } catch (error) {
      throw toDomainException(error, request);
    }
  }
}

/**
 * Forma con la que la decisión ve una clasificación.
 *
 * No es el resultado crudo del worker: se aplanan los dos datos sobre los que un algoritmo
 * razona de verdad —qué categoría y con cuánta confianza— para que una condición no tenga
 * que indexar dentro de un array. El resto se conserva por si un nodo quiere la evidencia.
 */
function toClassificationResult(result: SemanticAnalysisResult): Record<string, unknown> {
  const best = [...result.matches]
    .filter((match) => match.supported && !match.contradicted)
    .sort((a, b) => b.confidence - a.confidence)[0];
  return {
    status: result.status,
    categoryCode: best?.categoryCode ?? null,
    confidence: best?.confidence ?? 0,
    // Quién decidió y si hay que mirarlo. Es lo que un algoritmo necesita para
    // tratar distinto «el modelo lo entendió» y «lo dedujo una regla»: sin estos
    // dos campos las dos cosas llegan como una categoría con su confianza y son
    // indistinguibles justo donde más importa, que es al aprobar un crédito.
    decidedBy: result.decidedBy,
    requiresReview: result.requiresReview,
    reviewReason: result.reviewReason,
    tierUsed: result.tierUsed,
    model: result.model,
    modelVersion: result.modelVersion,
    entities: result.entities,
    matches: result.matches,
    evaluatedCategoryCodes: result.evaluatedCategoryCodes,
    // La rama, no sólo la hoja: un algoritmo que enruta gasto suele decidir por
    // «es vivienda», y sin la ruta tendría que reconstruir el árbol a mano.
    categoryPath: best === undefined ? [] : (result.categoryPaths[best.categoryCode] ?? []),
    categoryPaths: result.categoryPaths,
    processingTimeMs: result.processingTimeMs,
  };
}
