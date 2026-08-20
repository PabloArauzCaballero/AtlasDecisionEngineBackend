import type { DocumentVerdict } from './document-triage';
import type { InstitutionDetection } from './statement-context';

/**
 * La segunda compuerta: **quién** emitió el documento.
 *
 * La primera (`document-classifier`) responde «¿esto es un estado de cuenta?» y
 * lo hace bien, pero responde sólo esa pregunta. El agujero que deja es exacto y
 * se medía: la factura mensual de una telefónica se titula «Estado de Cuenta»,
 * imprime número de cuenta, saldo, una columna de importes y una tabla de
 * consumos con fecha. Suma **1.00 sobre 1.00** en el clasificador, y ninguna de
 * esas señales es falsa —de verdad es un estado de una cuenta—. Lo único que la
 * distingue de un extracto bancario es quién la manda.
 *
 * Antes esa pregunta sólo se hacía en la ruta de error, cuando NINGUNA estrategia
 * aceptaba el documento; y el motor generalista acepta cualquier cosa con una
 * tabla de fechas e importes, así que en la práctica no se hacía nunca. El
 * documento ajeno no se rechazaba: se convertía en movimientos.
 *
 * ## Los cuatro veredictos, y por qué son cuatro
 *
 * - `LICENSED`: la carátula lo atribuye a una entidad con licencia de ASFI. Se
 *   procesa.
 * - `UNLICENSED`: se atribuye a una entidad del padrón cuya licencia no está
 *   vigente. **Va a una persona, no al rechazo**: el documento es auténtico y su
 *   historial es cierto; lo que hace falta es que alguien sepa que la entidad ya
 *   no opera antes de decidir sobre él.
 * - `NON_BANKING`: la carátula lo atribuye a alguien que se sabe que no es una
 *   entidad financiera boliviana —una telefónica, una aseguradora, una AFP, un
 *   banco extranjero—. Se rechaza en el momento. Es la única de las cuatro que
 *   se apoya en evidencia POSITIVA de lo contrario, y por eso puede cerrarse sin
 *   preguntar: nadie va a convertir eso en movimientos jamás.
 * - `UNATTRIBUTED`: no se pudo atribuir. Aquí el desenlace depende de si queda
 *   alguna señal financiera —el aviso de supervisión de ASFI, un dominio
 *   bancario, el seguro de depósitos—: con alguna, es probablemente una entidad
 *   pequeña cuya carátula no imprime su nombre y va a revisión; sin ninguna, no
 *   hay nada que una persona pueda hacer con él y se rechaza.
 *
 * Colapsar los cuatro en «reconocida / no reconocida» es lo que llenaba la cola
 * de revisión de documentos que nadie tenía que mirar, que es la enfermedad que
 * el triage de este worker existe para curar.
 */
export type IssuerVerdict = 'LICENSED' | 'UNLICENSED' | 'NON_BANKING' | 'UNATTRIBUTED';

export interface IssuerAssessment {
  readonly verdict: IssuerVerdict;
  /** Qué hacer con el documento por razón del emisor, en la misma escala que el triage. */
  readonly disposition: DocumentVerdict;
  /** Por qué. Queda en la traza y en el detalle del error. */
  readonly reasons: readonly string[];
}

export interface IssuerGateOptions {
  /**
   * Si un documento que no se atribuye a ninguna entidad con licencia puede
   * seguir procesándose.
   *
   * Está aquí y no compilado a `true` porque encender una exigencia nueva sobre
   * un motor en marcha rechaza documentos que ayer pasaban, y esa decisión es de
   * quien opera el sistema, no de quien escribe el módulo. Con `false` la
   * compuerta sigue midiendo y dejando constancia: se puede ver cuánto
   * rechazaría antes de dejar que rechace.
   */
  readonly requireLicensedIssuer: boolean;
}

export const DEFAULT_ISSUER_GATE_OPTIONS: IssuerGateOptions = {
  requireLicensedIssuer: true,
};

/** Señales que el detector añade y que no son evidencia genérica de banca. */
const SENALES_DE_ATRIBUCION = ['marcadores-de-entidad', 'emisor-no-financiero'];

export function assessIssuer(
  institution: InstitutionDetection,
  options: IssuerGateOptions = DEFAULT_ISSUER_GATE_OPTIONS,
): IssuerAssessment {
  const assessment = classifyIssuer(institution);
  if (options.requireLicensedIssuer || assessment.disposition === 'ACCEPT') return assessment;
  /*
   * En modo de medición el veredicto se conserva íntegro y sólo se relaja el
   * desenlace. Guardar el veredicto real es lo que permite responder «¿cuántos
   * documentos rechazaríamos?» sin haber rechazado ninguno todavía.
   */
  return {
    ...assessment,
    disposition: 'ACCEPT',
    reasons: [...assessment.reasons, 'compuerta-en-medicion'],
  };
}

function classifyIssuer(institution: InstitutionDetection): IssuerAssessment {
  if (institution.detected) {
    if (institution.licenseStatus && institution.licenseStatus !== 'LICENSED') {
      return {
        verdict: 'UNLICENSED',
        disposition: 'REVIEW',
        reasons: [
          `licencia:${institution.licenseStatus}`,
          ...(institution.licenseNote ? [institution.licenseNote] : []),
        ],
      };
    }
    /*
     * Una entidad que no capta depósitos —la banca de segundo piso, una IFD— no
     * se rechaza: emite documentos legítimos. Se deja constancia de la rareza y
     * se procesa, porque negarse aquí castigaría un extracto de crédito válido
     * por una distinción que el motor todavía no sabe leer.
     */
    const reasons = [`entidad:${institution.code}`];
    if (institution.retailDeposits === false) reasons.push('entidad-sin-depositos-del-publico');
    return { verdict: 'LICENSED', disposition: 'ACCEPT', reasons };
  }

  if (institution.nonBankingIssuer) {
    const { code, kind } = institution.nonBankingIssuer;
    return {
      verdict: 'NON_BANKING',
      disposition: 'REJECT',
      reasons: [`emisor:${code}`, `tipo-de-emisor:${kind}`],
    };
  }

  const financieras = institution.signals.filter(
    (signal) => !SENALES_DE_ATRIBUCION.some((prefix) => signal.startsWith(prefix)),
  );
  if (financieras.length > 0) {
    return {
      verdict: 'UNATTRIBUTED',
      disposition: 'REVIEW',
      reasons: ['sin-atribuir-con-senales-financieras', ...financieras],
    };
  }
  return {
    verdict: 'UNATTRIBUTED',
    disposition: 'REJECT',
    reasons: ['sin-atribuir-y-sin-senales-financieras'],
  };
}
