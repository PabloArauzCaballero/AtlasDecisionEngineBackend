/**
 * CATÁLOGO DE LA CÉDULA DE IDENTIDAD BOLIVIANA.
 *
 * ## Qué es este archivo, y por qué no es una lista de expresiones regulares más
 *
 * Hasta ahora el worker sabía RECONOCER una cédula —`identity-evidence.ts` mide
 * si hay un documento de identidad delante— pero no sabía cómo **debería verse**
 * la cédula boliviana concreta. La diferencia importa exactamente donde importa
 * el fraude: una falsificación casera contiene la palabra «CÉDULA DE IDENTIDAD»,
 * lleva una foto y tiene la proporción de una tarjeta, así que supera con
 * holgura la puerta de evidencia. Lo que NO tiene es la plantilla completa: le
 * faltan rótulos, la MRZ no cuadra sus dígitos de control, el número no respeta
 * el formato del SEGIP, las fechas no son coherentes entre sí y el lugar de
 * expedición no existe.
 *
 * Este catálogo es esa plantilla, escrita como dato y no como código, para que
 * la conformidad se pueda MEDIR campo a campo y para que quien revise un caso
 * pueda leer qué faltaba. Es la referencia contra la que trabajan
 * `core/forensics/*`.
 *
 * ## De dónde salen los datos
 *
 * De fuentes públicas, y están anotadas una a una en `FUENTES`. **No hay ni una
 * sola imagen de una cédula real en este repositorio, ni la habrá**: una cédula
 * de verdad es el dato con el que se suplanta a una persona, y guardar ejemplos
 * «para calibrar» es fabricar exactamente la fuga que este worker existe para
 * prevenir. Lo que se cataloga es la ESPECIFICACIÓN —qué rótulos lleva, en qué
 * orden, con qué formato— que es información pública publicada por el propio
 * emisor, y los ejemplares sintéticos de `fixtures/identity-card.ts`, dibujados
 * por nosotros contra esta misma especificación.
 *
 * ## Las dos generaciones conviven, y las dos son válidas
 *
 * El DS 4924 (1 de noviembre de 2023) rediseñó la tarjeta entera y le añadió
 * MRZ. Las cédulas emitidas antes siguen vigentes hasta su caducidad, así que
 * durante años se van a presentar las dos. Exigir la plantilla nueva a una
 * cédula legítima de 2021 la rechazaría por falsa, que es el peor error posible
 * de este módulo: el falso positivo le cierra el producto a alguien que no hizo
 * nada mal y no tiene forma de arreglarlo.
 *
 * Por eso la conformidad se mide contra CADA generación y se queda con la mejor:
 * un documento tiene que parecerse mucho a *alguna* cédula boliviana real, no a
 * la última.
 */

import { IdentityDocumentType } from '../domain/identity-enums';

/** Las generaciones de la tarjeta que hoy pueden presentarse legítimamente. */
export enum BoliviaCiGeneration {
  /** Rediseño del DS 4924, vigente desde el 1 de noviembre de 2023. Lleva MRZ TD1. */
  DS_4924_2023 = 'DS_4924_2023',
  /** Formato rotulado anterior, con código QR (DS 4342, 2020) o código de barras (2011). */
  PRE_2023 = 'PRE_2023',
}

/**
 * Un anclaje del catálogo: algo que la tarjeta IMPRIME y que se puede buscar en
 * el texto leído.
 *
 * `peso` no es una preferencia estética. Es cuánto cuesta falsificar ese
 * anclaje: el rótulo «NOMBRES» lo escribe cualquiera en un editor de imágenes y
 * pesa poco; la MRZ con sus dígitos de control cuadrados exige haber generado
 * los checksums de la ICAO y pesa mucho.
 */
