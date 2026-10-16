import type { ConformidadDePlantilla } from '../../catalog/bolivia-ci.recognizer';
import type { ExtractedIdentityData } from '../../domain/extracted-identity.types';
import type { MrzTd1 } from '../../parsers/mrz-td1';

/*
 * La MEDIDA de conformidad vive en `catalog/bolivia-ci.recognizer.ts` y este
 * archivo la reexporta.
 *
 * No es un reparto cosmético: la misma cobertura tiene que servir para NOMBRAR
 * el documento —el clasificador la usa para decidir si es una cédula— y para
 * juzgar si su plantilla está completa, que es lo que se hace aquí. Con dos
 * implementaciones, el día que se separen un documento sería una cédula para la
 * puerta y una plantilla incompleta para el análisis de fraude, por la misma
 * foto y en la misma ejecución.
 */
export type { ConformidadDePlantilla };

/** Una incoherencia entre datos del propio documento. No es una opinión: es aritmética. */
export interface IncoherenciaEstructural {
  readonly codigo: string;
  readonly detalle: string;
  /** Cuánto suma al riesgo de fraude, en `[0, 1]`. */
  readonly peso: number;
}

/**
 * Algo que se anota y que **no suma riesgo**.
 *
 * La distinción entre esto y una incoherencia es la corrección más importante de
 * este archivo, y no es de estilo: es la diferencia entre describir y acusar.
 *
 * Tres cosas se movieron aquí desde las incoherencias, y las tres por el mismo
 * motivo — el corpus demuestra que la regla que las sostenía no está verificada:
 *
 * - **El formato del número de cédula.** Se exigían cinco a ocho dígitos sin
 *   cero inicial. El corpus buscó la gramática del SEGIP y devolvió
 *   `exact_min_length: null`, `exact_max_length: null`,
 *   `leading_zero_assignment_policy: null` y la instrucción literal «conservar
 *   los ceros; no rechazar con una longitud no verificada» (hueco G04).
 * - **La nacionalidad de la MRZ.** Ni la nacionalidad ni el estado emisor están
 *   cubiertos por ningún dígito de control —el corpus lo enumera— y un titular
 *   EXTRANJERO con cédula boliviana tiene legítimamente otra nacionalidad: el
 *   propio corpus lista la cédula de extranjero como documento existente.
 * - **El lugar de nacimiento.** Una persona nacida fuera de Bolivia es una
 *   persona nacida fuera de Bolivia. Medido sobre 23 cédulas auténticas, esta
 *   regla acusó a una.
 *
 * Ninguna de las tres desaparece: se registran, viajan a la traza y quien revisa
 * las ve. Lo que pierden es el peso.
 */
export interface ObservacionEstructural {
  readonly codigo: string;
  readonly detalle: string;
  /** Por qué se registra y no acusa. Va en la traza para que no se reintroduzca. */
  readonly razonDeNoAcusar: string;
}

export interface AnalisisDePlantilla {
  /** La generación que mejor explica lo que se leyó. */
  readonly mejor: ConformidadDePlantilla;
  readonly todas: readonly ConformidadDePlantilla[];
  readonly incoherencias: readonly IncoherenciaEstructural[];
  /** Lo que se anota sin acusar. Ver `ObservacionEstructural`. */
  readonly observaciones: readonly ObservacionEstructural[];
  /**
   * Si la COBERTURA de plantilla se puede juzgar con esta imagen.
   *
   * `false` cuando la captura no da resolución suficiente para leer los rótulos
   * que la plantilla enumera. Entonces una cobertura baja no dice nada del
   * documento —dice que la foto es pequeña— y el fusor de fraude no la puntúa.
   */
  readonly coberturaEvaluable: boolean;
  /** Por qué no se puede juzgar, cuando no se puede. */
  readonly motivoDeNoEvaluable: string | null;
  /** Marcas de falsificación literales encontradas en el texto. */
  readonly marcasDeFalsificacion: readonly string[];
}

export interface EntradaDePlantilla {
  readonly textoAnverso: string;
  readonly textoReverso: string;
  readonly campos: ExtractedIdentityData;
  readonly mrz: MrzTd1 | null;
  /** Fecha de referencia. La entrega quien llama para que el análisis sea reproducible. */
  readonly ahora: Date;
  /**
   * Lado largo, en píxeles, de la imagen del documento tal como se capturó.
   *
   * Se pasa para poder decir «no se pudo leer» en vez de «no está». Omitirlo
   * mantiene el comportamiento anterior: la cobertura se juzga siempre.
   */
  readonly ladoLargoPx?: number | null;
  /** Suelo de legibilidad. Por omisión, `LADO_LARGO_MINIMO_LEGIBLE`. */
  readonly ladoLargoMinimo?: number;
}
