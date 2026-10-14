import type { ExtractedIdentityData } from '../core/domain/extracted-identity.types';
import type { IdentityDocumentType } from '../core/domain/identity-enums';
import type { ColorDelDocumento } from '../core/forensics/document-color';
import type { EvaluacionDeFraude } from '../core/forensics/identity-fraud.scorer';
import type { ImageQualityAssessment } from '../core/image-quality-assessment.service';
import type { IdentityOptions } from '../core/identity-options';
import { medirEvidenciaDeIdentidad } from '../core/engine/identity-evidence';
import { mrzDiagnostics } from '../core/parsers/mrz-td1';
import type {
  DocumentClassificationResult,
  DocumentFraming,
  DocumentOcrResult,
  FaceMatchResult,
  LivenessResult,
} from '../core/ports/identity.ports';
import { maskDocumentNumber, type IdentityVerificationOutcome } from '../identity-result';
import { resumenOcr } from './document-reading';
import type { reachVerdict } from './identity-verdict';

/** Todo lo que se recogió a lo largo de las etapas y el resultado persistido resume. */
export interface OutcomeFacts {
  options: IdentityOptions;
  decision: ReturnType<typeof reachVerdict>;
  tipoResuelto: IdentityDocumentType;
  country: string;
  classification: DocumentClassificationResult;
  evidencia: ReturnType<typeof medirEvidenciaDeIdentidad>;
  fields: ExtractedIdentityData;
  documentQuality: ImageQualityAssessment;
  selfieQuality: ImageQualityAssessment;
  liveness: LivenessResult;
  match: FaceMatchResult | null;
  riskFlags: readonly string[];
  fraude: EvaluacionDeFraude | null;
  encuadre: DocumentFraming;
  escaneado: boolean;
  colorDelAnverso: ColorDelDocumento | null;
  ocr: DocumentOcrResult;
  front: DocumentOcrResult;
  back: DocumentOcrResult | null;
  documentFaceProvider: string;
}

/** Arma el resultado de la verificación a partir de lo que dejó cada etapa. */
export function assembleOutcome(facts: OutcomeFacts): IdentityVerificationOutcome {
  const {
    options,
    decision,
    tipoResuelto,
    country,
    classification,
    evidencia,
    fields,
    documentQuality,
    selfieQuality,
    liveness,
    match,
    riskFlags,
    fraude,
    encuadre,
    escaneado,
    colorDelAnverso,
    ocr,
    front,
    back,
  } = facts;
  return {
    decision: decision.decision,
    reasonCodes: decision.reasonCodes,
    calibratedFaceDecision: decision.calibratedFaceDecision,
    thresholdProfileVersion: options.thresholdProfileVersion,
    documentType: tipoResuelto,
    documentCountry: country,
    classification: {
      confidence: classification.confidence,
      signals: classification.signals,
    },
    documentEvidence: {
      confidence: evidencia.confidence,
      signals: [...evidencia.signals],
      contraindicator: evidencia.contraindicator,
    },
    // El número de documento va enmascarado también aquí, no sólo en la
    // pantalla: lo que se guarda en la fila es este objeto, y una consola de
    // base de datos leería el original.
    fields: {
      ...fields,
      ...(fields.documentNumber
        ? {
            documentNumber: {
              ...fields.documentNumber,
              value: maskDocumentNumber(fields.documentNumber.value),
            },
          }
        : {}),
    },
    quality: {
      document: { score: documentQuality.score, warnings: documentQuality.warnings },
      selfie: { score: selfieQuality.score, warnings: selfieQuality.warnings },
    },
    liveness: {
      outcome: liveness.outcome,
      ...(liveness.score !== undefined ? { score: liveness.score } : {}),
      provider: liveness.provider,
    },
    faceMatch: match
      ? {
          similarityScore: match.similarityScore,
          comparable: match.comparable,
          ...(match.notComparableReason ? { notComparableReason: match.notComparableReason } : {}),
          provider: match.provider,
          ...(match.modelVersion ? { modelVersion: match.modelVersion } : {}),
        }
      : null,
    riskFlags: [...new Set(riskFlags)],
    /*
     * El análisis de autenticidad viaja ENTERO al resultado, con su desglose y
     * con las pruebas que no se pudieron ejecutar.
     *
     * Es lo que convierte «sospecha de fraude» en algo revisable. Quien abre el
     * caso tiene que poder ver QUÉ saltó —la plantilla incompleta, la MRZ que
     * no cuadra con el anverso, el muaré de una pantalla— porque su trabajo es
     * contradecir a la máquina cuando la máquina se equivoca, y un número
     * suelto no se puede contradecir.
     */
    ...(fraude ? { fraud: fraude } : {}),
    framing: {
      recortado: encuadre.recortado,
      areaConservada: Number(encuadre.areaConservada.toFixed(3)),
    },
    /*
     * Sólo con el escáner del sistema, y a propósito: con el origen ausente o
     * `camera` el resultado sale idéntico al de siempre, campo por campo.
     */
    ...(escaneado
      ? {
          capture: {
            source: 'system_scanner' as const,
            color: colorDelAnverso,
          },
        }
      : {}),
    providers: {
      ocr: front.provider,
      face: facts.documentFaceProvider,
      liveness: liveness.provider,
    },
    diagnostics: {
      ocr: {
        front: resumenOcr(front),
        ...(back ? { back: resumenOcr(back) } : {}),
      },
      mrz: mrzDiagnostics(ocr.rawText),
    },
  };
}
