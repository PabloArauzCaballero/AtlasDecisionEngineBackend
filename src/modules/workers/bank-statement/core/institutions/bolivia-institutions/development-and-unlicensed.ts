import { ifd } from './builders';
import { BoliviaInstitution } from './types';

/** Instituciones financieras de desarrollo (IFD). */
export const INSTITUCIONES_DE_DESARROLLO: readonly BoliviaInstitution[] = [
  ifd('ICI', 'Institución Financiera de Desarrollo CIDRE IFD', String.raw`\bCIDRE\b`),
  ifd('ICR', 'Institución Financiera de Desarrollo CRECER IFD', String.raw`\bCRECER\s+IFD\b`),
  ifd(
    'IDI',
    'Institución Financiera de Desarrollo DIACONÍA FRID - IFD',
    String.raw`\bDIACON[IÍ]A\b`,
  ),
  ifd('IFO', 'Institución Financiera de Desarrollo FONDECO IFD', String.raw`\bFONDECO\b`),
  ifd('IFU', 'Institución Financiera de Desarrollo FUBODE IFD', String.raw`\bFUBODE\b`),
  ifd(
    'IID',
    'Institución Financiera de Desarrollo IDEPRO IFD',
    String.raw`\bIDEPRO\b|\bSEMBRAR\s+SARTAWI\b`,
  ),
  ifd('IIM', 'Institución Financiera de Desarrollo IMPRO IFD', String.raw`\bIMPRO\s+IFD\b`),
  ifd(
    'IPM',
    'Institución Financiera de Desarrollo Fundación PRO MUJER IFD',
    String.raw`\bPRO\s?MUJER\b`,
  ),
];

/**
 * Entidades SIN licencia vigente que siguen apareciendo en documentos reales.
 *
 * Están en el padrón para poder decir la verdad completa: el documento es
 * auténtico, la entidad ya no opera, y por eso el caso va a una persona en vez
 * de procesarse como si nada hubiera pasado o rechazarse como si el documento
 * fuera falso.
 */
export const ENTIDADES_SIN_LICENCIA: readonly BoliviaInstitution[] = [
  {
    code: 'BFS',
    name: 'Banco Fassil S.A.',
    kind: 'MULTIPLE_BANK',
    /*
     * INTERVENIDO, no revocado, y el cambio no es cosmético.
     *
     * Aquí decía `REVOKED` y la nota afirmaba una revocación con fecha. El corte
     * oficial de ASFI al 31.08.2026 lo lista en INTERVENCIÓN y no publica ni
     * fecha ni resolución de revocación. Afirmar la revocación en el expediente
     * de un cliente es escribir como hecho algo que nadie verificó — y contra un
     * documento que, además, puede ser perfectamente auténtico.
     */
    licenseStatus: 'INTERVENED',
    retailDeposits: true,
    markers: [/BANCO\s+FASSIL/i, /\bFASSIL\b/i],
    note:
      'En intervención según el corte de ASFI del 31.08.2026. No consta fecha ni resolución ' +
      'de revocación. Un extracto suyo puede ser auténtico: el caso va a una persona, no al rechazo.',
  },
  {
    code: 'BDB',
    name: 'Banco Do Brasil S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'VOLUNTARY_LIQUIDATION',
    retailDeposits: false,
    markers: [/BANCO\s+DO\s+BRASIL/i],
    note: 'En liquidación voluntaria según el corte de ASFI del 31.08.2026.',
  },
  {
    code: 'CIC',
    name: 'Cooperativa de Ahorro y Crédito Societaria Intercoop Ltda.',
    kind: 'COOPERATIVE',
    licenseStatus: 'BANKRUPTCY',
    retailDeposits: true,
    markers: [/\bINTERCOOP\b/i],
    note: 'En proceso de quiebra según el corte de ASFI del 31.08.2026.',
  },
  {
    code: 'ISS',
    name: 'SEMBRAR SARTAWI IFD',
    kind: 'DEVELOPMENT_IFD',
    /*
     * Absorbida por IDEPRO (IID) y disuelta SIN liquidación, por resolución
     * ASFI 385/2024 del 29 de abril de 2024. Sigue en el padrón porque un
     * estado de cuenta suyo anterior a esa fecha es un documento válido, y
     * porque quien lo reciba hoy necesita saber quién responde por él.
     */
    licenseStatus: 'ABSORBED',
    retailDeposits: false,
    markers: [/\bSEMBRAR\s+SARTAWI\b/i, /\bSARTAWI\b/i],
    note: 'Absorbida y disuelta sin liquidación (ASFI 385/2024, 29.04.2024). Sucesora: IDEPRO IFD (IID).',
  },
];
