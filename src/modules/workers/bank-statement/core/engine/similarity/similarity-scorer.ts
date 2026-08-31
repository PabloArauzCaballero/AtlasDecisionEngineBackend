/**
 * Compara un documento contra las señales que su entidad debería traer, y
 * devuelve cuánto se parece.
 *
 * ## Qué es y qué NO es
 *
 * Es una MEDIDA, no una compuerta. Devuelve un porcentaje con la lista de lo que
 * encontró y lo que faltó, y quien lo consume decide qué hacer. Esa separación
 * es deliberada: las cuatro compuertas del worker responden preguntas con un sí
 * o un no verificable —«¿lo produjo un editor?», «¿tiene licencia?»— y ésta no
 * tiene esa forma. «Se parece un 62 %» no es un veredicto; convertirlo en uno
 * dentro de este archivo escondería el umbral donde nadie lo discute.
 *
 * ## Por qué el parecido puede RESCATAR pero nunca rechazar
 *
 * Porque las dos direcciones no son simétricas. Parecerse mucho a los extractos
 * del BNB es evidencia POSITIVA —cuesta trabajo producirla, sobre todo la parte
 * del contenedor— y sirve para sostener un documento que otra señal dejó en
 * duda. No parecerse es una ausencia, y las ausencias tienen mil causas
 * inocentes: el banco cambió su maqueta el mes pasado, el descriptor está
 * incompleto, el PDF venía escaneado y el texto salió con otro espaciado.
 * Rechazar por no parecerse castigaría al cliente por lo que no sabemos de su
 * banco.
 *
 * Y el rescate exige que el descriptor sea `MEASURED`: una hipótesis escrita a
 * mano no puede levantar la sospecha de nadie. Ver `institution-signals.ts`.
 */

import type { PdfProvenance } from '../authenticity/pdf-forensics';
import type { ExpectedSignal, InstitutionSignalDescriptor } from './institution-signals';

/** Qué se le enseña al comparador del documento que tiene delante. */
export interface DocumentFingerprint {
  /** Los primeros renglones: donde la entidad se identifica. */
  readonly cover: string;
  /** Todo el texto extraído. */
  readonly fullText: string;
  /** Encabezados de la tabla de movimientos, ya reconocidos. */
  readonly columnHeaders: readonly string[];
  /** Lo que el contenedor declara de sí mismo. */
  readonly provenance: Pick<PdfProvenance, 'producer' | 'creator'>;
}

export interface SignalMatch {
  readonly id: string;
  readonly scope: string;
  readonly weight: number;
  readonly matched: boolean;
}

export type SimilarityVerdict =
  /** Se parece a los extractos de la entidad por varios caminos a la vez. */
  | 'MATCH'
  /** Coincide en parte. Ni corrobora ni desmiente. */
  | 'PARTIAL'
  /** No se parece. NO es un rechazo: ver la cabecera del archivo. */
  | 'MISMATCH'
  /** No hay descriptor para esta entidad, así que no hay nada que comparar. */
  | 'NO_DESCRIPTOR';

export interface SimilarityAssessment {
  readonly verdict: SimilarityVerdict;
  /** 0..100. Proporción del peso encontrado sobre el peso total esperado. */
  readonly score: number;
  /** Qué entidad se comparó, y con qué descriptor. */
  readonly institutionCode: string | null;
  readonly descriptorVersion: number | null;
  readonly descriptorProvenance: string | null;
  readonly sampleSize: number | null;
  /**
   * Si este parecido puede usarse para sostener un documento dudoso.
   *
   * Sólo con descriptor medido y por encima del umbral de coincidencia. Es una
   * propiedad del RESULTADO y no una decisión de quien lo lee, para que la regla
   * viva en un sitio y no en cada consumidor.
   */
  readonly corroborates: boolean;
  readonly signals: readonly SignalMatch[];
  /** Señales obligatorias que faltaron. Vacío casi siempre. */
  readonly missingRequired: readonly string[];
}

/**
 * Qué se hace con el parecido medido.
 *
 * No existe un modo que RECHACE, y la ausencia es la decisión de diseño de este
 * módulo: ver la cabecera del archivo. Los tres modos se distinguen sólo en el
 * efecto, nunca en la medida — el porcentaje se calcula igual en los tres, que
 * es lo que permite estrenar `CORROBORATE` sabiendo de antemano a cuántos
 * documentos habría afectado.
 */
export type SimilarityMode =
  /** Ni se mide ni se publica. Para apagarlo sin desplegar. */
  | 'OFF'
  /** Se mide y se publica con el resultado. No cambia ningún desenlace. */
  | 'MEASURE'
  /** Además puede sostener un documento que el contenedor dejó en duda. */
  | 'CORROBORATE';

export interface SimilarityThresholds {
  /** Desde aquí se considera que el documento se parece. */
  readonly matchScore: number;
  /** Por debajo de aquí no se parece en nada reconocible. */
  readonly partialScore: number;
  /** Muestra mínima para que un descriptor medido pueda corroborar. */
  readonly minimumSampleSize: number;
}

