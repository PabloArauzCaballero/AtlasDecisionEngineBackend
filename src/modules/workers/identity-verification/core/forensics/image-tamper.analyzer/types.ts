export interface SenalDeManipulacion {
  readonly codigo: string;
  readonly detalle: string;
  /** Cuánto suma al riesgo, en `[0, 1]`. */
  readonly peso: number;
}

export interface AnalisisDeManipulacion {
  readonly disponible: boolean;
  readonly senales: readonly SenalDeManipulacion[];
  /** Las medidas crudas, para la traza: sin ellas un veredicto no se puede discutir. */
  readonly medidas: {
    readonly periodicidad: number | null;
    readonly residuoMaximoRelativo: number | null;
    readonly bloquesAtipicos: number | null;
    readonly variacionDelRuido: number | null;
    readonly marcoUniforme: number | null;
  };
  readonly indisponibilidad?: string;
}

/** Lado al que se reduce la imagen para analizarla. */
export const LADO_ANALISIS = 512;
/** Tamaño del bloque en el que se trocea la imagen para las medidas locales. */
export const BLOQUE = 32;

export const SIN_MEDIDAS = {
  periodicidad: null,
  residuoMaximoRelativo: null,
  bloquesAtipicos: null,
  variacionDelRuido: null,
  marcoUniforme: null,
} as const;
