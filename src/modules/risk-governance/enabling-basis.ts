/**
 * La base habilitante que una decisión necesita, por finalidad, y si el titular la tiene.
 *
 * Hasta esta pieza la guardia sólo sabía decir «no» a un permiso que EXISTÍA y ya no valía. La
 * AUSENCIA de evidencia pasaba como permiso, y el primer solicitante —sin sujeto todavía en el
 * motor— ni siquiera se miraba. Aquí se separan tres preguntas que antes eran una:
 *
 *  1. **Qué exige esta decisión** (`resolveEnablingBasisPolicy`): por finalidad, qué bases
 *     jurídicas se aceptan y, si se quiere, qué versiones del texto. Lo declara la versión del
 *     artefacto —y se aprueba con ella—; si no declara nada se DERIVA de su `legalBasis`, y si
 *     tampoco la tiene y origina crédito en producción, se aplica la política por defecto del
 *     motor. Nunca «nada que comprobar» por omisión en originación productiva.
 *  2. **Qué tiene el titular** (los registros de `subject_consent`, que son bases habilitantes en
 *     general, no sólo consentimientos: `basis` dice cuál).
 *  3. **Qué pasa si falta** (`onMissing`): `REVIEW` —la decisión no se toma y va a revisión, con
 *     evidencia— o `BLOCK` —se rechaza la petición—. Nunca una aprobación utilizable.
 *
 * Los motivos de fallo se distinguen porque quien atiende el caso hace cosas distintas: pedir la
 * base (no hay ninguna), pedir OTRA finalidad (hay registros, no para esta), renovarla (venció),
 * no volver a pedirla igual (la revocaron) o actualizar el texto (versión no aceptada).
 *
 * Funciones puras: lo que hay que poder verificar es la tabla de decisión, no la consulta.
 */
import { ProcessingLegalBasis } from '@prisma/client';

/** Finalidad con la que el core registra la evaluación crediticia (`credit_underwriting`). */
export const ORIGINATION_BASIS_PURPOSE = 'credit_underwriting';

/** Dominio de riesgo de la originación de crédito. */
const ORIGINATION_RISK_DOMAIN = 'CREDIT_ORIGINATION';

export type MissingBasisAction = 'REVIEW' | 'BLOCK';

/**
 * Qué hacer con un artefacto de originación en producción que no declara ni política ni base
 * legal. `REVIEW` por omisión; `ALLOW_LEGACY` reproduce el comportamiento anterior y existe sólo
 * para poder volver atrás de forma explícita y visible en configuración.
 */
export type UndeclaredBasisMode = 'REVIEW' | 'BLOCK' | 'ALLOW_LEGACY';

export interface BasisRequirement {
  /** Código de finalidad, igual al `purpose` con el que se registra la base. */
  purpose: string;
  /** Bases jurídicas que habilitan esta finalidad. Nunca vacío. */
  acceptedBases: ProcessingLegalBasis[];
  /** Versiones del texto aceptadas. Vacío = cualquiera. */
  acceptedVersions: string[];
}

export type EnablingBasisPolicySource =
  'DECLARED' | 'DERIVED_FROM_LEGAL_BASIS' | 'ORIGINATION_DEFAULT' | 'NONE';

export interface EnablingBasisPolicy {
  source: EnablingBasisPolicySource;
  onMissing: MissingBasisAction;
  requirements: BasisRequirement[];
}

export type BasisFailureReason =
  | 'SUBJECT_REFERENCE_MISSING'
  | 'NO_BASIS_RECORDED'
  | 'PURPOSE_NOT_COVERED'
  | 'BASIS_NOT_ACCEPTED'
  | 'VERSION_NOT_ACCEPTED'
  | 'NOT_YET_GRANTED'
  | 'EXPIRED'
  | 'REVOKED';

export interface BasisFailure {
  purpose: string;
  reason: BasisFailureReason;
}

export interface BasisRecord {
  purpose: string;
  basis: ProcessingLegalBasis | string;
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  consentVersion?: string | null;
}

export interface BasisEvaluation {
  satisfied: boolean;
  failures: BasisFailure[];
}

const LEGAL_BASES = new Set<string>(Object.values(ProcessingLegalBasis));

/** Error de una política declarada que no se puede interpretar. Se falla cerrado. */
export class EnablingBasisPolicyError extends Error {}

/**
 * Interpreta la política declarada en la versión.
 *
 * Una lista VACÍA de requisitos es una exención («esta decisión no necesita base») y, como
 * `NOT_APPLICABLE` en la política de sujeto, exige justificación escrita: una exención sin motivo
 * es un descuido, y un descuido no puede apagar un control.
 */
export function parseDeclaredPolicy(raw: unknown): EnablingBasisPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new EnablingBasisPolicyError('La política de base habilitante no es un objeto.');
  }
  const value = raw as Record<string, unknown>;
  const onMissing = value.onMissing ?? 'REVIEW';
  if (onMissing !== 'REVIEW' && onMissing !== 'BLOCK') {
    throw new EnablingBasisPolicyError('`onMissing` tiene que ser REVIEW o BLOCK.');
  }
  if (!Array.isArray(value.requirements)) {
    throw new EnablingBasisPolicyError('`requirements` tiene que ser una lista.');
  }
  const requirements = value.requirements.map((entry, index) => parseRequirement(entry, index));
  if (!requirements.length) {
    const justification = typeof value.justification === 'string' ? value.justification.trim() : '';
    if (!justification) {
      throw new EnablingBasisPolicyError(
        'Una política sin requisitos es una exención y exige `justification`.',
      );
    }
  }
  return { source: 'DECLARED', onMissing, requirements };
}

