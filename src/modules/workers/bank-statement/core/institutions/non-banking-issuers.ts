/**
 * Quién MÁS imprime un papel titulado «estado de cuenta».
 *
 * ## Por qué hace falta una lista de lo que NO es
 *
 * El padrón de ASFI responde «¿está esta entidad supervisada?». No responde la
 * pregunta que de verdad rechaza documentos: «¿quién emitió esto?». Sin ella, la
 * única evidencia contra un documento ajeno era la AUSENCIA de coincidencia en
 * el padrón, y la ausencia no distingue dos casos que merecen respuestas
 * opuestas: la cooperativa boliviana cuya carátula no imprime su nombre —que hay
 * que mandar a una persona— y el estado de cuenta de una telefónica —que hay que
 * rechazar en el momento, porque nadie va a convertirlo en movimientos jamás—.
 *
 * El caso que lo motiva es concreto y estaba pasando la compuerta entera: la
 * factura mensual de una telefónica se titula «Estado de Cuenta», lleva número
 * de cuenta, saldo, columna de importes y una tabla de consumos con fecha. Suma
 * 1.00 en el clasificador —el máximo— y ninguna de sus señales es falsa. Lo
 * único que la delata es QUIÉN la emite.
 *
 * ## Qué NO entra aquí
 *
 * Nombres sueltos que puedan aparecer en la glosa de un movimiento legítimo.
 * Todo lo de esta lista se busca sólo en la carátula (`coverRegion`), que es
 * donde un documento se identifica a sí mismo; una transferencia a «Entel» en el
 * cuerpo de un extracto del BNB no dice nada sobre quién emitió el extracto.
 */

export type NonBankingIssuerKind =
  /** Entidad financiera sin licencia de ASFI: extranjera o no supervisada aquí. */
  | 'FOREIGN_FINANCIAL'
  /** Billeteras y plataformas de pago. */
  | 'PAYMENT_PLATFORM'
  /** Servicios básicos: luz, agua, gas. */
  | 'UTILITY'
  | 'TELECOM'
  | 'INSURANCE'
  /** Administradoras de fondos de pensiones. */
  | 'PENSION'
  /** Mercado de valores: agencias de bolsa, SAFI, titularizadoras. */
  | 'SECURITIES';

export interface NonBankingIssuer {
  readonly code: string;
  readonly name: string;
  readonly kind: NonBankingIssuerKind;
  readonly markers: readonly RegExp[];
}

/**
 * Emisores bolivianos de estados de cuenta que no son entidades financieras.
 *
 * Las cooperativas de servicios están aquí a propósito, y son la trampa más
 * fina del dominio: CRE, SAGUAPAC y COTAS se llaman «Cooperativa … R.L.» igual
 * que las 41 cooperativas de ahorro y crédito del padrón, así que una regla que
 * mirara sólo la palabra «cooperativa» las daría por financieras.
 */
const EMISORES_BOLIVIANOS: readonly NonBankingIssuer[] = [
  {
    code: 'ENTEL',
    name: 'Empresa Nacional de Telecomunicaciones',
    kind: 'TELECOM',
    markers: [/\bENTEL\b/i, /EMPRESA\s+NACIONAL\s+DE\s+TELECOMUNICACIONES/i],
  },
  {
    code: 'TIGO',
    name: 'Telecel S.A. (Tigo)',
    kind: 'TELECOM',
    markers: [/\bTIGO\b/i, /\bTELECEL\s+S\.?A\.?/i],
  },
  {
    code: 'VIVA',
    name: 'Nuevatel PCS de Bolivia S.A. (Viva)',
    kind: 'TELECOM',
    markers: [/\bNUEVATEL\b/i, /\bVIVA\s+M[OÓ]VIL\b/i],
  },
  {
    code: 'COTAS',
    name: 'Cooperativa de Telecomunicaciones Santa Cruz R.L.',
    kind: 'TELECOM',
    markers: [/\bCOTAS\b/i, /COOPERATIVA\s+DE\s+TELECOMUNICACIONES/i],
  },
  {
    code: 'COTEL',
    name: 'Cooperativa de Teléfonos Automáticos La Paz R.L.',
    kind: 'TELECOM',
    markers: [/\bCOTEL\b/i],
  },
  {
    code: 'COMTECO',
    name: 'Cooperativa de Teléfonos Cochabamba R.L.',
    kind: 'TELECOM',
    markers: [/\bCOMTECO\b/i],
  },
  {
    code: 'CRE',
    name: 'Cooperativa Rural de Electrificación R.L.',
    kind: 'UTILITY',
    markers: [/COOPERATIVA\s+RURAL\s+DE\s+ELECTRIFICACI[OÓ]N/i, /\bCRE\s+R\.?L\.?/i],
  },
  {
    code: 'SAGUAPAC',
    name: 'Cooperativa de Servicios Públicos Santa Cruz Ltda.',
    kind: 'UTILITY',
    markers: [/\bSAGUAPAC\b/i],
  },
  {
    code: 'ELFEC',
    name: 'Empresa de Luz y Fuerza Eléctrica Cochabamba S.A.',
    kind: 'UTILITY',
    markers: [/\bELFEC\b/i],
  },
  {
    code: 'DELAPAZ',
    name: 'Distribuidora de Electricidad La Paz S.A.',
    kind: 'UTILITY',
    markers: [/\bDELAPAZ\b/i, /DISTRIBUIDORA\s+DE\s+ELECTRICIDAD\s+LA\s+PAZ/i],
  },
  {
    code: 'EPSAS',
    name: 'Empresa Pública Social de Agua y Saneamiento',
    kind: 'UTILITY',
    markers: [/\bEPSAS\b/i],
  },
  {
    code: 'SETAR',
    name: 'Servicios Eléctricos Tarija S.A.',
    kind: 'UTILITY',
    markers: [/\bSETAR\b/i],
  },
  {
    code: 'YPFB',
    name: 'Yacimientos Petrolíferos Fiscales Bolivianos',
    kind: 'UTILITY',
    markers: [/\bYPFB\b/i],
  },
  {
    code: 'GESTORA',
    name: 'Gestora Pública de la Seguridad Social de Largo Plazo',
    kind: 'PENSION',
    markers: [
      /GESTORA\s+P[UÚ]BLICA\s+DE\s+LA\s+SEGURIDAD\s+SOCIAL/i,
      /\bGESTORA\s+DE\s+PENSIONES\b/i,
    ],
  },
  {
    code: 'AFP',
    name: 'Administradora de Fondos de Pensiones',
    kind: 'PENSION',
    markers: [
      /\bAFP\b/i,
      /ADMINISTRADORA\s+DE\s+FONDOS\s+DE\s+PENSIONES/i,
      /FUTURO\s+DE\s+BOLIVIA/i,
      /BBVA\s+PREVISI[OÓ]N/i,
    ],
  },
  {
    code: 'SEGUROS',
    name: 'Compañía de seguros',
    kind: 'INSURANCE',
    markers: [
      /SEGUROS\s+Y\s+REASEGUROS/i,
      /\bP[OÓ]LIZA\s+(?:N[°º.]|DE\s+SEGURO)/i,
      /LA\s+BOLIVIANA\s+CIACRUZ/i,
      /ALIANZA\s+(?:SEGUROS|VIDA)/i,
      /NACIONAL\s+SEGUROS/i,
      /CREDINFORM/i,
    ],
  },
  {
    code: 'VALORES',
    name: 'Participante del mercado de valores',
    kind: 'SECURITIES',
    markers: [
      /BOLSA\s+BOLIVIANA\s+DE\s+VALORES/i,
      /AGENCIA\s+DE\s+BOLSA/i,
      /SOCIEDAD\s+ADMINISTRADORA\s+DE\s+FONDOS\s+DE\s+INVERSI[OÓ]N/i,
      /\bSAFI\b/i,
      /SOCIEDAD\s+DE\s+TITULARIZACI[OÓ]N/i,
    ],
  },
];

