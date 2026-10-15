import { StatementProcessingError } from '../domain/errors';
import type { IssuerAssessment } from '../engine/issuer-gate';
import type { StatementContext } from '../engine/statement-context';

/**
 * Los rechazos de una conversión de extracto: un error de negocio por cada
 * compuerta, con la evidencia que se guarda y se audita. Son funciones puras;
 * quien las llama decide qué dejar en el registro.
 */

/**
 * El error cuando la clasificación no avala el documento, o nada si sí lo
 * avala.
 *
 * DOS códigos y no uno, y ésta es la distinción que da sentido a la cola de
 * revisión. Con un único `NOT_A_FINANCIAL_STATEMENT` no había forma de separar
 * la factura —que nadie tiene que mirar— del extracto con el encabezado
 * ilegible —que sí—, así que o se derivaban las dos a una persona o ninguna.
 * El clasificador ya lo sabe: sólo hacía falta que el error lo dijera.
 */
export function classificationFailure(
  context: StatementContext,
): StatementProcessingError | undefined {
  if (context.classification.isFinancialStatement) return undefined;
  const routing = context.classification.routing;
  const evidence = {
    documentType: context.classification.documentType,
    documentConfidence: context.classification.confidence,
    detectedSignals: context.classification.detectedSignals,
    /*
     * La RUTA, cuando el documento se pudo nombrar.
     *
     * «No reúne señales de ser un estado de cuenta» es verdad y no dice qué
     * hacer. «Es el comprobante de una operación: hace falta el extracto del
     * periodo» se resuelve en un minuto, y no acusa a nadie de nada.
     */
    ...(routing ? { documentRoute: routing.route, guidance: routing.guidance } : {}),
  };
  if (context.classification.verdict === 'REVIEW') {
    return new StatementProcessingError(
      'DOUBTFUL_DOCUMENT',
      'El documento se parece a un estado de cuenta, pero las señales no bastan para confirmarlo.',
      422,
      evidence,
    );
  }
  return new StatementProcessingError(
    'NOT_A_FINANCIAL_STATEMENT',
    routing
      ? `El documento no es un estado de cuenta. ${routing.guidance}`
      : 'El documento no reúne señales suficientes de ser un estado de cuenta.',
    422,
    evidence,
  );
}

/**
 * Ninguna estrategia aceptó el documento. Se distingue «no sé de quién es»
 * de «sé de quién es, pero no conozco este formato» porque el segundo caso es
 * accionable: nombra la entidad a la que le falta soporte.
 */
export function unsupportedStatement(context: StatementContext): StatementProcessingError {
  // La compuerta va primero: si el documento no demostró ser un estado de
  // cuenta, la entidad que se le atribuya es irrelevante.
  const classification = classificationFailure(context);
  if (classification) return classification;
  if (!context.institution.detected) {
    return new StatementProcessingError(
      'UNSUPPORTED_INSTITUTION',
      'No se pudo reconocer una entidad financiera boliviana compatible.',
      422,
      { documentType: context.classification.documentType },
    );
  }
  return new StatementProcessingError(
    'UNSUPPORTED_STATEMENT_FORMAT',
    `Se detectó ${context.institution.name}, pero este formato de extracto aún no tiene un parser verificado.`,
    422,
    { institutionCode: context.institution.code },
  );
}

/**
 * Un encabezado con texto NO hace extraíble una tabla que es una imagen.
 *
 * Cuando el documento trajo páginas sin capa de texto y aun así ninguna
 * estrategia encontró movimientos, la causa probable no es el banco ni el
 * formato: es que la tabla viaja como imagen y aquí no hubo reconocimiento
 * óptico que la leyera. Se dice en los detalles —y el caso va a una persona,
 * que es lo que el corpus fija en `ROUTE_MIXED`— en vez de fingir una
 * lectura o de rechazar el documento.
 */
export function noTransactionsFound(
  context: StatementContext,
  strategyIds: readonly string[],
  extractionWarnings: readonly string[],
): StatementProcessingError {
  const paginasSinTexto = extractionWarnings.find((warning) =>
    warning.startsWith('paginas-sin-texto-omitidas:'),
  );
  return new StatementProcessingError(
    'NO_TRANSACTIONS',
    paginasSinTexto
      ? 'El PDF tiene texto en la carátula pero su tabla de movimientos no es extraíble: ' +
          'hay páginas sin capa de texto.'
      : 'El PDF fue reconocido, pero no se encontraron movimientos verificables.',
    422,
    {
      institutionCode: context.institution.code,
      strategies: strategyIds,
      ...(paginasSinTexto ? { textCoverage: paginasSinTexto } : {}),
    },
  );
}

/** Línea de registro del rechazo del emisor. */
export function issuerRejectionLog(issuer: IssuerAssessment, correlation: string): string {
  return `Emisor rechazado: veredicto=${issuer.verdict} motivos=${issuer.reasons.join('|')}${correlation}`;
}

/**
 * El error del EMISOR. La clasificación manda sobre él (ver
 * `classificationFailure`): quien llama la consulta primero.
 *
 * Sólo cuando el documento SÍ demostró ser un estado de cuenta el problema es
 * de quién lo firma, y entonces sí se dice.
 */
export function issuerRejection(
  context: StatementContext,
  issuer: IssuerAssessment,
): StatementProcessingError {
  const evidence = {
    issuerVerdict: issuer.verdict,
    issuerReasons: issuer.reasons,
    institutionCode: context.institution.code,
    nonBankingIssuer: context.institution.nonBankingIssuer?.name,
  };

  if (issuer.verdict === 'UNLICENSED') {
    return new StatementProcessingError(
      'UNLICENSED_INSTITUTION',
      `El documento se atribuye a ${context.institution.name}, cuya licencia de ASFI no está vigente.`,
      422,
      evidence,
    );
  }
  if (issuer.verdict === 'NON_BANKING') {
    return new StatementProcessingError(
      'NON_BANKING_ISSUER',
      `El documento lo emitió ${context.institution.nonBankingIssuer?.name ?? 'una entidad no financiera'}, ` +
        'que no es una entidad financiera supervisada por ASFI.',
      422,
      evidence,
    );
  }
  if (issuer.disposition === 'REVIEW') {
    return new StatementProcessingError(
      'UNSUPPORTED_INSTITUTION',
      'No se pudo reconocer una entidad financiera boliviana compatible.',
      422,
      evidence,
    );
  }
  return new StatementProcessingError(
    'UNRECOGNIZED_ISSUER',
    'La carátula del documento no identifica a ninguna entidad financiera boliviana.',
    422,
    evidence,
  );
}
