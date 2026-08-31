import type { InstitutionSignalDescriptor } from '../engine/similarity/institution-signals';
/**
 * El padrón de entidades de intermediación financiera de Bolivia.
 *
 * ## De dónde sale
 *
 * De la nómina oficial de ASFI «Entidades de Intermediación Financiera con
 * Licencia de Funcionamiento», actualizada al **30 de abril de 2026**: 11 bancos
 * múltiples, 2 bancos PYME, 2 entidades del Estado, 3 entidades financieras de
 * vivienda, 41 cooperativas de ahorro y crédito —abiertas y societarias— y 8
 * instituciones financieras de desarrollo. Son 67 con licencia vigente, más las
 * que la perdieron y siguen apareciendo en documentos reales.
 *
 * Los códigos NO son inventados: son las siglas con las que ASFI identifica a
 * cada entidad, de modo que `institutionCode` se puede cruzar con
 * cualquier reporte del regulador sin una tabla de traducción.
 *
 * ## Por qué está completo y no sólo con los bancos que se saben leer
 *
 * Reconocer la entidad y saber leer su formato son dos preguntas distintas, y
 * confundirlas producía la peor respuesta posible: un extracto de una
 * cooperativa se trataba como «entidad desconocida», que es lo mismo que se
 * responde a una factura de electricidad. Con el padrón completo el motor puede
 * afirmar «esto lo emitió una entidad con licencia de ASFI y todavía no tengo
 * analizador para su plantilla» —accionable, revisable— y separarlo de «esto no
 * lo emitió ninguna entidad financiera boliviana», que es un rechazo.
 *
 * ## Qué es la fuente de la verdad en tiempo de ejecución
 *
 * Este catálogo es la SEMILLA. En el motor desplegado el padrón vive en
 * `decision_financial_institution` y se administra desde el portal, porque una
 * licencia se revoca por resolución de ASFI y esperar a un despliegue para
 * dejar de aceptar los documentos de una entidad intervenida sería exactamente
 * el fallo que este módulo existe para impedir. Cuando nadie inyecta un padrón
 * —pruebas, uso embebido, arranque en frío— se usa éste.
 */

export type InstitutionKind =
  /** Banco múltiple (BMU): la banca universal de la Ley 393. */
  | 'MULTIPLE_BANK'
  /** Banco PYME (BPY). */
  | 'PYME_BANK'
  /** Banco del Estado o con participación mayoritaria del Estado. */
  | 'STATE_BANK'
  /** Banca de segundo piso: financia a otras entidades, no al público. */
  | 'DEVELOPMENT_BANK'
  /** Entidad Financiera de Vivienda (EFV), las antiguas mutuales. */
  | 'HOUSING_ENTITY'
  /** Cooperativa de Ahorro y Crédito abierta o societaria (CAC). */
  | 'COOPERATIVE'
  /** Institución Financiera de Desarrollo (IFD). */
  | 'DEVELOPMENT_IFD';

/**
 * Situación de la licencia.
 *
 * `REVOKED` no se borra del padrón, y ésa es la decisión importante: un extracto
 * de una entidad intervenida es un documento auténtico y su historial sigue
 * siendo cierto, pero quien lo recibe hoy tiene que enterarse de que la entidad
 * ya no opera. Borrarla del padrón convertiría ese caso en «entidad
 * desconocida», que se lee como un fallo del motor y no como el hecho que es.
 */
export type InstitutionLicenseStatus = 'LICENSED' | 'SUSPENDED' | 'REVOKED';

export interface BoliviaInstitution {
  /** Sigla ASFI. Es la clave con la que el regulador nombra a la entidad. */
  readonly code: string;
  readonly name: string;
  readonly kind: InstitutionKind;
  readonly licenseStatus: InstitutionLicenseStatus;
  /**
   * Si capta depósitos del público y por tanto emite extractos de cuenta.
   *
   * Es informativo, **no** un motivo de rechazo: una IFD emite estados de cuenta
   * de crédito y la banca de segundo piso no atiende ventanilla, pero un
   * documento suyo sigue siendo de una entidad supervisada. Lo que hace es
   * explicar por qué un documento atribuido al BDP merece una mirada.
   */
  readonly retailDeposits: boolean;
  /** Lo que, impreso en la carátula, atribuye el documento a esta entidad. */
  readonly markers: readonly RegExp[];
  /**
   * Lo que ANULA la atribución aunque un marcador coincida.
   *
   * Existe por un falso positivo real del grupo financiero: la póliza de «BISA
   * Seguros y Reaseguros S.A.» lleva la palabra BISA en la carátula y se
   * atribuía al Banco BISA, con lo que una póliza entraba en el motor como si
   * fuera un extracto de su banco hermano. El apellido de la filial es lo único
   * que las distingue.
   */
  readonly exclusions?: readonly RegExp[];
  /** Por qué la entidad no está vigente, cuando no lo está. */
  readonly note?: string;
  /**
   * Las señales que un extracto suyo debería traer, contra las que se mide el
   * parecido de cada documento.
   *
   * Opcional y ausente en la nómina compilada a propósito: describir cómo son los
   * extractos de sesenta y ocho entidades es trabajo de calibración con documentos
   * reales, no algo que se pueda escribir de memoria. Sin descriptor, la medida de
   * parecido devuelve `NO_DESCRIPTOR` y no afecta a nada.
   */
  readonly expectedSignals?: InstitutionSignalDescriptor;
}