/**
 * Umbrales por defecto.
 *
 * `matchScore` en 70 y no en 90 porque las señales se ponderan y no se cuentan:
 * un documento que traiga las tres caras —carátula, columnas y generador— pasa
 * de 70 aunque le falten rótulos menores, y ése es justo el caso que interesa
 * reconocer. Pedir 90 exigiría que el descriptor estuviera completo, y ningún
 * descriptor lo está el día que se escribe.
 *
 * `minimumSampleSize` en 3 por lo mismo que la política de meses pide tres
 * observaciones: con uno o dos documentos no se sabe qué parte de lo observado
 * es la plantilla del banco y qué parte es ese cliente.
 */
export const DEFAULT_SIMILARITY_THRESHOLDS: SimilarityThresholds = {
  matchScore: 70,
  partialScore: 35,
  minimumSampleSize: 3,
};

const SIN_DESCRIPTOR: SimilarityAssessment = {
  verdict: 'NO_DESCRIPTOR',
  score: 0,
  institutionCode: null,
  descriptorVersion: null,
  descriptorProvenance: null,
  sampleSize: null,
  corroborates: false,
  signals: [],
  missingRequired: [],
};

/**
 * El comparador.
 *
 * Es una función y no una clase con estado porque no tiene ninguno: recibe el
 * documento y el descriptor, y devuelve la comparación. Tenerlo así es lo que
 * permite ejecutarlo sobre un corpus entero desde un script —que es como se
 * calibran los umbrales— sin construir el motor.
 */
export function assessSimilarity(
  fingerprint: DocumentFingerprint,
  descriptor: InstitutionSignalDescriptor | undefined,
  thresholds: SimilarityThresholds = DEFAULT_SIMILARITY_THRESHOLDS,
): SimilarityAssessment {
  if (!descriptor || descriptor.signals.length === 0) return SIN_DESCRIPTOR;

  const matches: SignalMatch[] = [];
  const missingRequired: string[] = [];
  let found = 0;
  let total = 0;

  for (const signal of descriptor.signals) {
    const matched = signal.pattern.test(haystack(fingerprint, signal));
    total += signal.weight;
    if (matched) found += signal.weight;
    else if (signal.required) missingRequired.push(signal.id);
    matches.push({ id: signal.id, scope: signal.scope, weight: signal.weight, matched });
  }

  /*
   * Una obligatoria ausente pone el parecido en cero y no resta su peso. Es la
   * diferencia entre «le falta una señal» y «esto no es un extracto de esta
   * entidad»: si el banco imprime SIEMPRE su aviso de supervisión y aquí no está,
   * la suma del resto no describe nada, porque lo que se está midiendo ya no es
   * el mismo documento.
   */
  const score =
    missingRequired.length > 0 ? 0 : total === 0 ? 0 : Math.round((found / total) * 100);

  const verdict: SimilarityVerdict =
    score >= thresholds.matchScore
      ? 'MATCH'
      : score >= thresholds.partialScore
        ? 'PARTIAL'
        : 'MISMATCH';

  return {
    verdict,
    score,
    institutionCode: descriptor.institutionCode,
    descriptorVersion: descriptor.version,
    descriptorProvenance: descriptor.provenance,
    sampleSize: descriptor.sampleSize,
    corroborates:
      verdict === 'MATCH' &&
      descriptor.provenance === 'MEASURED' &&
      descriptor.sampleSize >= thresholds.minimumSampleSize,
    signals: matches,
    missingRequired,
  };
}

/** Dónde se busca cada señal. Buscarlas todas en todo diluiría el descriptor. */
function haystack(fingerprint: DocumentFingerprint, signal: ExpectedSignal): string {
  switch (signal.scope) {
    case 'COVER':
      return fingerprint.cover;
    case 'COLUMNS':
      return fingerprint.columnHeaders.join(' | ');
    case 'PRODUCER':
      return `${fingerprint.provenance.producer ?? ''} ${fingerprint.provenance.creator ?? ''}`;
    case 'DOCUMENT':
    default:
      return fingerprint.fullText;
  }
}

/**
 * La frase con la que el parecido se cuenta en la traza y en la pantalla.
 *
 * Lleva el denominador dentro a propósito: «91 % contra un patrón medido sobre 3
 * documentos» y «91 %» a secas invitan a confianzas muy distintas, y el número
 * solo se acaba citando como si fuera una probabilidad.
 */
export function similarityLabel(assessment: SimilarityAssessment): string {
  if (assessment.verdict === 'NO_DESCRIPTOR') {
    return 'sin descriptor de señales para esta entidad';
  }
  const base = `${String(assessment.score)} % de coincidencia con ${assessment.institutionCode ?? '?'}`;
  if (assessment.descriptorProvenance === 'MEASURED') {
    return `${base} (patrón medido sobre ${String(assessment.sampleSize ?? 0)} documento(s))`;
  }
  return `${base} (patrón declarado a mano, sólo informativo)`;
}
