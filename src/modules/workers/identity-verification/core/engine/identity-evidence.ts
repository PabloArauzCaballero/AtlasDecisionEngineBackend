import { IdentityDocumentType } from '../domain/identity-enums';

/**
 * ¿Lo que hay en la foto ES un documento de identidad?
 *
 * ## Por qué no bastaba el clasificador
 *
 * `HeuristicDocumentClassifierAdapter` contesta otra pregunta: **cuál** de los
 * documentos conocidos es, buscando su rótulo. Es una pregunta con tres
 * respuestas y un «no sé», y ese «no sé» cargaba con dos casos que no se parecen
 * en nada: la cédula fotografiada de noche que el reconocedor leyó a medias, y
 * la foto de un recibo, de un paisaje o de la propia cara del solicitante. Los
 * dos salían por la misma puerta —`UNSUPPORTED_DOCUMENT`— y por tanto recibían
 * la misma respuesta: «sube otra cosa». A quien tenía una cédula perfectamente
 * válida le decíamos que su cédula no era una cédula.
 *
 * ## Qué hace este archivo
 *
 * Puntúa la EVIDENCIA de que haya un documento de identidad delante, sin
 * importar cuál. Con eso el motor puede separar los tres desenlaces que antes
 * eran uno:
 *
 * - Evidencia alta → adelante.
 * - Evidencia en la franja de duda → lo mira alguien (`identity-arbitration`).
 * - Evidencia baja, o un contraindicador decisivo → **se rechaza**, y se rechaza
 *   con la certeza de quien puede nombrar lo que sí era: una factura lleva
 *   código de control, un extracto lleva saldo anterior, y ninguna cédula del
 *   mundo lleva ninguna de las dos cosas.
 *
 * ## Los pesos no son porcentajes elegidos a ojo
 *
 * Cada señal pesa lo que DEMUESTRA. Una MRZ es un formato normalizado por OACI
 * que no aparece por accidente en ningún otro papel, así que casi cierra la
 * pregunta ella sola. Un número de siete dígitos, en cambio, lo lleva cualquier
 * recibo, y por eso pesa una fracción. La proporción de la tarjeta suma poco a
 * propósito: por sí sola no puede alcanzar ni siquiera la franja de duda, porque
 * media Bolivia fotografía cosas rectangulares.
 */

/** Una señal, con el peso que justifica lo que demuestra. */
interface SenalDeIdentidad {
  readonly id: string;
  readonly peso: number;
  readonly casa: (evidencia: TextoYForma) => boolean;
}

