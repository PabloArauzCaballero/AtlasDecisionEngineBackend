/** Las generaciones de la tarjeta que hoy pueden presentarse legítimamente. */
export enum BoliviaCiGeneration {
  /** Rediseño del DS 4924, vigente desde el 1 de noviembre de 2023. Lleva MRZ TD1. */
  DS_4924_2023 = 'DS_4924_2023',
  /** Formato rotulado anterior, con código QR (DS 4342, 2020) o código de barras (2011). */
  PRE_2023 = 'PRE_2023',
}

/**
 * Un anclaje del catálogo: algo que la tarjeta IMPRIME y que se puede buscar en
 * el texto leído.
 *
 * `peso` no es una preferencia estética. Es cuánto cuesta falsificar ese
 * anclaje: el rótulo «NOMBRES» lo escribe cualquiera en un editor de imágenes y
 * pesa poco; la MRZ con sus dígitos de control cuadrados exige haber generado
 * los checksums de la ICAO y pesa mucho.
 */
export interface AnclajeDeCatalogo {
  readonly id: string;
  /** Dónde se imprime. `AMBAS` cuando la cara depende de la generación. */
  readonly cara: 'ANVERSO' | 'REVERSO' | 'AMBAS';
  /**
   * El patrón EXACTO. Se conserva porque describe el anclaje sin ambigüedad y
   * porque sobre un texto limpio —los ejemplares sintéticos, una lectura de
   * calidad— sigue siendo la comprobación más barata y más precisa.
   */
  readonly patron: RegExp;
  /**
   * Lo que la tarjeta IMPRIME, tal cual, para cotejarlo con tolerancia a las
   * erratas del reconocedor (`approximate-match.ts`).
   *
   * Son ALTERNATIVAS de la misma cosa, no sinónimos: basta que case una. La
   * grafía larga es el rótulo completo y la corta existe porque el reconocedor
   * parte los rótulos largos con muchísima frecuencia —medido: `CÉDULA DE
   * IDENTIDAD` vuelve como `CEI 1 DE` en un renglón e `IDENTIDAD` en otro—.
   *
   * Vacío para los anclajes ESTRUCTURALES —la MRZ y su emisor—, que no son texto
   * impreso sino una forma, y cuya expresión regular sí es la comprobación
   * correcta: una MRZ se reconoce por su alfabeto y su relleno, no por parecerse
   * a una palabra.
   */
  readonly grafias: readonly string[];
  readonly peso: number;
  /**
   * `true` cuando su ausencia, por sí sola, ya es motivo de sospecha: son los
   * rótulos que TODA cédula de esa generación imprime sin excepción.
   */
  readonly obligatorio: boolean;
  /** Para qué sirve, en una frase que un analista pueda leer en el caso. */
  readonly descripcion: string;
}

/** La plantilla completa de una generación. */
export interface PlantillaDeCedula {
  readonly generacion: BoliviaCiGeneration;
  readonly nombre: string;
  readonly vigenteDesde: string;
  readonly anclajes: readonly AnclajeDeCatalogo[];
  /** Si esa generación imprime zona de lectura mecánica TD1 en el reverso. */
  readonly llevaMrz: boolean;
  /** Si imprime código QR (2020+) o código de barras (2011–2020). */
  readonly codigoOptico: 'QR' | 'BARRAS' | 'NINGUNO';
  /** Años de vigencia habituales de la tarjeta física. */
  readonly vigenciaAnios: readonly number[];
}

/*
 * ── Anclajes comunes a las dos generaciones ────────────────────────────────
 *
 * Se escriben una sola vez y se referencian desde las dos plantillas: dos copias
 * de la misma expresión acaban separándose, y el día que se separen una cédula
 * legítima puntuará distinto según qué generación se le suponga.
 *
 * Todos los patrones se evalúan sobre el texto YA PLEGADO —mayúsculas y sin
 * tildes, `plegarTexto` de `identity-evidence.ts`—, así que aquí no hay
 * variantes acentuadas: `CEDULA`, nunca `CÉDULA`.
 */
