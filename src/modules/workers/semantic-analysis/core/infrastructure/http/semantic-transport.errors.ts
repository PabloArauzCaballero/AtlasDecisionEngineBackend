import type { TransportErrors } from '../../../../../../common/llm/openai-compatible-transport';
import {
  SemanticProviderError,
  SemanticTimeoutError,
} from '../../domain/semantic-analysis.errors';

/**
 * La taxonomía del worker semántico, para el transporte compartido de `common`.
 *
 * No es una formalidad: el pipeline distingue `SemanticTimeoutError` para
 * decidir si RESCATA un análisis a medias, y `toStableErrorCode` sólo sabe
 * nombrar los errores que descienden de `SemanticAnalysisError`. Un transporte
 * que devolviera las clases genéricas dejaría los dos comportamientos sin
 * cambiar el código que los implementa, que es la peor forma de romperlos.
 */
export const semanticTransportErrors: TransportErrors = {
  provider: (message, retryable, options) => new SemanticProviderError(message, retryable, options),
  budgetExhausted: (message, options) => new SemanticTimeoutError(message, options),
  classified: (error) =>
    error instanceof SemanticProviderError ? { retryable: error.retryable } : undefined,
};