export interface AnclajeDeCatalogo {
  readonly id: string;
  /** Dónde se imprime. `AMBAS` cuando la cara depende de la generación. */
  readonly cara: 'ANVERSO' | 'REVERSO' | 'AMBAS';
  readonly patron: RegExp;
  readonly peso: number;
  /**
   * `true` cuando su ausencia, por sí sola, ya es motivo de sospecha: son los
   * rótulos que TODA cédula de esa generación imprime sin excepción.
   */
  readonly obligatorio: boolean;
  /** Para qué sirve, en una frase que un analista pueda leer en el caso. */
  readonly descripcion: string;
}

/** La plantilla completa de una generación. */
export interface PlantillaDeCedula {
  readonly generacion: BoliviaCiGeneration;
  readonly nombre: string;
  readonly vigenteDesde: string;
  readonly anclajes: readonly AnclajeDeCatalogo[];
  /** Si esa generación imprime zona de lectura mecánica TD1 en el reverso. */
  readonly llevaMrz: boolean;
  /** Si imprime código QR (2020+) o código de barras (2011–2020). */
  readonly codigoOptico: 'QR' | 'BARRAS' | 'NINGUNO';
  /** Años de vigencia habituales de la tarjeta física. */
  readonly vigenciaAnios: readonly number[];
}

/*
 * ── Anclajes comunes a las dos generaciones ────────────────────────────────
 *
 * Se escriben una sola vez y se referencian desde las dos plantillas: dos copias
 * de la misma expresión acaban separándose, y el día que se separen una cédula
 * legítima puntuará distinto según qué generación se le suponga.
 *
 * Todos los patrones se evalúan sobre el texto YA PLEGADO —mayúsculas y sin
 * tildes, `plegarTexto` de `identity-evidence.ts`—, así que aquí no hay
 * variantes acentuadas: `CEDULA`, nunca `CÉDULA`.
 */

const ESTADO_EMISOR: AnclajeDeCatalogo = {
  id: 'estado-emisor',
  cara: 'ANVERSO',
  patron: /ESTADO\s+PLURINACIONAL\s+DE\s+BOLIVIA/u,
  peso: 0.1,
  obligatorio: true,
  descripcion: 'El rótulo del Estado emisor, en la cabecera del anverso.',
};

const AUTORIDAD_SEGIP: AnclajeDeCatalogo = {
  id: 'autoridad-segip',
  cara: 'ANVERSO',
  patron: /SERVICIO\s+GENERAL\s+DE\s+IDENTIFICACION\s+PERSONAL|\bSEGIP\b/u,
  peso: 0.1,
  obligatorio: true,
  descripcion: 'La autoridad emisora: SEGIP, por su nombre completo o su sigla.',
};

const ROTULO_CEDULA: AnclajeDeCatalogo = {
  id: 'rotulo-cedula',
  cara: 'ANVERSO',
  patron: /CEDULA\s+DE\s+IDENTIDAD/u,
  peso: 0.08,
  obligatorio: true,
  descripcion: 'El nombre del documento.',
};

const CAMPO_NOMBRES: AnclajeDeCatalogo = {
  id: 'campo-nombres',
  cara: 'ANVERSO',
  patron: /\bNOMBRES?\b/u,
  peso: 0.07,
  obligatorio: true,
  descripcion: 'El rótulo NOMBRES del anverso.',
};

const CAMPO_APELLIDOS: AnclajeDeCatalogo = {
  id: 'campo-apellidos',
  cara: 'ANVERSO',
  patron: /\bAPELLIDOS?\b/u,
  peso: 0.07,
  obligatorio: true,
  descripcion: 'El rótulo APELLIDOS del anverso.',
};

const CAMPO_NACIMIENTO: AnclajeDeCatalogo = {
  id: 'campo-fecha-nacimiento',
  cara: 'ANVERSO',
  patron: /FECHA\s+DE\s+NACIMIENTO|NACID[OA]\s+EL/u,
  peso: 0.07,
  obligatorio: true,
  descripcion: 'La fecha de nacimiento, rotulada o en la redacción del formato antiguo.',
};

