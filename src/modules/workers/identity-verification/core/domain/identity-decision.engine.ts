import { IdentityDecision } from './identity-enums';

/**
 * Motor de decisión del worker de identidad: el núcleo, y la parte que la
 * integración no debe tocar sin motivo.
 *
 * El orden importa y es deliberado: los rechazos incondicionales se evalúan
 * antes que nada, una comparación biométrica claramente fallida sigue siendo un
 * rechazo aunque haya avisos de calidad, y sólo lo genuinamente ambiguo se
 * escala a una persona.
 *
 * ## Lo único que ha cambiado desde el paquete original
 *
 * **Quién puede firmar un rechazo.** Dos de los tres rechazos incondicionales de
 * este motor se apoyaban en cifras sin calibrar; ahora cada uno exige su perfil:
 * el cotejo facial ya lo exigía (`THRESHOLD_PROFILE_MISSING`) y la prueba de
 * vida lo exige desde el corpus de identidad, que devuelve sus dos cortes con la
 * etiqueta `NO_USAR_COMO_RECHAZO_AUTOMATICO`. Sin perfil, el caso escala; con
 * perfil, se decide. Ninguna de las dos rutas aprueba de más.
 *
 * Es código de dominio puro: sin decoradores, sin E/S y sin reloj propio —`now`
 * lo entrega quien llama, de modo que la decisión es reproducible—.
 */

export interface IdentityDecisionInput {
  documentQuality: number;
  requiredFieldsPresent: boolean;
  selfieQuality: number;
  liveness: 'PASSED' | 'FAILED' | 'NOT_RUN' | 'INCONCLUSIVE';
  /**
   * Si los cortes de la prueba de vida salen de un perfil CALIBRADO.
   *
   * Gobierna la única decisión que este motor toma sobre la vida, y por omisión
   * es `false`: sin calibración, un fallo de vida escala a una persona en vez de
   * rechazar. Ver `IdentityOptions.livenessProfileVersion`.
   */
  livenessCalibrated?: boolean;
  faceSimilarity: number | null;
  /** Caducidad impresa en el documento, o `null` si no se pudo leer. */
  documentExpiresAt?: Date | null;
  /** Días de gracia tras la caducidad impresa. Por omisión, ninguno. */
  documentExpiryGraceDays?: number;
  now: Date;
  matchThreshold?: number;
  reviewThreshold?: number;
  minDocumentQuality: number;
  minSelfieQuality: number;
}

export interface IdentityDecisionResult {
  decision: IdentityDecision;
  reasonCodes: string[];
  calibratedFaceDecision: 'MATCH' | 'REVIEW' | 'NO_MATCH' | 'UNAVAILABLE';
}

const DAY_MS = 86_400_000;

export class IdentityDecisionEngine {
  decide(input: IdentityDecisionInput): IdentityDecisionResult {
    // 1. Rechazos incondicionales.
    /*
     * Un fallo de vida rechaza SÓLO si sus cortes están calibrados.
     *
     * Aquí rechazaba siempre, y eso convertía dos números del encargo —0,55 y
     * 0,35— en el veredicto sobre la identidad de una persona. El corpus los
     * devuelve con la etiqueta `NO_USAR_COMO_RECHAZO_AUTOMATICO`, población
     * «ninguna calibración real declarada», y su política de producción deja los
     * dos umbrales del PAD en `null` con `auto_reject_fraud_enabled: false`.
     *
     * No es un aflojamiento: un ataque de presentación sigue sin aprobarse
     * nunca. Lo que cambia es quién firma el «no»: con calibración, el worker;
     * sin ella, una persona. Y lo que se gana es poder defender el rechazo —una
     * tasa de falsas acusaciones sobre legítimos que nadie ha medido no se puede
     * enseñar en una reclamación—.
     */
    if (input.liveness === 'FAILED') {
      return input.livenessCalibrated === true
        ? this.result(IdentityDecision.NOT_VERIFIED, ['LIVENESS_FAILED'], 'NO_MATCH')
        : this.result(
            IdentityDecision.REVIEW_REQUIRED,
            ['LIVENESS_FAILED', 'LIVENESS_PROFILE_UNCALIBRATED'],
            'REVIEW',
          );
    }
    if (this.isExpired(input)) {
      return this.result(IdentityDecision.NOT_VERIFIED, ['DOCUMENT_EXPIRED'], 'NO_MATCH');
    }

    // 2. Señales que por sí solas sólo justifican una segunda mirada.
    const reasons: string[] = [];
    if (input.documentQuality < input.minDocumentQuality) reasons.push('LOW_DOCUMENT_CONFIDENCE');
    if (input.selfieQuality < input.minSelfieQuality) reasons.push('LOW_FACE_QUALITY');
    if (!input.requiredFieldsPresent) reasons.push('DOCUMENT_FIELD_INCONSISTENCY');
    if (input.documentExpiresAt === null || input.documentExpiresAt === undefined) {
      reasons.push('DOCUMENT_EXPIRY_UNKNOWN');
    }
    if (input.liveness === 'INCONCLUSIVE') reasons.push('LIVENESS_UNCERTAIN');

    // 3. Sin resultado biométrico utilizable: no concluyente, nunca un rechazo.
    if (input.faceSimilarity === null) {
      return this.result(
        IdentityDecision.INCONCLUSIVE,
        [...reasons, 'FACE_MATCH_UNAVAILABLE'],
        'UNAVAILABLE',
      );
    }
    if (input.matchThreshold === undefined || input.reviewThreshold === undefined) {
      return this.result(
        IdentityDecision.REVIEW_REQUIRED,
        [...reasons, 'THRESHOLD_PROFILE_MISSING'],
        'REVIEW',
      );
    }

    // 4. Un no-parecido claro sigue siendo rechazo aunque haya avisos de calidad.
    if (input.faceSimilarity < input.reviewThreshold) {
      return this.result(IdentityDecision.NOT_VERIFIED, [...reasons, 'FACE_NO_MATCH'], 'NO_MATCH');
    }

    // 5. Lo que aún arrastre un aviso va a una persona.
    if (reasons.length > 0) return this.result(IdentityDecision.REVIEW_REQUIRED, reasons, 'REVIEW');

    // 6. Ejecución limpia.
    if (input.faceSimilarity >= input.matchThreshold) {
      return this.result(IdentityDecision.VERIFIED, [], 'MATCH');
    }
    return this.result(IdentityDecision.REVIEW_REQUIRED, ['AMBIGUOUS_MATCH'], 'REVIEW');
  }

  private isExpired(input: IdentityDecisionInput): boolean {
    if (!input.documentExpiresAt) return false;
    const graceDays = Math.max(0, input.documentExpiryGraceDays ?? 0);
    return input.now.getTime() > input.documentExpiresAt.getTime() + graceDays * DAY_MS;
  }

  private result(
    decision: IdentityDecision,
    reasonCodes: string[],
    calibratedFaceDecision: IdentityDecisionResult['calibratedFaceDecision'],
  ): IdentityDecisionResult {
    return { decision, reasonCodes, calibratedFaceDecision };
  }
}
