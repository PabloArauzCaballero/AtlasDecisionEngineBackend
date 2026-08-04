export type InstitutionKind = 'MULTIPLE_BANK' | 'PYME_BANK' | 'STATE_BANK' | 'COOPERATIVE';

export interface BoliviaInstitution {
  code: string;
  name: string;
  kind: InstitutionKind;
  markers: readonly RegExp[];
}

// Registro de reconocimiento. La presencia aquí no implica que exista un parser
// para todos sus formatos; evita confundir "entidad detectada" con "datos fiables".
export const BOLIVIA_INSTITUTIONS: readonly BoliviaInstitution[] = [
  {
    code: 'BGA',
    name: 'Banco Ganadero S.A.',
    kind: 'MULTIPLE_BANK',
    markers: [/BANCO\s+GANADERO/i, /ganam[oó]vil/i],
  },
  {
    code: 'BCR',
    name: 'Banco de Crédito de Bolivia S.A. (BCP)',
    kind: 'MULTIPLE_BANK',
    markers: [/\bBCP\b/i, /Banco de Cr[eé]dito de Bolivia/i, /Extracto\s+de\s+Cuenta\s+por\s+Mes/i],
  },
  {
    code: 'BEC',
    name: 'Banco Económico S.A.',
    kind: 'MULTIPLE_BANK',
    markers: [/BANCO\s+ECON[OÓ]MICO/i, /baneco\.com\.bo/i],
  },
  {
    code: 'BNB',
    name: 'Banco Nacional de Bolivia S.A.',
    kind: 'MULTIPLE_BANK',
    markers: [/BANCO\s+NACIONAL\s+DE\s+BOLIVIA/i, /\bBNB\b/i],
  },
  {
    code: 'BME',
    name: 'Banco Mercantil Santa Cruz S.A.',
    kind: 'MULTIPLE_BANK',
    markers: [
      /BANCO\s+MERCANTIL\s+SANTA\s+CRUZ/i,
      /\bBMSC\b/i,
      // Marca impresa en la cabecera de sus extractos de caja de ahorro.
      /MAKROBANX/i,
      /SUPER\s+MAKRO\s+CUENTA/i,
    ],
  },
  {
    code: 'BIS',
    name: 'Banco BISA S.A.',
    kind: 'MULTIPLE_BANK',
    markers: [/BANCO\s+BISA/i, /\bBISA\b/i],
  },
  {
    code: 'BUN',
    name: 'Banco Unión S.A.',
    kind: 'STATE_BANK',
    // Su «Extracto de Movimientos» imprime el nombre del banco solo dentro del
    // logotipo, que es una imagen: sin el recuadro de saldos del pie, el
    // documento no se podría atribuir a ninguna entidad.
    markers: [/BANCO\s+UNI[OÓ]N/i, /Tr[aá]nsito\s+Consultado\s+Congelado\s+Sobregirado/i],
  },
  {
    code: 'BSO',
    name: 'Banco Solidario S.A.',
    kind: 'MULTIPLE_BANK',
    markers: [/BANCO\s+SOLIDARIO/i, /\bBANCO\s*SOL\b/i],
  },
  {
    code: 'BIE',
    name: 'Banco FIE S.A.',
    kind: 'MULTIPLE_BANK',
    markers: [/BANCO\s+FIE/i],
  },
  {
    code: 'BPR',
    name: 'Banco Prodem S.A.',
    kind: 'MULTIPLE_BANK',
    markers: [/BANCO\s+PRODEM/i],
  },
  {
    code: 'BFO',
    name: 'Banco Fortaleza S.A.',
    kind: 'MULTIPLE_BANK',
    markers: [/BANCO\s+FORTALEZA/i],
  },
  {
    code: 'BNA',
    name: 'Banco de la Nación Argentina',
    kind: 'MULTIPLE_BANK',
    markers: [/BANCO\s+DE\s+LA\s+NACI[OÓ]N\s+ARGENTINA/i],
  },
  {
    code: 'PCO',
    name: 'Banco PYME de la Comunidad S.A.',
    kind: 'PYME_BANK',
    markers: [/BANCO\s+PYME\s+DE\s+LA\s+COMUNIDAD/i],
  },
  {
    code: 'PEF',
    name: 'Banco PYME Ecofuturo S.A.',
    kind: 'PYME_BANK',
    markers: [/BANCO\s+(?:PYME\s+)?ECOFUTURO/i],
  },
  {
    code: 'BDR',
    name: 'Banco de Desarrollo Productivo S.A.M.',
    kind: 'STATE_BANK',
    markers: [/BANCO\s+DE\s+DESARROLLO\s+PRODUCTIVO/i, /\bBDP\b/i],
  },
  {
    code: 'CJN',
    name: 'Cooperativa Jesús Nazareno R.L.',
    kind: 'COOPERATIVE',
    markers: [/COOPERATIVA.+JES[UÚ]S\s+NAZARENO/is],
  },
  {
    code: 'CSM',
    name: 'Cooperativa San Martín de Porres R.L.',
    kind: 'COOPERATIVE',
    markers: [/COOPERATIVA.+SAN\s+MART[IÍ]N\s+DE\s+PORRES/is],
  },
  {
    code: 'CFA',
    name: 'Cooperativa Fátima R.L.',
    kind: 'COOPERATIVE',
    markers: [/COOPERATIVA.+F[AÁ]TIMA/is],
  },
  {
    code: 'CSA',
    name: 'Cooperativa San Antonio R.L.',
    kind: 'COOPERATIVE',
    markers: [/COOPERATIVA.+SAN\s+ANTONIO/is],
  },
  {
    code: 'CQC',
    name: 'Cooperativa Quillacollo R.L.',
    kind: 'COOPERATIVE',
    markers: [/COOPERATIVA.+QUILLACOLLO/is],
  },
] as const;

export function detectInstitution(text: string): BoliviaInstitution | undefined {
  return BOLIVIA_INSTITUTIONS.find((institution) =>
    institution.markers.some((marker) => marker.test(text)),
  );
}