const CAMPO_EXPIRACION: AnclajeDeCatalogo = {
  id: 'campo-fecha-expiracion',
  cara: 'ANVERSO',
  patron: /FECHA\s+DE\s+(?:EXPIRACION|VENCIMIENTO|CADUCIDAD)|VALID[AO]\s+HASTA/u,
  peso: 0.07,
  obligatorio: true,
  descripcion: 'La caducidad impresa. Sin ella no se puede afirmar que el documento esté vigente.',
};

const CAMPO_EMISION: AnclajeDeCatalogo = {
  id: 'campo-fecha-emision',
  cara: 'ANVERSO',
  patron: /FECHA\s+DE\s+(?:EMISION|EXPEDICION)/u,
  peso: 0.04,
  obligatorio: false,
  descripcion: 'La fecha de emisión. El formato antiguo no siempre la rotula.',
};

/*
 * SERIE y SECCIÓN son el par que casi nadie falsifica bien.
 *
 * Son dos campos administrativos del SEGIP que aparecen juntos en el anverso y
 * que quien copia una cédula de una imagen de internet suele omitir, porque no
 * significan nada evidente para el que la copia. Pesan más que un rótulo
 * cualquiera por eso: no por lo que prueban, sino por lo que su AUSENCIA sugiere
 * cuando el resto de la tarjeta sí está.
 */
const CAMPO_SERIE: AnclajeDeCatalogo = {
  id: 'campo-serie',
  cara: 'ANVERSO',
  patron: /\bSERIE\b/u,
  peso: 0.05,
  obligatorio: false,
  descripcion: 'El campo SERIE del anverso, administrativo del SEGIP.',
};

const CAMPO_SECCION: AnclajeDeCatalogo = {
  id: 'campo-seccion',
  cara: 'ANVERSO',
  patron: /\bSECCION\b/u,
  peso: 0.05,
  obligatorio: false,
  descripcion: 'El campo SECCIÓN del anverso, administrativo del SEGIP.',
};

const CAMPO_LUGAR_NACIMIENTO: AnclajeDeCatalogo = {
  id: 'campo-lugar-nacimiento',
  cara: 'REVERSO',
  patron: /LUGAR\s+DE\s+NACIMIENTO/u,
  peso: 0.06,
  obligatorio: false,
  descripcion: 'El lugar de nacimiento del reverso: departamento, provincia y localidad.',
};

const CAMPO_DOMICILIO: AnclajeDeCatalogo = {
  id: 'campo-domicilio',
  cara: 'REVERSO',
  patron: /\bDOMICILIO\b/u,
  peso: 0.05,
  obligatorio: false,
  descripcion: 'El domicilio declarado, en el reverso.',
};

const CAMPO_ESTADO_CIVIL: AnclajeDeCatalogo = {
  id: 'campo-estado-civil',
  cara: 'REVERSO',
  patron: /ESTADO\s+CIVIL/u,
  peso: 0.04,
  obligatorio: false,
  descripcion: 'El estado civil, en el reverso.',
};

const CAMPO_OCUPACION: AnclajeDeCatalogo = {
  id: 'campo-ocupacion',
  cara: 'REVERSO',
  patron: /PROFESION\s+U\s+OCUPACION|\bOCUPACION\b/u,
  peso: 0.04,
  obligatorio: false,
  descripcion: 'La profesión u ocupación, en el reverso.',
};

/*
 * Los dos campos que SÓLO existen en la tarjeta del DS 4924.
 *
 * El grupo sanguíneo es opcional para el titular, así que su ausencia no dice
 * nada; su PRESENCIA, en cambio, sitúa la tarjeta en la generación nueva sin
 * ambigüedad. El NPIOC es específico de la normativa boliviana y no aparece en
 * ningún documento de identidad de otro país: es de los anclajes más difíciles
 * de acertar por casualidad.
 */