/** Prefijo común de las cooperativas: el nombre entrecomillado es lo distintivo. */
const COOPERATIVA = String.raw`COOPERATIVA[\s\S]{0,80}?`;

/**
 * Arma la entrada de una cooperativa a partir de lo único que la distingue.
 *
 * Se hace con un ayudante y no escribiendo 41 objetos iguales porque lo que hay
 * que poder revisar de un vistazo es el nombre y su patrón; el resto —el tipo,
 * la licencia, el prefijo del marcador— es idéntico en las 41 y repetirlo sólo
 * daría sitio a que una se desviara sin que nadie lo notara.
 */
function cooperativa(code: string, name: string, distinctive: string): BoliviaInstitution {
  return {
    code,
    name,
    kind: 'COOPERATIVE',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [new RegExp(COOPERATIVA + distinctive, 'i')],
  };
}

/** Igual, para las ocho instituciones financieras de desarrollo. */
function ifd(code: string, name: string, distinctive: string): BoliviaInstitution {
  return {
    code,
    name,
    kind: 'DEVELOPMENT_IFD',
    licenseStatus: 'LICENSED',
    // Prestan; no captan depósitos del público. Sus estados de cuenta son de
    // crédito, no de una cuenta de ahorro.
    retailDeposits: false,
    markers: [new RegExp(distinctive, 'i')],
  };
}

