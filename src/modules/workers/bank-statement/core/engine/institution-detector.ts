import { Injectable } from '@nestjs/common';
import type { ExtractedPdf } from '../domain/models';
import { countMarkerHits, type BoliviaInstitution } from '../institutions/bolivia-institutions';
import { ASFI_SEED_REGISTRY, type InstitutionRegistry } from '../institutions/institution-registry';
import { detectNonBankingIssuer } from '../institutions/non-banking-issuers';
import { COMPILED_SIGNAL_DESCRIPTORS } from '../institutions/signal-descriptors';
import {
  coverText,
  UNKNOWN_INSTITUTION_CODE,
  type InstitutionDetection,
} from './statement-context';

/**
 * Señales que no dependen del padrón y que permiten decir «esto lo emitió una
 * entidad financiera» aunque no se sepa cuál. Alimentan la confianza del
 * resultado desconocido, que es distinta de cero: un documento con dominio
 * bancario y aviso de supervisión no está tan huérfano como uno sin nada.
 *
 * Desde que existe la compuerta de emisor son además lo que separa el rechazo
 * de la revisión: un documento sin atribuir pero con estas señales es
 * probablemente de una entidad boliviana cuya carátula no imprime su nombre, y
 * eso lo mira una persona. Sin ninguna de ellas no hay nada que mirar.
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
  /*
   * El aviso del seguro de depósitos sólo lo imprime una entidad que capta
   * depósitos del público, así que es la señal más específica de las cinco: una
   * telefónica no tiene ningún motivo para mencionarlo.
   */
  { id: 'seguro-de-depositos', pattern: /FONDO\s+DE\s+PROTECCI[OÓ]N\s+AL\s+AHORRISTA|\bFPAH\b/i },
];

/** Confianza según cuántos marcadores propios de la entidad coincidieron. */
const SINGLE_MARKER_CONFIDENCE = 0.75;
const MULTIPLE_MARKER_CONFIDENCE = 0.95;

/** Confianza máxima de un documento que se ve bancario pero no se atribuye. */
const GENERIC_SIGNAL_WEIGHT = 0.15;
const UNKNOWN_MAX_CONFIDENCE = 0.45;

/**
 * Identifica la entidad emisora combinando varias señales sobre la carátula.
 *
 * Responde dos preguntas y no una, y separarlas es lo que permite rechazar sin
 * adivinar: **quién emitió el documento** —contra el padrón de ASFI— y, cuando
 * la respuesta es «nadie del padrón», **si lo emitió alguien que se sabe que no
 * es una entidad financiera**. La segunda convierte una ausencia de evidencia en
 * evidencia: sin ella, la factura de una telefónica y el extracto de una
 * cooperativa cuya carátula no imprime su nombre eran indistinguibles.
 */
@Injectable()
export class InstitutionDetector {
  /**
   * El padrón se resuelve en cada documento, no se captura aquí: ver
   * `InstitutionRegistry`. Omitirlo deja la nómina de ASFI compilada.
   */
  constructor(private readonly registry: InstitutionRegistry = ASFI_SEED_REGISTRY) {}

  detect(pdf: ExtractedPdf): InstitutionDetection {
    const cover = coverText(pdf);
    const matched = this.matchInstitution(cover);
    // Se pregunta UNA vez por documento y se arrastra en la detección: el padrón
    // puede recuperarse entre dos llamadas, y un veredicto medio vigente y medio
    // degradado no lo puede interpretar nadie.
    const registryAuthoritative = this.registry.isAuthoritative();
    const generic = GENERIC_SIGNALS.filter((signal) => signal.pattern.test(cover)).map(
      (signal) => signal.id,
    );

    if (!matched) {
      const issuer = detectNonBankingIssuer(cover);
      return {
        code: UNKNOWN_INSTITUTION_CODE,
        detected: false,
        confidence: Number(
          Math.min(UNKNOWN_MAX_CONFIDENCE, generic.length * GENERIC_SIGNAL_WEIGHT).toFixed(2),
        ),
        signals: issuer ? [`emisor-no-financiero:${issuer.code}`, ...generic] : generic,
        registryAuthoritative,
        nonBankingIssuer: issuer && {
          code: issuer.code,
          name: issuer.name,
          kind: issuer.kind,
        },
      };
    }

    const { institution, hits } = matched;
    return {
      code: institution.code,
      name: institution.name,
      detected: true,
      confidence: hits > 1 ? MULTIPLE_MARKER_CONFIDENCE : SINGLE_MARKER_CONFIDENCE,
      signals: [`marcadores-de-entidad:${hits}`, ...generic],
      kind: institution.kind,
      licenseStatus: institution.licenseStatus,
      retailDeposits: institution.retailDeposits,
      licenseNote: institution.note,
      registryAuthoritative,
      /*
       * El padrón administrado manda sobre la deducción, y la deducción es la
       * red. Es el mismo reparto que ya rige el padrón entero: una entidad
       * calibrada desde el portal describe sus extractos mejor que un descriptor
       * deducido de un analizador, pero sin base de datos —o sin haber calibrado
       * todavía— el motor no se queda ciego.
       */
      signalDescriptor:
        institution.expectedSignals ?? COMPILED_SIGNAL_DESCRIPTORS.get(institution.code),
    };
  }

  /**
   * Gana la entidad con más marcadores coincidentes; a igualdad, la primera del
   * padrón. Contar en lugar de quedarse con la primera coincidencia evita que
   * un marcador amplio de una entidad se imponga a otro más específico.
   */
  private matchInstitution(
    cover: string,
  ): { institution: BoliviaInstitution; hits: number } | undefined {
    let best: { institution: BoliviaInstitution; hits: number } | undefined;
    for (const institution of this.registry.list()) {
      const hits = countMarkerHits(institution, cover);
      if (hits === 0) continue;
      if (!best || hits > best.hits) best = { institution, hits };
    }
    return best;
  }
}