const CAMPO_GRUPO_SANGUINEO: AnclajeDeCatalogo = {
  id: 'campo-grupo-sanguineo',
  cara: 'REVERSO',
  patron: /GRUPO\s+SANGUINEO/u,
  peso: 0.05,
  obligatorio: false,
  descripcion: 'El grupo sanguíneo, opcional para el titular y exclusivo del formato 2023.',
};

const CAMPO_NPIOC: AnclajeDeCatalogo = {
  id: 'campo-npioc',
  cara: 'REVERSO',
  patron: /NACION\s+O\s+PUEBLO\s+INDIGENA|\bNPIOC\b/u,
  peso: 0.06,
  obligatorio: false,
  descripcion:
    'La nación o pueblo indígena originario campesino. Exclusivo de la normativa boliviana.',
};

/**
 * La MRZ, y el anclaje que MÁS pesa de todo el catálogo.
 *
 * Aquí sólo se comprueba que el renglón exista con la forma de una TD1. Que sus
 * dígitos de control CUADREN es una comprobación aparte y mucho más fuerte, y la
 * hace `parseMrzTd1` — este anclaje mide presencia, no validez.
 */
const ZONA_MRZ: AnclajeDeCatalogo = {
  id: 'zona-mrz-td1',
  cara: 'REVERSO',
  patron: /(?:^|\n)\s*(?:I|ID)[A-Z<]{2,}[A-Z0-9<]{10,}/u,
  peso: 0.12,
  obligatorio: true,
  descripcion: 'La zona de lectura mecánica TD1 del reverso, obligatoria desde el DS 4924.',
};

/** El emisor declarado dentro de la MRZ. `BOL` es el código ISO 3166-1 de Bolivia. */
const MRZ_EMISOR_BOL: AnclajeDeCatalogo = {
  id: 'mrz-emisor-bol',
  cara: 'REVERSO',
  patron: /(?:^|\n)\s*I?D?[A-Z<]{0,2}BOL/u,
  peso: 0.06,
  obligatorio: false,
  descripcion: 'El código de emisor BOL dentro de la MRZ.',
};

export const PLANTILLA_DS_4924_2023: PlantillaDeCedula = {
  generacion: BoliviaCiGeneration.DS_4924_2023,
  nombre: 'Cédula de identidad del Bicentenario (DS 4924)',
  vigenteDesde: '2023-11-01',
  llevaMrz: true,
  codigoOptico: 'QR',
  // Cinco años para el común de los titulares; indefinida a partir de los 58 y
  // para personas con discapacidad grave; dos para el formato digital.
  vigenciaAnios: [2, 5],
  anclajes: [
    ESTADO_EMISOR,
    AUTORIDAD_SEGIP,
    ROTULO_CEDULA,
    CAMPO_NOMBRES,
    CAMPO_APELLIDOS,
    CAMPO_NACIMIENTO,
    CAMPO_EMISION,
    CAMPO_EXPIRACION,
    CAMPO_SERIE,
    CAMPO_SECCION,
    CAMPO_LUGAR_NACIMIENTO,
    CAMPO_DOMICILIO,
    CAMPO_ESTADO_CIVIL,
    CAMPO_OCUPACION,
    CAMPO_GRUPO_SANGUINEO,
    CAMPO_NPIOC,
    ZONA_MRZ,
    MRZ_EMISOR_BOL,
  ],
};

export const PLANTILLA_PRE_2023: PlantillaDeCedula = {
  generacion: BoliviaCiGeneration.PRE_2023,
  nombre: 'Cédula de identidad anterior al DS 4924',
  vigenteDesde: '2011-01-01',
  llevaMrz: false,
  codigoOptico: 'QR',
  vigenciaAnios: [5, 10],
  anclajes: [
    ESTADO_EMISOR,
    AUTORIDAD_SEGIP,
    ROTULO_CEDULA,
    CAMPO_NOMBRES,
    CAMPO_APELLIDOS,
    CAMPO_NACIMIENTO,
    CAMPO_EXPIRACION,
    CAMPO_SERIE,
    CAMPO_SECCION,
    CAMPO_LUGAR_NACIMIENTO,
    CAMPO_DOMICILIO,
    CAMPO_ESTADO_CIVIL,
    CAMPO_OCUPACION,
  ],
};