function parseRequirement(entry: unknown, index: number): BasisRequirement {
  if (!entry || typeof entry !== 'object') {
    throw new EnablingBasisPolicyError(`El requisito ${index} no es un objeto.`);
  }
  const value = entry as Record<string, unknown>;
  const purpose = typeof value.purpose === 'string' ? value.purpose.trim() : '';
  if (!purpose) throw new EnablingBasisPolicyError(`El requisito ${index} no tiene finalidad.`);
  const bases = Array.isArray(value.acceptedBases) ? value.acceptedBases : [];
  if (!bases.length || !bases.every((basis) => LEGAL_BASES.has(String(basis)))) {
    throw new EnablingBasisPolicyError(
      `El requisito «${purpose}» necesita al menos una base jurídica válida.`,
    );
  }
  const versions = Array.isArray(value.acceptedVersions)
    ? value.acceptedVersions.map((version) => String(version).trim()).filter(Boolean)
    : [];
  return {
    purpose,
    acceptedBases: bases.map((basis) => basis as ProcessingLegalBasis),
    acceptedVersions: versions,
  };
}

/**
 * La política efectiva para una decisión.
 *
 * Precedencia: lo DECLARADO en la versión; si no, lo que se deriva de su `legalBasis` cuando
 * origina crédito (consentimiento como única base si eso es lo que declara; si declara otra, esa
 * o consentimiento); si no, en un ambiente de producción, la política por defecto del motor para
 * originación. Fuera de esos casos no hay requisito que comprobar.
 */
export function resolveEnablingBasisPolicy(input: {
  declared: unknown;
  legalBasis: string | null | undefined;
  riskDomain: string;
  isProductionEnvironment: boolean;
  undeclaredMode: UndeclaredBasisMode;
}): EnablingBasisPolicy {
  if (input.declared !== null && input.declared !== undefined) {
    return parseDeclaredPolicy(input.declared);
  }
  const originates = input.riskDomain === ORIGINATION_RISK_DOMAIN;
  if (originates && input.legalBasis && LEGAL_BASES.has(input.legalBasis)) {
    const declaredBasis = input.legalBasis as ProcessingLegalBasis;
    return {
      source: 'DERIVED_FROM_LEGAL_BASIS',
      onMissing: 'REVIEW',
      requirements: [
        {
          purpose: ORIGINATION_BASIS_PURPOSE,
          acceptedBases:
            declaredBasis === ProcessingLegalBasis.CONSENT
              ? [ProcessingLegalBasis.CONSENT]
              : [declaredBasis, ProcessingLegalBasis.CONSENT],
          acceptedVersions: [],
        },
      ],
    };
  }
  if (originates && input.isProductionEnvironment && input.undeclaredMode !== 'ALLOW_LEGACY') {
    return {
      source: 'ORIGINATION_DEFAULT',
      onMissing: input.undeclaredMode,
      requirements: [
        {
          purpose: ORIGINATION_BASIS_PURPOSE,
          acceptedBases: [
            ProcessingLegalBasis.CREDIT_PROTECTION,
            ProcessingLegalBasis.CONTRACT,
            ProcessingLegalBasis.CONSENT,
          ],
          acceptedVersions: [],
        },
      ],
    };
  }
  return { source: 'NONE', onMissing: 'REVIEW', requirements: [] };
}

/**
 * ¿Tiene el titular, AHORA, una base válida para cada finalidad exigida?
 *
 * Sin referencia de sujeto no hay a quién atribuir la base, y eso es un fallo más —no un pase—:
 * es exactamente el hueco por el que una decisión sin `subjectReference` se saltaba el control.
 */
export function evaluateEnablingBasis(
  policy: EnablingBasisPolicy,
  subjectReferencePresent: boolean,
  records: BasisRecord[],
  now: Date,
): BasisEvaluation {
  if (!policy.requirements.length) return { satisfied: true, failures: [] };
  if (!subjectReferencePresent) {
    return {
      satisfied: false,
      failures: policy.requirements.map((requirement) => ({
        purpose: requirement.purpose,
        reason: 'SUBJECT_REFERENCE_MISSING' as const,
      })),
    };
  }
  const failures: BasisFailure[] = [];
  for (const requirement of policy.requirements) {
    const reason = verdictFor(requirement, records, now);
    if (reason) failures.push({ purpose: requirement.purpose, reason });
  }
  return { satisfied: failures.length === 0, failures };
}

function verdictFor(
  requirement: BasisRequirement,
  records: BasisRecord[],
  now: Date,
): BasisFailureReason | null {
  if (!records.length) return 'NO_BASIS_RECORDED';
  const record = records.find((candidate) => candidate.purpose === requirement.purpose);
  if (!record) return 'PURPOSE_NOT_COVERED';
  // La revocación va primero: un permiso revocado no «vuelve» por no haber vencido todavía.
  if (record.revokedAt && record.revokedAt <= now) return 'REVOKED';
  if (record.grantedAt > now) return 'NOT_YET_GRANTED';
  if (record.expiresAt && record.expiresAt <= now) return 'EXPIRED';
  if (!requirement.acceptedBases.includes(record.basis as ProcessingLegalBasis)) {
    return 'BASIS_NOT_ACCEPTED';
  }
  if (
    requirement.acceptedVersions.length &&
    !requirement.acceptedVersions.includes(record.consentVersion?.trim() ?? '')
  ) {
    return 'VERSION_NOT_ACCEPTED';
  }
  return null;
}

/** Lee el modo por defecto de la configuración. Un valor raro cae en `REVIEW`: falla cerrado. */
export function parseUndeclaredBasisMode(raw: unknown): UndeclaredBasisMode {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return value === 'BLOCK' || value === 'ALLOW_LEGACY' ? value : 'REVIEW';
}
