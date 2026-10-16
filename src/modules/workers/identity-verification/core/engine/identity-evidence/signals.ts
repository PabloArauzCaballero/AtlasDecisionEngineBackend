import { casarGrafias } from '../../catalog/approximate-match';

/**
 * Una señal, con el peso que justifica lo que demuestra.
 *
 * `casa` es la comprobación exacta y `grafias` la tolerante: basta una de las
 * dos. La segunda existe por lo mismo que en el catálogo de la cédula —los
 * rótulos de una tarjeta real vuelven mutilados del reconocedor— y con la misma
 * salvaguarda: sólo se cotean con tolerancia los rótulos de ocho caracteres o
 * más, y la tolerancia es un error por cada cinco (`approximate-match.ts`).
 *
 * Las señales ESTRUCTURALES —la MRZ, la proporción de la tarjeta— no llevan
 * grafías: no son texto impreso y «parecerse» a ellas no significa nada.
 */
interface SenalDeIdentidad {
  readonly id: string;
  readonly peso: number;
  readonly casa: (evidencia: TextoYForma) => boolean;
  readonly grafias?: readonly string[];
}

export interface TextoYForma {
  /** Texto leído de las dos caras, ya en mayúsculas y sin tildes. */
  readonly texto: string;
  /** El mismo texto reducido a `[A-Z0-9]`, para el cotejo tolerante. */
  readonly cotejo?: string;
  /** Lado largo de la imagen normalizada, en píxeles. */
  readonly anchoLargo: number;
  /** Lado corto de la imagen normalizada, en píxeles. */
  readonly ladoCorto: number;
}

/**
 * Documentos que NO son de identidad y lo declaran por escrito.
 *
 * No son palabras que «suenan» a otra cosa: son marcas que sólo existen en ese
 * otro papel. El código de control y el número de autorización los pone el SIN
 * en cada factura; «saldo anterior» sólo lo imprime un extracto. Encontrarlos no
 * es evidencia en contra —es la respuesta—, así que cierran el caso sin sumar
 * nada más. Es lo que impide que una factura con foto de perfil escaneada al
 * lado acumule señales sueltas hasta colarse en la franja de duda.
 */
