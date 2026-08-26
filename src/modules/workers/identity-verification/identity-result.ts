import type { ExtractedIdentityData } from './core/domain/extracted-identity.types';
import type { IdentityDecision, IdentityDocumentType } from './core/domain/identity-enums';
import type { EvaluacionDeFraude } from './core/forensics/identity-fraud.scorer';

/**
 * Lo que la ejecución publica cuando termina bien.
 *
 * Es el contrato que pinta el portal y el que se guarda en `result_json`. Lleva
 * la decisión Y las señales de las que salió —calidad, prueba de vida, parecido,
 * marcas de riesgo—: una decisión sin su evidencia no se puede revisar, y este
 * worker existe justamente para que alguien la revise cuando dice
 * `REVIEW_REQUIRED`.
 */
export interface IdentityVerificationOutcome {
  decision: IdentityDecision;
  reasonCodes: string[];
  calibratedFaceDecision: 'MATCH' | 'REVIEW' | 'NO_MATCH' | 'UNAVAILABLE';
  /** Contra qué calibración se decidió. `unconfigured` si no hay ninguna. */
  thresholdProfileVersion: string;

  documentType: IdentityDocumentType;
  documentCountry: string;
  classification: { confidence: number; signals: string[] };

  /**
   * Cuánta evidencia había de que la imagen fuera un documento de identidad.
   *
   * Es una medida DISTINTA de `classification.confidence`, y separarlas es lo
   * que permitió dejar de contestar lo mismo a dos casos que no se parecen:
   * `classification` dice cuál de los documentos conocidos es —o que no se supo—
   * y esto dice si siquiera hay un documento delante. Con una sola confianza,
   * «es claramente una cédula, no sé de qué país» y «esto es un recibo» se leían
   * igual, y los dos se rechazaban con la misma frase.
   */
  documentEvidence: { confidence: number; signals: string[]; contraindicator: string | null };

  /** Campos leídos del documento, con el número ya enmascarado. */
  fields: ExtractedIdentityData;

  quality: {
    document: { score: number; warnings: string[] };
    selfie: { score: number; warnings: string[] };
  };
  liveness: { outcome: string; score?: number; provider: string };
  faceMatch: {
    similarityScore: number | null;
    comparable: boolean;
    notComparableReason?: string;
    provider: string;
    modelVersion?: string;
  } | null;

  /**
   * Qué se leyó: el documento recortado del fondo, o la imagen entera.
   *
   * Viaja al resultado porque cambia lo que el reconocedor tuvo delante. Ante
   * una lectura pobre, es la primera pregunta —«¿se recortó?»— y sin esto habría
   * que reproducir la ejecución para contestarla.
   */
  framing: { recortado: boolean; areaConservada: number };

  riskFlags: string[];

  /**
   * ¿Es un carnet AUTÉNTICO?
   *
   * `documentEvidence` contesta si hay un documento de identidad delante y
   * `classification` cuál es. Esto contesta la tercera pregunta, que es la única
   * que separa el fraude: el texto de una falsificación es el de un documento
   * auténtico —porque se copió de uno—, así que las dos primeras la aprueban.
   *
   * Ausente cuando la detección está apagada por configuración, y esa ausencia
   * es información: significa que NO SE PREGUNTÓ, que no es lo mismo que
   * preguntarlo y que saliera limpio.
   */
  fraud?: EvaluacionDeFraude;

  providers: { ocr: string; face: string; liveness: string };

  /**
   * El PORQUÉ de la lectura, para la traza de ejecución: cuánto texto entregó
   * el reconocedor por cara y con qué confianza media, y los renglones de la
   * MRZ tal como llegaron —número enmascarado— con qué controles cuadraron.
   *
   * Existe porque «no se encontró la fecha» no se puede depurar y «el renglón
   * llegó con un glifo delante y su control no cuadró» sí: las imágenes se
   * borran al cerrar la ejecución, así que esta es la única evidencia que
   * queda de lo que el OCR tuvo delante.
   */
  diagnostics?: {
    ocr: {
      front: { chars: number; lines: number; meanConfidence: number | null };
      back?: { chars: number; lines: number; meanConfidence: number | null };
    };
    mrz: { found: boolean; lines?: string[]; checks?: Record<string, boolean> };
  };
}

/**
 * Deja visibles los tres últimos dígitos del documento y nada más.
 *
 * Misma decisión que el enmascarado de la cuenta en el worker de extractos: lo
 * que hace falta para reconocer de qué verificación se habla son los últimos
 * dígitos; el número completo es el dato con el que alguien se hace pasar por
 * otro. Se enmascara al construir el resultado, no al pintarlo, porque la fila
 * de la base se lee desde más sitios que la pantalla.
 */
export function maskDocumentNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.trim();
  if (digits.length <= 3) return '•'.repeat(digits.length);
  return `${'•'.repeat(Math.max(3, digits.length - 3))}${digits.slice(-3)}`;
}
