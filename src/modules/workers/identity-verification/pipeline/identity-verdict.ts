import { cuentaComoLeido } from '../core/engine/second-reader';
import { IdentityDecision } from '../core/domain/identity-enums';
import type { IdentityDecisionEngine } from '../core/domain/identity-decision.engine';
import type { ExtractedIdentityData } from '../core/domain/extracted-identity.types';
import type { ColorDelDocumento } from '../core/forensics/document-color';
import type { EvaluacionDeFraude } from '../core/forensics/identity-fraud.scorer';
import { SENALES_DE_VIDA } from '../core/forensics/selfie-liveness';
import type { IdentityOptions } from '../core/identity-options';
import type { FaceMatchResult, LivenessResult } from '../core/ports/identity.ports';
import { isoDateToUtcDate } from '../core/parsers/spanish-date';
import { DOCUMENT_CAPTURE_SOURCES_MEASURED } from '../document-capture-source';
import type { IdentityPipelineInput } from './identity-pipeline-input';

/**
 * Lo mínimo para poder afirmar que se leyó un documento y no una cartulina.
 *
 * **Un campo con procedencia `MODEL` no cuenta.** Lo propuso un modelo mirando
 * la imagen y no lo corroboró la MRZ, así que sostiene una revisión humana —el
 * dato llega escrito y la persona sólo lo confirma— pero no puede sostener una
 * aprobación automática. Sin este filtro, encender el segundo lector convertiría
 * en `VERIFIED` casos que hoy van a la bandeja, que es exactamente la autoridad
 * que no se le quiso dar. Ver `core/engine/second-reader.ts`.
 */
function requiredFieldsPresent(fields: ExtractedIdentityData): boolean {
  const nombre = [fields.fullName, fields.firstNames, fields.lastNames].some(
    (campo) => Boolean(campo?.value) && cuentaComoLeido(campo?.source),
  );
  const numero =
    Boolean(fields.documentNumber?.value) && cuentaComoLeido(fields.documentNumber?.source);
  return numero && nombre;
}

/** Marcas de riesgo sobre contra QUÉ se decidió: perfil de umbral y población de la captura. */
export function thresholdAndCaptureFlags(
  options: IdentityOptions,
  input: IdentityPipelineInput,
  colorDelAnverso: ColorDelDocumento | null,
): { riskFlags: string[]; poblacionSinMedir: boolean } {
  const riskFlags: string[] = [];
  /*
   * Que el umbral NO esté medido contra personas viaja en el resultado.
   *
   * Los cortes del compose —0,8824 y 0,7789— salieron de `calibrar-identidad`
   * sobre los rostros DIBUJADOS de `fixtures/identity-faces.ts`, y el nombre
   * del perfil lo dice. El esquema de entorno ya prohíbe ese perfil en
   * producción, pero en desarrollo y en las pruebas decidía en silencio: quien
   * leía un `AMBIGUOUS_MATCH` no tenía forma de saber que la cifra que lo
   * produjo no predice ninguna tasa de error sobre caras reales.
   *
   * Es una marca, no una escalada. Escalar por esto mandaría a revisión toda
   * verificación de todo entorno no calibrado, que es lo mismo que apagar el
   * worker; lo que hace falta es que el caso DIGA contra qué se decidió.
   */
  if (/^sintetico/i.test(options.thresholdProfileVersion)) {
    riskFlags.push('THRESHOLD_PROFILE_UNMEASURED');
  }
  /*
   * Y lo mismo cuando la POBLACIÓN de la imagen no está medida, aunque el
   * perfil sí lo esté.
   *
   * El perfil se calibró con fotografías de cédulas; una imagen del escáner
   * del sistema es otra cosa —recortada, con la perspectiva corregida,
   * recodificada, a veces sin color— y nadie ha medido todavía cómo la ven el
   * catálogo y el forense. Hasta que la fase 5 del plan del escáner lo mida,
   * el caso lo dice con la misma marca, y `DOCUMENT_CAPTURE_SYSTEM_SCANNER`
   * dice por qué. Las tres marcas de este bloque no están en `escalantes` ni las
   * ve el motor de decisión: un VERIFICADO sigue VERIFICADO. La única que pesa
   * es `DOCUMENT_GRAYSCALE`, y sólo hacia una persona: ver `grisSinMedir` más
   * abajo. Ver `docs/workers/identidad-escaner-del-sistema.md`.
   */
  if (input.documentCaptureSource === 'system_scanner') {
    riskFlags.push('DOCUMENT_CAPTURE_SYSTEM_SCANNER');
  }
  const poblacionSinMedir =
    input.documentCaptureSource != null &&
    !DOCUMENT_CAPTURE_SOURCES_MEASURED.has(input.documentCaptureSource);
  if (poblacionSinMedir) riskFlags.push('THRESHOLD_PROFILE_UNMEASURED');
  // El filtro gris o B/N de iOS: se pierde el retrato en color y la bandera.
  if (colorDelAnverso?.sinColor) riskFlags.push('DOCUMENT_GRAYSCALE');
  return { riskFlags, poblacionSinMedir };
}