export const CONTRAINDICADORES: ReadonlyArray<{ tipo: string; patron: RegExp }> = [
  {
    tipo: 'TAX_INVOICE',
    patron:
      /CODIGO\s+DE\s+CONTROL|NUMERO\s+DE\s+AUTORIZACION|FACTURA\s+(?:ELECTRONICA|COMPUTARIZADA)|ESTA\s+FACTURA\s+CONTRIBUYE|NIT\s*[:#]/u,
  },
  {
    tipo: 'BANK_STATEMENT',
    patron: /SALDO\s+ANTERIOR|EXTRACTO\s+DE\s+(?:CUENTA|MOVIMIENTOS)|ESTADO\s+DE\s+CUENTA/u,
  },
  { tipo: 'RECEIPT', patron: /TOTAL\s+A\s+PAGAR|SUBTOTAL|RECIBO\s+DE\s+CAJA|SU\s+CAMBIO/u },
  { tipo: 'PAYROLL_SLIP', patron: /BOLETA\s+DE\s+PAGO|PLANILLA\s+DE\s+(?:SUELDOS|HABERES)/u },
  {
    tipo: 'CIVIL_CERTIFICATE',
    patron: /CERTIFICADO\s+DE\s+(?:NACIMIENTO|MATRIMONIO|DEFUNCION)|PARTIDA\s+DE\s+NACIMIENTO/u,
  },
  { tipo: 'SCREENSHOT', patron: /HTTPS?:\/\/|WWW\.[A-Z0-9-]+\.[A-Z]{2,}/u },
  {
    tipo: 'ACADEMIC',
    patron: /DIPLOMA\s+DE|TITULO\s+(?:PROFESIONAL|ACADEMICO)|CERTIFICADO\s+DE\s+NOTAS/u,
  },
];

/**
 * Campos que un documento de identidad rotula y casi ningún otro papel junta.
 *
 * Cada uno con su patrón exacto y las grafías que la tarjeta imprime. Sin las
 * grafías esta señal no se disparaba sobre una cédula real: medido, de los diez
 * rótulos el reconocedor devolvía `PFrCHA DE MACIMIENTO`, `FECHA DI EMIBION` y
 * `rca DE FAPIRACIÓN`, ninguno de los cuales casa con su expresión regular. Se
 * perdían 0,2 de evidencia —la sexta parte del total— sobre un documento que
 * tenía los tres campos perfectamente impresos y perfectamente leídos.
 */
const CAMPOS_PERSONALES: ReadonlyArray<{
  readonly patron: RegExp;
  readonly grafias: readonly string[];
}> = [
  { patron: /\bAPELLIDOS?\b/u, grafias: ['APELLIDOS'] },
  { patron: /\bNOMBRES?\b/u, grafias: [] },
  {
    patron: /FECHA\s+DE\s+NACIMIENTO|NACIDO\s+EL|DATE\s+OF\s+BIRTH/u,
    grafias: ['FECHA DE NACIMIENTO', 'NACIMIENTO', 'DATE OF BIRTH'],
  },
  {
    patron: /LUGAR\s+DE\s+NACIMIENTO|PLACE\s+OF\s+BIRTH/u,
    grafias: ['LUGAR DE NACIMIENTO', 'PLACE OF BIRTH'],
  },
  {
    patron: /\bNACIONALIDAD\b|\bNATIONALITY\b/u,
    grafias: ['NACIONALIDAD', 'NATIONALITY'],
  },
  { patron: /ESTADO\s+CIVIL/u, grafias: ['ESTADO CIVIL'] },
  { patron: /\bDOMICILIO\b/u, grafias: ['DOMICILIO'] },
  {
    patron: /FECHA\s+DE\s+(?:EMISION|EXPEDICION)/u,
    grafias: ['FECHA DE EMISION', 'FECHA DE EXPEDICION'],
  },
  {
    patron: /FECHA\s+DE\s+(?:VENCIMIENTO|CADUCIDAD|EXPIRACION)|VALIDO\s+HASTA|DATE\s+OF\s+EXPIRY/u,
    grafias: ['FECHA DE EXPIRACION', 'EXPIRACION', 'VENCIMIENTO', 'CADUCIDAD', 'DATE OF EXPIRY'],
  },
  { patron: /\bSEXO\b|\bSEX\b/u, grafias: [] },
];

/** Con dos rótulos ya no es casualidad; con uno, todavía puede serlo. */
const MINIMO_CAMPOS_PERSONALES = 2;

/**
 * La MRZ, leída con tolerancia a los fallos típicos del reconocedor.
 *
 * Se acepta a partir de veinticinco caracteres del alfabeto de la zona —en vez
 * de los treinta exactos de una TD1— porque el OCR se come el último `<` de la
 * línea con más frecuencia de la que cabría desear, y exigir la longitud exacta
 * convertía un documento perfectamente válido en «no es un documento».
 */
const MRZ = /(?:^|\n)[A-Z0-9<]{25,44}(?:\n|$)/u;
/**
 * El arranque de una MRZ, y el relleno `<<` es OBLIGATORIO en el patrón.
 *
 * Sin él, `ID[A-Z]{3}` casa dentro de la palabra **IDENTIDAD** —`ID` + `ENT`—,
 * de modo que la señal más pesada del archivo se disparaba con el rótulo de
 * cualquier cédula y una foto que sólo dijera «CÉDULA DE IDENTIDAD» acumulaba
 * 0,60 y se aceptaba sin haber leído un solo campo. Una MRZ real siempre trae
 * relleno; una palabra española, nunca.
 */
const MRZ_PREFIJO = /\b(?:ID[A-Z]{3}|P<[A-Z]{3})[A-Z0-9<]*<{2}/u;

export const SENALES: readonly SenalDeIdentidad[] = [
  {
    // Lo que el documento DICE ser. Es la señal más directa que existe.
    id: 'identity-title',
    peso: 0.3,
    casa: ({ texto }) =>
      /CEDULA\s+DE\s+IDENTIDAD|DOCUMENTO\s+DE\s+IDENTIDAD|IDENTITY\s+CARD|\bC\.?\s?I\.?\b|PASAPORTE|PASSPORT|LICENCIA\s+(?:DE\s+)?CONDUCIR/u.test(
        texto,
      ),
    grafias: [
      'CEDULA DE IDENTIDAD',
      'DOCUMENTO DE IDENTIDAD',
      'IDENTITY CARD',
      // El rótulo suelto: el reconocedor parte «CÉDULA DE IDENTIDAD» en dos
      // renglones con muchísima frecuencia y sólo sobrevive la segunda mitad.
      'IDENTIDAD',
      'PASAPORTE',
      'PASSPORT',
      'LICENCIA DE CONDUCIR',
    ],
  },
  {
    // Quién lo emitió. Sólo un Estado imprime esto en una tarjeta.
    id: 'issuing-authority',
    peso: 0.2,
    casa: ({ texto }) =>
      /\bSEGIP\b|SERVICIO\s+GENERAL\s+DE\s+IDENTIFICACION|ESTADO\s+PLURINACIONAL\s+DE\s+BOLIVIA|DIRECCION\s+GENERAL\s+DE\s+MIGRACION|POLICIA\s+BOLIVIANA/u.test(
        texto,
      ),
    grafias: [
      'SERVICIO GENERAL DE IDENTIFICACION',
      'IDENTIFICACION PERSONAL',
      'ESTADO PLURINACIONAL DE BOLIVIA',
      'PLURINACIONAL',
      'DIRECCION GENERAL DE MIGRACION',
      'POLICIA BOLIVIANA',
    ],
  },
  {
    // Formato normalizado por OACI. No aparece por accidente en ningún otro papel.
    id: 'machine-readable-zone',
    peso: 0.3,
    casa: ({ texto }) => MRZ.test(texto) || MRZ_PREFIJO.test(texto),
  },
  {
    id: 'personal-fields',
    peso: 0.2,
    casa: (evidencia) =>
      CAMPOS_PERSONALES.filter(
        (campo) =>
          campo.patron.test(evidencia.texto) ||
          casarGrafias(evidencia.cotejo ?? '', campo.grafias) !== null,
      ).length >= MINIMO_CAMPOS_PERSONALES,
  },
  {
    // Un número de documento suelto: lo lleva cualquier recibo, y pesa como tal.
    id: 'document-number',
    peso: 0.1,
    casa: ({ texto }) => /\b\d{5,10}\s*(?:[-–]\s*[0-9A-Z]{1,3})?\b/u.test(texto),
  },
  {
    /*
     * La proporción de una tarjeta ID-1 (85,6 × 54 mm → 1,585).
     *
     * Suma poco a propósito: por sí sola no llega ni a la franja de duda, porque
     * media Bolivia fotografía cosas rectangulares. Sirve para desempatar un
     * documento que el reconocedor leyó a medias, no para admitir nada.
     */
    id: 'id1-aspect-ratio',
    peso: 0.1,
    casa: ({ anchoLargo, ladoCorto }) => {
      if (ladoCorto <= 0) return false;
      const proporcion = anchoLargo / ladoCorto;
      return proporcion >= 1.4 && proporcion <= 1.78;
    },
  },
];

/** Suma de todos los pesos, para normalizar a `[0, 1]` sin fijar el total a mano. */
export const PESO_TOTAL = SENALES.reduce((total, senal) => total + senal.peso, 0);