/**
 * Entidades financieras sin licencia de ASFI.
 *
 * Un extracto del BCP del Perú o de una billetera internacional es un extracto
 * de verdad: la señal que lo rechaza no es que el documento sea malo, sino que
 * la entidad que lo emitió no está supervisada en Bolivia y sus movimientos no
 * pueden sostener una decisión de crédito aquí.
 */
const EMISORES_EXTRANJEROS: readonly NonBankingIssuer[] = [
  {
    code: 'BCP_PE',
    name: 'Banco de Crédito del Perú',
    kind: 'FOREIGN_FINANCIAL',
    markers: [/Banco\s+de\s+Cr[eé]dito\s+del\s+Per[uú]/i, /\bBCP\s+Per[uú]\b/i, /viabcp\.com/i],
  },
  {
    code: 'BANCA_EXTRANJERA',
    name: 'Banca extranjera sin licencia en Bolivia',
    kind: 'FOREIGN_FINANCIAL',
    markers: [
      /\bBBVA\b/i,
      /Banco\s+Santander/i,
      /\bItA[uú]\b|\bIta[uú]\s+Unibanco\b/i,
      /\bBancolombia\b/i,
      /Banco\s+de\s+Chile/i,
      /\bScotiabank\b/i,
      /\bInterbank\b/i,
      /\bCitibank\b/i,
      /Banco\s+do\s+Brasil/i,
      /\bHSBC\b/i,
      /Bank\s+of\s+America/i,
      /Wells\s+Fargo/i,
      /\bJPMorgan\b/i,
    ],
  },
  {
    code: 'BILLETERA',
    name: 'Plataforma de pagos o billetera digital',
    kind: 'PAYMENT_PLATFORM',
    markers: [
      /\bPayPal\b/i,
      /\bWise\s+(?:Payments|Europe)\b/i,
      /Mercado\s?Pago/i,
      /\bBinance\b/i,
      /\bPayoneer\b/i,
      /\bRevolut\b/i,
      /\bNubank\b/i,
      /\bSkrill\b/i,
    ],
  },
];

export const NON_BANKING_ISSUERS: readonly NonBankingIssuer[] = [
  ...EMISORES_BOLIVIANOS,
  ...EMISORES_EXTRANJEROS,
];

/**
 * El emisor no financiero que reclama la carátula, si hay alguno.
 *
 * Gana el que aporta más marcadores, por lo mismo que en el padrón: una
 * coincidencia suelta puede ser una casualidad de redacción y dos ya no.
 */
export function detectNonBankingIssuer(cover: string): NonBankingIssuer | undefined {
  let best: { issuer: NonBankingIssuer; hits: number } | undefined;
  for (const issuer of NON_BANKING_ISSUERS) {
    const hits = issuer.markers.filter((marker) => marker.test(cover)).length;
    if (hits === 0) continue;
    if (!best || hits > best.hits) best = { issuer, hits };
  }
  return best?.issuer;
}