/** Todo lo que el veredicto necesita saber de las etapas anteriores. */
export interface VerdictFacts {
  documentQualityScore: number;
  selfieQualityScore: number;
  fields: ExtractedIdentityData;
  liveness: LivenessResult;
  match: FaceMatchResult | null;
  riskFlags: readonly string[];
  fraude: EvaluacionDeFraude | null;
  poblacionSinMedir: boolean;
  colorDelAnverso: ColorDelDocumento | null;
}

/** El veredicto final: el motor de decisión más las escaladas que el motor no ve. */
export function reachVerdict(
  engine: IdentityDecisionEngine,
  options: IdentityOptions,
  facts: VerdictFacts,
) {
  const { fields, liveness, match, riskFlags, fraude, poblacionSinMedir, colorDelAnverso } = facts;
  // --- 8. Decisión --------------------------------------------------------
  const decided = engine.decide({
    documentQuality: facts.documentQualityScore,
    selfieQuality: facts.selfieQualityScore,
    requiredFieldsPresent: requiredFieldsPresent(fields),
    liveness: liveness.outcome,
    // Sin perfil de vida calibrado, un fallo escala en vez de rechazar.
    livenessCalibrated:
      options.livenessProfileVersion !== 'unconfigured' &&
      options.livenessProfileVersion.trim().length > 0,
    faceSimilarity: match && match.comparable ? match.similarityScore : null,
    documentExpiresAt: isoDateToUtcDate(fields.expirationDate?.value),
    // Sólo para decidir si una fecha vencida puede rechazar por sí sola: desde los 58 años la
    // cédula puede ser de vigencia indefinida y esa fecha no prueba nada.
    dateOfBirth: isoDateToUtcDate(fields.dateOfBirth?.value),
    documentExpiryGraceDays: options.documentExpiryGraceDays,
    now: new Date(),
    ...(options.matchThreshold !== undefined ? { matchThreshold: options.matchThreshold } : {}),
    ...(options.reviewThreshold !== undefined ? { reviewThreshold: options.reviewThreshold } : {}),
    minDocumentQuality: options.minDocumentQuality,
    minSelfieQuality: options.minSelfieQuality,
  });

  /*
   * Varios rostros en el documento ESCALAN, no se anotan y ya está.
   *
   * El motor de decisión no ve esta señal —trabaja con calidades, campos,
   * prueba de vida y parecido—, así que dejarla sólo como marca de riesgo
   * permitiría un VERIFICADO sobre un documento en el que hay dos caras, que
   * es la firma de una composición. El paquete original mandaba estos casos a
   * revisión manual y aquí se conserva. Nunca al revés: un rechazo no se
   * suaviza a revisión por esto.
   *
   * `FACE_TOO_SMALL` entra por la misma puerta desde que la selfie dejó de
   * rechazarse por puntaje: el rostro se detectó y se comparó, así que hay
   * cifra, pero un rostro que ocupa una parte diminuta del encuadre no debe
   * poder cerrar un VERIFICADO él solo. Escalar conserva la cautela que hacía
   * el rechazo sin negarle un veredicto a quien mandó una foto pequeña.
   */
  /*
   * La autenticidad del documento entra por la MISMA puerta.
   *
   * El motor de decisión no ve el análisis de fraude —trabaja con calidades,
   * campos, prueba de vida y parecido—, así que dejarlo sólo como marca de
   * riesgo permitiría un VERIFICADO sobre un documento del que se sospecha que
   * está falsificado. Que sea el mismo mecanismo que ya escalaba
   * `MULTIPLE_FACES` no es casual: son la misma clase de señal —evidencia que
   * la aritmética biométrica no puede ver— y merecen el mismo trato.
   *
   * Y como allí, sólo escala hacia ARRIBA: un rechazo nunca se suaviza a
   * revisión porque el documento parezca auténtico. Que el carnet sea legítimo
   * no convierte en la misma persona a las dos caras que se compararon.
   */
  /*
   * Las señales de vida de la selfie escalan por esta MISMA puerta.
   *
   * Y tienen que hacerlo, porque son la única clase de señal del worker que el
   * motor de decisión ve exactamente al revés. Un parecido de 0,98 le llega
   * como la mejor comparación posible y cierra un VERIFICADO él solo; lo que
   * significa de verdad es que no hay dos fotos. Dejarlo como marca de riesgo
   * habría sido escribir la sospecha al lado de la aprobación que la sospecha
   * contradice.
   */
  const escalantes = [
    'MULTIPLE_FACES',
    'FACE_TOO_SMALL',
    SENALES_DE_VIDA.parecidoImposible,
    SENALES_DE_VIDA.selfieRefotografiada,
  ].filter((flag) => riskFlags.includes(flag));
  if (fraude && fraude.veredicto !== 'CLEAR') {
    escalantes.push(
      fraude.veredicto === 'FRAUD_SUSPECTED'
        ? 'DOCUMENT_FRAUD_SUSPECTED'
        : 'DOCUMENT_AUTHENTICITY_DOUBTFUL',
    );
  }
  /*
   * Un «no es la misma persona» sobre un anverso SIN COLOR de una población no
   * medida no lo firma el worker: lo firma una persona.
   *
   * El filtro «Escala de grises» o «Blanco y negro» del escáner de iOS quita el
   * color al retrato del carnet, y la selfie llega en color. Sobre las cédulas
   * dibujadas eso solo ya baja el parecido de 0,95 a 0,72 y convierte en
   * `FACE_NO_MATCH` a quien sí era la misma persona. Con rostros dibujados no
   * se sabe cuánto pasa con uno real, y ésa es justo la razón: rechazar por una
   * cifra que el filtro del teléfono pudo hundir, sin haberlo medido, sería
   * acusar a alguien por haber tocado un botón de su móvil.
   *
   * Es el mismo criterio que la prueba de vida sin calibrar
   * (`LIVENESS_PROFILE_UNCALIBRATED` en `identity-decision.engine.ts`): no se
   * afloja nada —un parecido bajo NUNCA se aprueba—, cambia quién dice «no».
   * Y es estrecho a propósito:
   * - sólo el rechazo por parecido (`FACE_NO_MATCH`); un documento vencido o
   *   una prueba de vida calibrada que falla siguen rechazando;
   * - sólo si el anverso se MIDIÓ sin color; con color, o sin medida, nada;
   * - sólo para una población no medida: con la cámara no se mide el color y
   *   su camino no cambia; cuando la fase 5 declare medido el escáner, esto
   *   deja de aplicarse sin tocar el código.
   */
  const grisSinMedir =
    poblacionSinMedir &&
    colorDelAnverso?.sinColor === true &&
    decided.decision === IdentityDecision.NOT_VERIFIED &&
    decided.reasonCodes.includes('FACE_NO_MATCH');
  const decidido = grisSinMedir
    ? {
        decision: IdentityDecision.REVIEW_REQUIRED,
        reasonCodes: [...decided.reasonCodes, 'DOCUMENT_GRAYSCALE'],
        calibratedFaceDecision: 'REVIEW' as const,
      }
    : decided;
  const decision =
    escalantes.length > 0 && decidido.decision === IdentityDecision.VERIFIED
      ? {
          decision: IdentityDecision.REVIEW_REQUIRED,
          reasonCodes: [...decidido.reasonCodes, ...escalantes],
          calibratedFaceDecision: 'REVIEW' as const,
        }
      : decidido;
  return decision;
}