export interface TextoYForma {
  /** Texto leído de las dos caras, ya en mayúsculas y sin tildes. */
  readonly texto: string;
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
const CONTRAINDICADORES: ReadonlyArray<{ tipo: string; patron: RegExp }> = [
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
  { tipo: 'ACADEMIC', patron: /DIPLOMA\s+DE|TITULO\s+(?:PROFESIONAL|ACADEMICO)|CERTIFICADO\s+DE\s+NOTAS/u },
];

/** Campos que un documento de identidad rotula y casi ningún otro papel junta. */
const CAMPOS_PERSONALES: readonly RegExp[] = [
  /\bAPELLIDOS?\b/u,
  /\bNOMBRES?\b/u,
  /FECHA\s+DE\s+NACIMIENTO|NACIDO\s+EL|DATE\s+OF\s+BIRTH/u,
  /LUGAR\s+DE\s+NACIMIENTO|PLACE\s+OF\s+BIRTH/u,
  /\bNACIONALIDAD\b|\bNATIONALITY\b/u,
  /ESTADO\s+CIVIL/u,
  /\bDOMICILIO\b/u,
  /FECHA\s+DE\s+(?:EMISION|EXPEDICION)/u,
  /FECHA\s+DE\s+(?:VENCIMIENTO|CADUCIDAD|EXPIRACION)|VALIDO\s+HASTA|DATE\s+OF\s+EXPIRY/u,
  /\bSEXO\b|\bSEX\b/u,
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

const SENALES: readonly SenalDeIdentidad[] = [
  {
    // Lo que el documento DICE ser. Es la señal más directa que existe.
    id: 'identity-title',
    peso: 0.3,
    casa: ({ texto }) =>
      /CEDULA\s+DE\s+IDENTIDAD|DOCUMENTO\s+DE\s+IDENTIDAD|IDENTITY\s+CARD|\bC\.?\s?I\.?\b|PASAPORTE|PASSPORT|LICENCIA\s+(?:DE\s+)?CONDUCIR/u.test(
        texto,
      ),
  },
  {
    // Quién lo emitió. Sólo un Estado imprime esto en una tarjeta.
    id: 'issuing-authority',
    peso: 0.2,
    casa: ({ texto }) =>
      /\bSEGIP\b|SERVICIO\s+GENERAL\s+DE\s+IDENTIFICACION|ESTADO\s+PLURINACIONAL\s+DE\s+BOLIVIA|DIRECCION\s+GENERAL\s+DE\s+MIGRACION|POLICIA\s+BOLIVIANA/u.test(
        texto,
      ),
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
    casa: ({ texto }) =>
      CAMPOS_PERSONALES.filter((campo) => campo.test(texto)).length >= MINIMO_CAMPOS_PERSONALES,
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
const PESO_TOTAL = SENALES.reduce((total, senal) => total + senal.peso, 0);

export interface EvidenciaDeIdentidad {
  /** Cuánta evidencia hay de que sea un documento de identidad, en `[0, 1]`. */
  readonly confidence: number;
  /** Qué señales casaron, para que la traza explique el número. */
  readonly signals: readonly string[];
  /**
   * Qué OTRO documento se reconoció, si se reconoció alguno.
   *
   * Cuando viene relleno, la confianza es 0 y no hay nada que discutir: no es
   * que falte evidencia de cédula, es que hay evidencia de otra cosa.
   */
  readonly contraindicator: string | null;
}

/** Mayúsculas y sin tildes: las señales se escriben una sola vez, sin variantes. */
export function plegarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase();
}

/**
 * La evidencia de que la imagen contenga un documento de identidad.
 *
 * No decide nada: sólo mide. Quién decide es `identity-triage.ts`, con los
 * umbrales del despliegue, para que recalibrar no obligue a tocar las señales.
 */
export function medirEvidenciaDeIdentidad(entrada: TextoYForma): EvidenciaDeIdentidad {
  const evidencia: TextoYForma = { ...entrada, texto: plegarTexto(entrada.texto) };

  const contra = CONTRAINDICADORES.find(({ patron }) => patron.test(evidencia.texto));
  if (contra !== undefined) {
    return { confidence: 0, signals: [], contraindicator: contra.tipo };
  }

  const casadas = SENALES.filter((senal) => senal.casa(evidencia));
  const suma = casadas.reduce((total, senal) => total + senal.peso, 0);
  return {
    confidence: Number((suma / PESO_TOTAL).toFixed(3)),
    signals: casadas.map((senal) => senal.id),
    contraindicator: null,
  };
}

/**
 * Los tipos que este despliegue acepta, leídos de una lista separada por comas.
 *
 * Existe porque «documento de identidad» y «carnet» no son lo mismo, y quien
 * monta un flujo móvil de alta de clientes suele querer EXACTAMENTE el carnet:
 * un pasaporte válido sigue siendo un documento válido, pero no es el que ese
 * flujo pidió, y aceptarlo obliga a un analizador y a una política de caducidad
 * distintas. Lo que no puede pasar es que la restricción viva escrita a fuego en
 * el pipeline, porque entonces habilitar el pasaporte es un despliegue de código.
 */
export function parsearTiposAceptados(crudo: string | undefined): readonly IdentityDocumentType[] {
  const conocidos = new Set<string>(Object.values(IdentityDocumentType));
  const pedidos = (crudo ?? '')
    .split(',')
    .map((tipo) => tipo.trim().toUpperCase())
    .filter((tipo) => tipo.length > 0 && tipo !== IdentityDocumentType.UNKNOWN)
    .filter((tipo) => conocidos.has(tipo)) as IdentityDocumentType[];

  // Sin lista utilizable se cae al carnet boliviano, que es el documento para el
  // que este worker tiene analizador verificado. Abrir la puerta a todos por un
  // valor mal escrito sería justo lo contrario de lo que la variable existe para
  // controlar.
  return pedidos.length > 0 ? [...new Set(pedidos)] : [IdentityDocumentType.BOLIVIA_CI];
}