/** Bancos múltiples (BMU). */
const BANCOS_MULTIPLES: readonly BoliviaInstitution[] = [
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
const BANCOS_PYME: readonly BoliviaInstitution[] = [
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
const ENTIDADES_DEL_ESTADO: readonly BoliviaInstitution[] = [
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
const ENTIDADES_DE_VIVIENDA: readonly BoliviaInstitution[] = [
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

/**
 * Cooperativas de ahorro y crédito abiertas y societarias (CAC).
 *
 * Son 41 y son el grupo más numeroso del padrón —con diferencia—, así que
 * también el que más documentos mandaba a «entidad desconocida» cuando faltaba:
 * el registro anterior sólo tenía cinco. Cada una se distingue
 * por el nombre entrecomillado con el que ASFI la registra.
 */
const COOPERATIVAS: readonly BoliviaInstitution[] = [
  cooperativa(
    'CJN',
    'Cooperativa de Ahorro y Crédito Abierta "Jesús Nazareno" R.L.',
    String.raw`JES[UÚ]S\s+NAZARENO`,
  ),
  cooperativa(
    'CFA',
    'Cooperativa de Ahorro y Crédito Abierta "Fátima" R.L.',
    String.raw`F[AÁ]TIMA`,
  ),
  cooperativa(
    'CSM',
    'Cooperativa de Ahorro y Crédito Abierta "San Martín de Porres" R.L.',
    String.raw`SAN\s+MART[IÍ]N\s+DE\s+PORRES`,
  ),
  cooperativa(
    'CSA',
    'Cooperativa de Ahorro y Crédito Abierta "San Antonio" R.L.',
    String.raw`SAN\s+ANTONIO`,
  ),
  cooperativa(
    'CIH',
    'Cooperativa de Ahorro y Crédito Abierta "Inca Huasi" R.L.',
    String.raw`INCA\s+HUASI`,
  ),
  cooperativa(
    'CQC',
    'Cooperativa de Ahorro y Crédito Abierta "Quillacollo" R.L.',
    String.raw`QUILLACOLLO`,
  ),
  cooperativa(
    'CJP',
    'Cooperativa de Ahorro y Crédito Abierta "San José de Punata" R.L.',
    String.raw`SAN\s+JOS[EÉ]\s+DE\s+PUNATA`,
  ),
  cooperativa(
    'CMM',
    'Cooperativa de Ahorro y Crédito Abierta "Madre y Maestra" R.L.',
    String.raw`MADRE\s+Y\s+MAESTRA`,
  ),
  cooperativa('CLY', 'Cooperativa de Ahorro y Crédito Abierta "Loyola" R.L.', String.raw`LOYOLA`),
  cooperativa(
    'CPX',
    'Cooperativa de Ahorro y Crédito Abierta "Pío X" R.L.',
    String.raw`P[IÍ]O\s*X\b`,
  ),
  cooperativa(
    'CCR',
    'Cooperativa de Ahorro y Crédito Abierta "El Chorolque" R.L.',
    String.raw`EL\s+CHOROLQUE`,
  ),
  cooperativa(
    'CSP',
    'Cooperativa de Ahorro y Crédito Abierta "San Pedro" R.L.',
    String.raw`SAN\s+PEDRO\b(?!\s+DE\s+AIQUILE)`,
  ),
  cooperativa(
    'CCP',
    'Cooperativa de Ahorro y Crédito Abierta "Catedral" R.L.',
    String.raw`CATEDRAL\b(?!\s+DE\s+TARIJA)`,
  ),
  cooperativa(
    'CCM',
    'Cooperativa de Ahorro y Crédito Abierta "Comarapa" R.L.',
    String.raw`COMARAPA`,
  ),
  cooperativa(
    'CTR',
    'Cooperativa de Ahorro y Crédito Abierta "Trinidad" R.L.',
    String.raw`TRINIDAD`,
  ),
  cooperativa(
    'CEC',
    'Cooperativa de Ahorro y Crédito Abierta "Educadores Gran Chaco" R.L.',
    String.raw`EDUCADORES\s+GRAN\s+CHACO`,
  ),
  cooperativa(
    'CST',
    'Cooperativa de Ahorro y Crédito Abierta "San Mateo" R.L.',
    String.raw`SAN\s+MATEO`,
  ),
  cooperativa(
    'CMG',
    'Cooperativa de Ahorro y Crédito Abierta "Monseñor Félix Gainza" R.L.',
    String.raw`MONSE[NÑ]OR\s+F[EÉ]LIX\s+GAINZA`,
  ),
  cooperativa(
    'CMR',
    'Cooperativa de Ahorro y Crédito Abierta "Magisterio Rural" R.L.',
    String.raw`MAGISTERIO\s+RURAL\b(?!\s+DE\s+CHUQUISACA)`,
  ),
  cooperativa(
    'CJB',
    'Cooperativa de Ahorro y Crédito Abierta "San José de Bermejo" R.L.',
    String.raw`SAN\s+JOS[EÉ]\s+DE\s+BERMEJO`,
  ),
  cooperativa(
    'CJO',
    'Cooperativa de Ahorro y Crédito Abierta "San Joaquín" R.L.',
    String.raw`SAN\s+JOAQU[IÍ]N`,
  ),
  cooperativa(
    'CSR',
    'Cooperativa de Ahorro y Crédito Abierta "San Roque" R.L.',
    String.raw`SAN\s+ROQUE`,
  ),
  cooperativa(
    'CAS',
    'Cooperativa de Ahorro y Crédito Abierta "Asunción" R.L.',
    String.raw`ASUNCI[OÓ]N`,
  ),
  cooperativa(
    'CCA',
    'Cooperativa de Ahorro y Crédito Abierta "Catedral de Tarija" R.L.',
    String.raw`CATEDRAL\s+DE\s+TARIJA`,
  ),
  cooperativa(
    'CME',
    'Cooperativa de Ahorro y Crédito Abierta "La Merced" R.L.',
    String.raw`LA\s+MERCED`,
  ),
  cooperativa(
    'CCB',
    'Cooperativa de Ahorro y Crédito Abierta "San Carlos Borromeo" R.L.',
    String.raw`SAN\s+CARLOS\s+BORROMEO`,
  ),
  cooperativa('CCF', 'Cooperativa de Ahorro y Crédito Abierta "CACEF" R.L.', String.raw`CACEF`),
  cooperativa(
    'CPG',
    'Cooperativa de Ahorro y Crédito Abierta "Progreso" R.L.',
    String.raw`PROGRESO\b`,
  ),
  cooperativa(
    'CLS',
    'Cooperativa de Ahorro y Crédito Abierta "La Sagrada Familia" R.L.',
    String.raw`LA\s+SAGRADA\s+FAMILIA`,
  ),
  cooperativa(
    'CMD',
    'Cooperativa de Ahorro y Crédito Abierta "Magisterio Rural de Chuquisaca" R.L.',
    String.raw`MAGISTERIO\s+RURAL\s+DE\s+CHUQUISACA`,
  ),
  cooperativa(
    'CSN',
    'Cooperativa de Ahorro y Crédito Societaria "San Martín" R.L.',
    String.raw`SAN\s+MART[IÍ]N\b(?!\s+DE\s+PORRES)`,
  ),
  cooperativa(
    'CSQ',
    'Cooperativa de Ahorro y Crédito Abierta "San Pedro de Aiquile" R.L.',
    String.raw`SAN\s+PEDRO\s+DE\s+AIQUILE`,
  ),
  cooperativa(
    'CVE',
    'Cooperativa de Ahorro y Crédito Societaria "Virgen de los Remedios" R.L.',
    String.raw`VIRGEN\s+DE\s+LOS\s+REMEDIOS`,
  ),
  cooperativa(
    'CLO',
    'Cooperativa de Ahorro y Crédito Abierta "San Francisco Solano" R.L.',
    String.raw`SAN\s+FRANCISCO\s+SOLANO`,
  ),
  cooperativa(
    'CLC',
    'Cooperativa de Ahorro y Crédito Abierta "Solucredit San Silvestre" R.L.',
    String.raw`SOLUCREDIT\s+SAN\s+SILVESTRE`,
  ),
  cooperativa(
    'COO',
    'Cooperativa de Ahorro y Crédito Abierta "COOPROLE" R.L.',
    String.raw`COOPROLE`,
  ),
  cooperativa(
    'CEY',
    'Cooperativa de Ahorro y Crédito Abierta "Cristo Rey Cochabamba" R.L.',
    String.raw`CRISTO\s+REY`,
  ),
  cooperativa(
    'CPS',
    'Cooperativa de Ahorro y Crédito Abierta "Paulo VI" R.L.',
    String.raw`PAULO\s+VI\b`,
  ),
  cooperativa(
    'CUM',
    'Cooperativa de Ahorro y Crédito Societaria "Unión Santiago de Machaca USAMA" R.L.',
    String.raw`UNI[OÓ]N\s+SANTIAGO\s+DE\s+MACHACA|USAMA`,
  ),
  cooperativa(
    'CAE',
    'Cooperativa de Ahorro y Crédito Societaria "Cantera" R.L.',
    String.raw`CANTERA`,
  ),
  cooperativa(
    'CHO',
    'Cooperativa de Ahorro y Crédito Societaria "Hospicio" R.L.',
    String.raw`HOSPICIO`,
  ),
];

/** Instituciones financieras de desarrollo (IFD). */
const INSTITUCIONES_DE_DESARROLLO: readonly BoliviaInstitution[] = [
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
const ENTIDADES_SIN_LICENCIA: readonly BoliviaInstitution[] = [
  {
    code: 'BFS',
    name: 'Banco Fassil S.A.',
    kind: 'MULTIPLE_BANK',
    licenseStatus: 'REVOKED',
    retailDeposits: true,
    markers: [/BANCO\s+FASSIL/i, /\bFASSIL\b/i],
    note: 'Intervenido por ASFI el 26 de abril de 2023; su cartera y depósitos se transfirieron a otros bancos.',
  },
];

/** El padrón completo, en el orden en que ASFI publica su nómina. */
export const BOLIVIA_INSTITUTIONS: readonly BoliviaInstitution[] = [
  ...BANCOS_MULTIPLES,
  ...BANCOS_PYME,
  ...ENTIDADES_DEL_ESTADO,
  ...ENTIDADES_DE_VIVIENDA,
  ...COOPERATIVAS,
  ...INSTITUCIONES_DE_DESARROLLO,
  ...ENTIDADES_SIN_LICENCIA,
];

/**
 * Cuántos marcadores de la entidad coinciden con el texto, y 0 si una exclusión
 * la desmiente.
 *
 * Contar en lugar de responder sí/no es lo que permite desempatar entre dos
 * entidades cuyos marcadores coinciden a la vez: gana la que aporta más
 * evidencia, no la que aparece antes en el padrón.
 */
export function countMarkerHits(institution: BoliviaInstitution, text: string): number {
  if (institution.exclusions?.some((exclusion) => exclusion.test(text))) return 0;
  return institution.markers.filter((marker) => marker.test(text)).length;
}