export const PLANTILLAS: readonly PlantillaDeCedula[] = [
  PLANTILLA_DS_4924_2023,
  PLANTILLA_PRE_2023,
];

/*
 * ── El número de cédula ────────────────────────────────────────────────────
 */

/**
 * El número de cédula boliviano, con su complemento opcional.
 *
 * - Entre cinco y ocho dígitos. Por debajo de cinco no hay cédulas emitidas; por
 *   encima de ocho el número deja de ser un número de cédula y pasa a ser el de
 *   control de impresión, que la tarjeta también lleva y que este worker ya sabe
 *   excluir (`bolivia-ci-document.parser.ts`).
 * - Sin cero a la izquierda: el SEGIP no los emite y un `0` delante es la firma
 *   de un número tecleado en un formulario que lo rellenó a lo ancho.
 * - Complemento opcional de DOS caracteres alfanuméricos tras un guion —`1A`,
 *   `2B`—. Lo asigna el SEGIP a los números duplicados, así que una cédula sin
 *   complemento es lo normal y una CON complemento es igual de legítima.
 */
export const NUMERO_CEDULA = /^(?!0)(\d{5,8})(?:-([0-9A-Z]{1,2}))?$/u;

/** ¿Este texto tiene la forma de un número de cédula boliviano? */
export function esNumeroDeCedulaValido(valor: string | null | undefined): boolean {
  if (!valor) return false;
  return NUMERO_CEDULA.test(valor.trim().toUpperCase());
}

/**
 * Los nueve departamentos, más el rótulo con el que cada uno se abrevia en la
 * tarjeta.
 *
 * La cédula se expide POR DEPARTAMENTO y lo imprime junto al número —`1234567
 * SC`—. Un lugar de expedición que no esté en esta lista no es un error de
 * lectura: es un dato que el SEGIP no puede haber impreso.
 */
export const DEPARTAMENTOS_DE_EXPEDICION: Readonly<Record<string, string>> = {
  CH: 'Chuquisaca',
  LP: 'La Paz',
  CB: 'Cochabamba',
  OR: 'Oruro',
  PT: 'Potosí',
  TJ: 'Tarija',
  SC: 'Santa Cruz',
  BE: 'Beni',
  PD: 'Pando',
};

/** Nombres completos de departamento, plegados, para reconocerlos en el texto. */
export const NOMBRES_DE_DEPARTAMENTO: readonly string[] = [
  'CHUQUISACA',
  'LA PAZ',
  'COCHABAMBA',
  'ORURO',
  'POTOSI',
  'TARIJA',
  'SANTA CRUZ',
  'BENI',
  'PANDO',
];

/*
 * ── Sondas para el clasificador por transformers ───────────────────────────
 *
 * El clasificador semántico no busca palabras: proyecta el texto leído y estas
 * sondas al mismo espacio vectorial y mide el coseno. Por eso las sondas están
 * REDACTADAS como frases y no como listas de rótulos — un vector de una lista de
 * palabras sueltas no representa nada.
 *
 * Las NEGATIVAS son la mitad que hace el trabajo. Sin contraejemplos, el
 * clasificador contesta «se parece bastante» a cualquier documento oficial del
 * mundo, porque todos los documentos oficiales se parecen entre sí más de lo que
 * se parecen a un recibo. Con ellas, la pregunta pasa a ser la correcta: ¿se
 * parece MÁS a una cédula boliviana que a un DNI peruano, a una licencia de
 * conducir o a una plantilla descargada de internet?
 */

export interface SondaDeCatalogo {
  readonly id: string;
  readonly texto: string;
  /** `true` describe una cédula boliviana legítima; `false`, algo que no lo es. */
  readonly positiva: boolean;
}

