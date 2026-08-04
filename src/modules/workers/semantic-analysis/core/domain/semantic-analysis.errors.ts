export class SemanticAnalysisError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    /**
     * Indica si repetir la operación tiene sentido. Un fallo permanente no debe consumir
     * reintentos de la cola ni cuota del proveedor.
     */
    public readonly retryable: boolean = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class SemanticProviderError extends SemanticAnalysisError {
  public constructor(message: string, retryable = false, options?: ErrorOptions) {
    super(message, 'SEMANTIC_PROVIDER_ERROR', retryable, options);
  }
}

export class SemanticConfigurationError extends SemanticAnalysisError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 'SEMANTIC_CONFIGURATION_ERROR', false, options);
  }
}

export class SemanticTimeoutError extends SemanticAnalysisError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 'SEMANTIC_TIMEOUT', true, options);
  }
}

/**
 * Se emite cuando la cola agota los reintentos y el job cae en la cola dead-letter.
 */
export class SemanticExhaustedError extends SemanticAnalysisError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, 'SEMANTIC_RETRIES_EXHAUSTED', false, options);
  }
}

/**
 * Extrae un código estable y seguro para auditoría, sin exponer mensajes con datos de entrada.
 */
export function toStableErrorCode(error: unknown): string {
  if (error instanceof SemanticAnalysisError) {
    return error.code;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'SEMANTIC_TIMEOUT';
  }
  return 'UNEXPECTED_ANALYSIS_ERROR';
}

/**
 * Determina si la cola debe reintentar. Ante un error desconocido se asume transitorio, porque el
 * caso más frecuente es una indisponibilidad de red o de base de datos.
 */
export function isRetryable(error: unknown): boolean {
  return error instanceof SemanticAnalysisError ? error.retryable : true;
}
