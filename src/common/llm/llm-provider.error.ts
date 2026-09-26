/**
 * Errores genéricos del transporte compartido contra APIs compatibles con OpenAI.
 *
 * Existen porque el transporte dejó de pertenecer a un módulo: lo usan el worker
 * semántico —que tiene su propia taxonomía de errores y la necesita para decidir
 * si rescata un análisis— y el árbitro de identidad, que no tiene ninguna. Un
 * transporte que impusiera las clases de uno de los dos obligaría al otro a
 * importar el dominio ajeno, que es justo lo que `common` existe para evitar.
 *
 * Quien tenga taxonomía propia la inyecta con `TransportErrors`; quien no, se
 * queda con éstas.
 */
export class LlmProviderError extends Error {
  public constructor(
    message: string,
    /**
     * Si repetir la llamada puede dar otro resultado. Un fallo permanente no
     * debe consumir reintentos ni cuota para llegar a la misma respuesta.
     */
    public readonly retryable: boolean = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * El presupuesto de tiempo de quien llamó se agotó, dentro o fuera de la espera
 * entre reintentos. Se separa de `LlmProviderError` porque no dice nada del
 * proveedor: puede estar perfectamente sano y haber contestado tarde.
 */
export class LlmBudgetExhaustedError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * La cuenta del proveedor se quedó sin saldo.
 *
 * Es un `LlmProviderError` permanente —ningún reintento crea créditos— y a la
 * vez una clase propia, porque es el ÚNICO fallo de esta familia que no se
 * arregla tocando el motor: se arregla pagando. Distinguirlo es lo que permite
 * que la bandeja diga «no hay créditos» en vez de «el árbitro no contestó», que
 * son dos incidentes con dueños distintos.
 */
export class LlmCreditsExhaustedError extends LlmProviderError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, false, options);
  }
}