export const SONDAS_BOLIVIA_CI: readonly SondaDeCatalogo[] = [
  {
    id: 'ci-2023-anverso',
    positiva: true,
    texto:
      'Estado Plurinacional de Bolivia. Servicio General de Identificación Personal. Cédula de identidad con nombres, apellidos, fecha de nacimiento, fecha de emisión y fecha de expiración, con serie y sección, número de cédula y fotografía del titular.',
  },
  {
    id: 'ci-2023-reverso',
    positiva: true,
    texto:
      'Reverso de la cédula de identidad boliviana con lugar de nacimiento por departamento, provincia y localidad, domicilio, profesión u ocupación, estado civil, grupo sanguíneo, nación o pueblo indígena originario campesino, firma del titular y zona de lectura mecánica.',
  },
  {
    id: 'ci-antigua',
    positiva: true,
    texto:
      'Cédula de identidad boliviana del formato anterior expedida por el SEGIP, válida hasta una fecha, con el nombre del titular, nacido el día indicado, en una localidad de Bolivia, con serie y sección y el número de cédula seguido de la sigla del departamento de expedición.',
  },
  {
    id: 'ci-mrz',
    positiva: true,
    texto:
      'Documento de identidad boliviano con zona de lectura mecánica de tres renglones en formato TD1, código de emisor BOL, número de documento con dígito de control, fecha de nacimiento, sexo, fecha de expiración y apellidos separados de los nombres por dobles chevrones.',
  },
  {
    id: 'no-factura',
    positiva: false,
    texto:
      'Factura electrónica con número de autorización, código de control, NIT del emisor, detalle de productos, subtotal, importe total y la leyenda de que contribuye al desarrollo del país.',
  },
  {
    id: 'no-extracto',
    positiva: false,
    texto:
      'Extracto de cuenta bancaria con saldo anterior, movimientos por fecha, débitos, créditos y saldo final del período.',
  },
  {
    id: 'no-licencia',
    positiva: false,
    texto:
      'Licencia para conducir con categoría del vehículo, restricciones médicas, número de licencia, fecha de emisión y autoridad de tránsito.',
  },
  {
    id: 'no-pasaporte',
    positiva: false,
    texto:
      'Pasaporte con tipo P, código de país, número de pasaporte, autoridad de expedición, lugar de nacimiento y zona de lectura mecánica de dos renglones de cuarenta y cuatro caracteres.',
  },
  {
    id: 'no-documento-extranjero',
    positiva: false,
    texto:
      'Documento nacional de identidad de otro país sudamericano con número de registro civil, nombre completo, fecha de nacimiento y sello del registro nacional de identificación de ese país.',
  },
  {
    id: 'no-plantilla',
    positiva: false,
    texto:
      'Plantilla de muestra descargada de internet con campos de ejemplo, texto lorem ipsum, la palabra SPECIMEN o MUESTRA sobreimpresa y marcas de agua del sitio que la distribuye.',
  },
  {
    id: 'no-certificado',
    positiva: false,
    texto:
      'Certificado de nacimiento o partida de nacimiento emitida por el registro civil, con número de partida, libro, folio y firma del oficial de registro.',
  },
  {
    id: 'no-carnet-privado',
    positiva: false,
    texto:
      'Credencial de una empresa o universidad con el nombre de la institución, el cargo o la carrera del portador, un número de legajo y la fecha de validez del gafete.',
  },
];

/**
 * Marcas que un documento LEGÍTIMO nunca imprime y que delatan una plantilla,
 * una muestra o un montaje.
 *
 * Van aparte de los contraindicadores de `identity-evidence.ts` —que reconocen
 * OTRO documento— porque éstas no dicen «esto es una factura»: dicen «esto es
 * una cédula, y es falsa». La consecuencia también es distinta: allí el caso se
 * cierra, aquí el caso ESCALA con una marca de fraude, porque afirmar que un
 * documento está falsificado es una acusación y no la debe firmar una heurística
 * a solas.
 */
