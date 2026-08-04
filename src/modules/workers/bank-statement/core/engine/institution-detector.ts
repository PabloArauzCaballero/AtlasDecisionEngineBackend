import { Injectable } from '@nestjs/common';
import type { ExtractedPdf } from '../domain/models';
import {
  BOLIVIA_INSTITUTIONS,
  type BoliviaInstitution,
} from '../institutions/bolivia-institutions';
import {
  coverText,
  UNKNOWN_INSTITUTION_CODE,
  type InstitutionDetection,
} from './statement-context';

/**
 * Señales que no dependen del registro de entidades y que permiten decir «esto
 * lo emitió un banco» aunque no se sepa cuál. Alimentan la confianza del
 * resultado desconocido, que es distinta de cero: un documento con dominio
 * bancario y aviso de supervisión no está tan huérfano como uno sin nada.
 */
const GENERIC_SIGNALS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'supervision-asfi', pattern: /supervisad[ao]\s+por\s+ASFI|\bASFI\b/i },
  {
    id: 'dominio-bancario',
    pattern: /\bwww\.[a-z0-9-]*(?:banco|bank|coop|mutual|financiera)[a-z0-9-]*\.[a-z.]+/i,
  },
  {
    id: 'razon-social-financiera',
    pattern:
      /\b(?:banco|cooperativa|mutual|financiera|fintech)\b[^\n]{0,40}\b(?:s\.?a\.?|r\.?l\.?|ltda\.?)\b/i,
  },
  { id: 'codigo-de-cuenta', pattern: /\bcuenta\b\s*:?\s*[\dxX*-]{6,}/i },
];

/** Confianza según cuántos marcadores propios de la entidad coincidieron. */
const SINGLE_MARKER_CONFIDENCE = 0.75;
const MULTIPLE_MARKER_CONFIDENCE = 0.95;

/** Confianza máxima de un documento que se ve bancario pero no se atribuye. */
const GENERIC_SIGNAL_WEIGHT = 0.15;

/**
 * Identifica la entidad emisora combinando varias señales sobre la carátula.
 *
 * Sustituye a la llamada suelta a `detectInstitution()` que vivía dentro de la
 * ruta de error del worker, y añade dos cosas que allí no existían: una
 * confianza derivada de cuántos marcadores coincidieron, y un resultado
 * **explícito** para lo desconocido. Que no se identifique la entidad ya no
 * impide procesar el documento.
 */
@Injectable()
export class InstitutionDetector {
  detect(pdf: ExtractedPdf): InstitutionDetection {
    const cover = coverText(pdf);
    const matched = this.matchInstitution(cover);
    const generic = GENERIC_SIGNALS.filter((signal) => signal.pattern.test(cover)).map(
      (signal) => signal.id,
    );

    if (!matched) {
      return {
        code: UNKNOWN_INSTITUTION_CODE,
        detected: false,
        confidence: Number(Math.min(0.45, generic.length * GENERIC_SIGNAL_WEIGHT).toFixed(2)),
        signals: generic,
      };
    }

    const { institution, hits } = matched;
    return {
      code: institution.code,
      name: institution.name,
      detected: true,
      confidence: hits > 1 ? MULTIPLE_MARKER_CONFIDENCE : SINGLE_MARKER_CONFIDENCE,
      signals: [`marcadores-de-entidad:${hits}`, ...generic],
    };
  }

  /**
   * Gana la entidad con más marcadores coincidentes; a igualdad, la primera del
   * registro. Contar en lugar de quedarse con la primera coincidencia evita que
   * un marcador amplio de una entidad se imponga a otro más específico.
   */
  private matchInstitution(
    cover: string,
  ): { institution: BoliviaInstitution; hits: number } | undefined {
    let best: { institution: BoliviaInstitution; hits: number } | undefined;
    for (const institution of BOLIVIA_INSTITUTIONS) {
      const hits = institution.markers.filter((marker) => marker.test(cover)).length;
      if (hits === 0) continue;
      if (!best || hits > best.hits) best = { institution, hits };
    }
    return best;
  }
}
