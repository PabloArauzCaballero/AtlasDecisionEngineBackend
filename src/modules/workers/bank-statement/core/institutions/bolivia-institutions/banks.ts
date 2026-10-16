import { BoliviaInstitution } from './types';

/** Bancos múltiples (BMU). */
export const BANCOS_MULTIPLES: readonly BoliviaInstitution[] = [
  {
    code: 'BNB',
    name: 'Banco Nacional de Bolivia S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [/BANCO\s+NACIONAL\s+DE\s+BOLIVIA/i, /\bBNB\b/i, /bnb\.com\.bo/i],
    exclusions: [/\bBNB\s+(?:SAFI|VALORES|SEGUROS|LEASING)\b/i],
  },
  {
    code: 'BME',
    name: 'Banco Mercantil Santa Cruz S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [
      /BANCO\s+MERCANTIL\s+SANTA\s+CRUZ/i,
      /\bBMSC\b/i,
      // Marca impresa en la cabecera de sus extractos de caja de ahorro.
      /MAKROBANX/i,
      /SUPER\s+MAKRO\s+CUENTA/i,
      /bmsc\.com\.bo/i,
    ],
  },
  {
    code: 'BIS',
    name: 'Banco Bisa S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [/BANCO\s+BISA/i, /\bBISA\s+S\.?A\.?\b/i, /bisa\.com/i],
    exclusions: [
      /\bBISA\s+(?:SEGUROS|SAFI|LEASING|AGENCIA\s+DE\s+BOLSA|SOCIEDAD\s+DE\s+TITULARIZACI[OÓ]N)/i,
    ],
  },
  {
    code: 'BCR',
    name: 'Banco de Crédito de Bolivia S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [
      /Banco\s+de\s+Cr[eé]dito\s+de\s+Bolivia/i,
      /\bBCP\b/i,
      /Extracto\s+de\s+Cuenta\s+por\s+Mes/i,
      /bcp\.com\.bo/i,
    ],
    // El BCP del Perú es otra entidad y no está supervisada por ASFI: sin esta
    // exclusión, su extracto entraría como si fuera el del banco boliviano.
    exclusions: [/Banco\s+de\s+Cr[eé]dito\s+del\s+Per[uú]/i, /\bCredifondo\b|\bCredibolsa\b/i],
  },
  {
    code: 'BEC',
    name: 'Banco Económico S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [/BANCO\s+ECON[OÓ]MICO/i, /baneco\.com\.bo/i, /\bBANECO\b/i],
  },
  {
    code: 'BGA',
    name: 'Banco Ganadero S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [/BANCO\s+GANADERO/i, /ganam[oó]vil/i, /bg\.com\.bo/i],
  },
  {
    code: 'BSO',
    name: 'Banco Solidario S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [/BANCO\s+SOLIDARIO/i, /\bBANCO\s*SOL\b/i, /bancosol\.com\.bo/i, /\bSol\s?Net\b/i],
  },
  {
    code: 'BNA',
    name: 'Banco de la Nación Argentina',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    // Sucursal boliviana de un banco extranjero: está en la nómina de ASFI, con
    // licencia y cobertura en Santa Cruz. No confundir con la casa matriz.
    markers: [/BANCO\s+DE\s+LA\s+NACI[OÓ]N\s+ARGENTINA/i],
  },
  {
    code: 'BIE',
    name: 'Banco para el Fomento a Iniciativas Económicas S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [
      /BANCO\s+(?:PARA\s+EL\s+)?FOMENTO\s+A\s+INICIATIVAS\s+ECON[OÓ]MICAS/i,
      /BANCO\s+FIE/i,
      /bancofie\.com\.bo/i,
    ],
  },
  {
    code: 'BFO',
    name: 'Banco Fortaleza S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [/BANCO\s+FORTALEZA/i, /bancofortaleza\.com\.bo/i],
  },
  {
    code: 'BPR',
    name: 'Banco Prodem S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [/BANCO\s+PRODEM/i, /\bPRODEM\b/i],
  },
];

/** Bancos PYME (BPY). */
export const BANCOS_PYME: readonly BoliviaInstitution[] = [
  {
    code: 'PCO',
    name: 'Banco PYME de la Comunidad S.A.',
    kind: 'PYME_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [/BANCO\s+PYME\s+DE\s+LA\s+COMUNIDAD/i, /\bBANCOMUNIDAD\b/i, /bco\.com\.bo/i],
  },
  {
    code: 'PEF',
    name: 'Banco PYME Ecofuturo S.A.',
    kind: 'PYME_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [/BANCO\s+(?:PYME\s+)?ECOFUTURO/i, /ecofuturo\.com\.bo/i],
  },
];

/** Entidades financieras del Estado o con participación mayoritaria del Estado. */
export const ENTIDADES_DEL_ESTADO: readonly BoliviaInstitution[] = [
  {
    code: 'BDR',
    name: 'Banco de Desarrollo Productivo S.A.M.',
    kind: 'DEVELOPMENT_BANK',
    licenseStatus: 'LICENSED',
    // Banca de segundo piso: financia a otras entidades financieras, no abre
    // cuentas al público. Un «extracto del BDP» a nombre de una persona es un
    // documento que merece que alguien lo mire.
    retailDeposits: false,
    markers: [/BANCO\s+DE\s+DESARROLLO\s+PRODUCTIVO/i, /\bBDP\b/i, /bdp\.com\.bo/i],
  },
  {
    code: 'BUN',
    name: 'Banco Unión S.A.',
    kind: 'STATE_BANK',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    // Su «Extracto de Movimientos» imprime el nombre del banco solo dentro del
    // logotipo, que es una imagen: sin el recuadro de saldos del pie, el
    // documento no se podría atribuir a ninguna entidad.
    markers: [
      /BANCO\s+UNI[OÓ]N/i,
      /bancounion\.com\.bo/i,
      /Tr[aá]nsito\s+Consultado\s+Congelado\s+Sobregirado/i,
    ],
  },
];

/** Entidades financieras de vivienda (EFV), antes mutuales de ahorro y préstamo. */
export const ENTIDADES_DE_VIVIENDA: readonly BoliviaInstitution[] = [
  {
    code: 'VL1',
    name: 'La Primera Entidad Financiera de Vivienda',
    kind: 'HOUSING_ENTITY',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    // El nombre de mutual sigue impreso en documentos anteriores a 2015 y en la
    // marca comercial: quitarlo dejaría fuera al extracto de un ahorrista antiguo.
    markers: [
      /LA\s+PRIMERA[\s\S]{0,40}?ENTIDAD\s+FINANCIERA\s+DE\s+VIVIENDA/i,
      /MUTUAL\s+LA\s+PRIMERA/i,
    ],
  },
  {
    code: 'VPR',
    name: 'La Promotora Entidad Financiera de Vivienda',
    kind: 'HOUSING_ENTITY',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [
      /LA\s+PROMOTORA[\s\S]{0,40}?ENTIDAD\s+FINANCIERA\s+DE\s+VIVIENDA/i,
      /MUTUAL\s+LA\s+PROMOTORA/i,
    ],
  },
  {
    code: 'VPG',
    name: 'El Progreso Entidad Financiera de Vivienda',
    kind: 'HOUSING_ENTITY',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [
      /EL\s+PROGRESO[\s\S]{0,40}?ENTIDAD\s+FINANCIERA\s+DE\s+VIVIENDA/i,
      /MUTUAL\s+EL\s+PROGRESO/i,
    ],
  },
];