export const MARCAS_DE_FALSIFICACION: ReadonlyArray<{
  readonly codigo: string;
  readonly patron: RegExp;
  readonly descripcion: string;
}> = [
  {
    codigo: 'SPECIMEN_WATERMARK',
    patron: /\bSPECIMEN\b|\bMUESTRA\b|\bSAMPLE\b|\bVOID\b|\bDUMMY\b/u,
    descripcion: 'La tarjeta lleva sobreimpresa la marca de un ejemplar de muestra.',
  },
  {
    codigo: 'TEMPLATE_PLACEHOLDER',
    patron:
      /LOREM\s+IPSUM|\bXXXX+\b|\bNOMBRE\s+APELLIDO\b|\bJOHN\s+DOE\b|\bYOUR\s+NAME\b|\bTU\s+NOMBRE\b/u,
    descripcion: 'Quedan textos de relleno de una plantilla sin completar.',
  },
  {
    codigo: 'STOCK_IMAGE_MARK',
    patron: /SHUTTERSTOCK|GETTY\s*IMAGES|ALAMY|DREAMSTIME|123RF|FREEPIK|ISTOCKPHOTO/u,
    descripcion: 'La imagen lleva la marca de agua de un banco de imágenes.',
  },
  {
    codigo: 'EDITOR_ARTIFACT',
    patron: /PHOTOSHOP|\bPSD\b|CANVA\.COM|EDITABLE\s+TEMPLATE|PLANTILLA\s+EDITABLE/u,
    descripcion: 'Hay rastros del editor con el que se compuso la imagen.',
  },
  {
    codigo: 'DOCUMENT_NOT_VALID_MARK',
    patron: /NO\s+VALIDO\s+COMO\s+DOCUMENTO|SIN\s+VALOR\s+LEGAL|NOT\s+FOR\s+OFFICIAL\s+USE/u,
    descripcion: 'El propio documento declara por escrito que no tiene validez.',
  },
];

/** El tipo de documento al que se refiere todo este catálogo. */
export const TIPO_CATALOGADO = IdentityDocumentType.BOLIVIA_CI;

/**
 * De dónde sale cada dato de este archivo.
 *
 * Están aquí y no en un `docs/` aparte a propósito: quien vaya a mover un peso o
 * a añadir un anclaje tiene que poder comprobar la fuente sin salir del archivo,
 * porque la tentación de «ajustar hasta que pase el caso que me trajo» es
 * exactamente lo que convierte un catálogo en una superstición.
 */
export const FUENTES: ReadonlyArray<{ readonly que: string; readonly donde: string }> = [
  {
    que: 'Rótulos impresos, medidas, material, campos del anverso y del reverso, vigencias e historia de versiones (2011, DS 4342 de 2020, DS 4861 y DS 4924 de 2023).',
    donde: 'https://es.wikipedia.org/wiki/C%C3%A9dula_de_identidad_(Bolivia)',
  },
  {
    que: 'Medidas de seguridad del rediseño de 2023: MRZ, código QR, microimpresiones, guilloché tricolor, fotografía sin fondo blanco, firma y huella digitalizadas.',
    donde:
      'https://www.reduno.com.bo/noticias/gobierno-presenta-la-nueva-cedula-de-identidad-y-asi-se-ve-202311195818',
  },
  {
    que: 'Competencia del SEGIP sobre el Registro Único de Identificación y la emisión de la cédula.',
    donde: 'https://www.segip.gob.bo/',
  },
  {
    que: 'Complemento alfanumérico del número de cédula: por qué existe y qué forma tiene.',
    donde: 'https://boliviaimpuestos.com/complemento-del-carnet-de-identidad/',
  },
  {
    que: 'Estructura de la MRZ TD1 de tres renglones de 30 caracteres y sus dígitos de control.',
    donde: 'ICAO Doc 9303, parte 5 — implementada en core/parsers/mrz-td1.ts',
  },
];
