export type VeredictoDeFraude = 'CLEAR' | 'REVIEW' | 'FRAUD_SUSPECTED';

export interface UmbralesDeFraude {
  /**
   * Cobertura mínima de la plantilla del catálogo por debajo de la cual el
   * documento ya no se comporta como una cédula completa.
   *
   * **Estaba en 0,55 y nunca se midió contra una cédula real.** El número salía
   * de los ejemplares sintéticos de `fixtures/identity-card.ts`, que están
   * dibujados con los rótulos del catálogo en una tipografía limpia y por
   * construcción puntúan cerca de 1: contra esa población, 0,55 parecía holgado.
   *
   * La primera medición sobre una cédula boliviana auténtica del DS 4924
   * fotografiada con un móvil, en su orientación correcta y perfectamente
   * enfocada, dice otra cosa —el techo de una cédula real es 0,66, no 1—:
   *
   *   lado del OCR   600     900     1200    1600
   *   cobertura      0,216   0,463   0,515   0,664
   *
   * Con el umbral en 0,55, esa cédula levantaba `TEMPLATE_COVERAGE_LOW` a las
   * cuatro resoluciones: un documento auténtico acusado de plantilla incompleta
   * por los rótulos que su propio emisor imprime en gris a 1,2 mm.
   *
   * 0,40 es el punto medido: por encima de lo que da la cédula real a la
   * resolución que el pipeline usa (0,515) con margen para una foto peor, y muy
   * por encima de los controles negativos —un extracto bancario da 0,195 y un
   * recibo de luz 0,182—. Y no es la única defensa contra un montaje: los
   * anclajes obligatorios ausentes, las incoherencias aritméticas entre los
   * datos y el análisis de píxeles se suman aparte.
   */
  readonly coberturaMinima: number;
  /** A partir de aquí el caso va a una persona. */
  readonly riesgoDeRevision: number;
  /** A partir de aquí el caso se marca como sospecha de fraude. */
  readonly riesgoDeSospecha: number;
  /**
   * En estricto, una prueba que no se pudo ejecutar escala el caso.
   *
   * Se enciende en producción y se apaga en desarrollo, donde no siempre hay un
   * servidor de embeddings levantado y donde mandar cada prueba a una cola
   * humana inexistente sólo impediría probar el flujo.
   */
  readonly estricto: boolean;
}

export const UMBRALES_DE_FRAUDE_POR_DEFECTO: UmbralesDeFraude = {
  coberturaMinima: 0.4,
  riesgoDeRevision: 0.3,
  riesgoDeSospecha: 0.6,
  estricto: false,
};

export interface EvaluacionDeFraude {
  readonly veredicto: VeredictoDeFraude;
  /** Riesgo acumulado en `[0, 1]`. */
  readonly riesgo: number;
  /** Códigos de motivo, en el mismo vocabulario que el resto del worker. */
  readonly motivos: readonly string[];
  /**
   * Lo que se anotó SIN acusar.
   *
   * Existen para que una señal retirada del riesgo no desaparezca del
   * expediente: quien revisa un caso quiere ver que el lugar de nacimiento no
   * nombra un departamento boliviano, y quiere ver también que eso no cuenta
   * como indicio. Sin este campo, retirar el peso equivaldría a borrar el dato.
   */
  readonly observaciones: readonly string[];
  /** Qué pruebas no se pudieron ejecutar. Vacío es lo normal. */
  readonly pruebasAusentes: readonly string[];
  readonly desglose: {
    readonly conformidadDePlantilla: number;
    readonly generacion: string;
    readonly conformidadSemantica: number | null;
    readonly riesgoDeIncoherencias: number;
    readonly riesgoDeManipulacion: number;
  };
}
