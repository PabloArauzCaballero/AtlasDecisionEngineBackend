export interface FoldedText {
  /** Texto plegado a minúsculas y sin diacríticos, usado sólo para localizar alias. */
  readonly value: string;
  /** Mapa `índice plegado -> índice original`, con longitud `value.length + 1`. */
  readonly offsets: readonly number[];
}

export interface AliasMatch {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

export const WORD_CHARACTER = /[\p{Letter}\p{Number}_]/u;
export const DIACRITIC = /\p{Diacritic}/gu;
export const REGEXP_METACHARACTER = /[.*+?^${}()|[\]\\]/gu;

/**
 * Campos rotulados de una glosa bancaria, y qué se hace con su valor.
 *
 * Medido sobre 213 glosas distintas de siete extractos bolivianos reales (BNB,
 * BMSC, BEC, BG, BCP, BSO, BUN): 103 caracteres de media y hasta 288, de los
 * cuales el rubro ocupa los primeros veinte y el resto son identificadores.
 *
 * - `descartar`: el valor identifica a una PERSONA, una CUENTA o un BANCO. Para
 *   saber si el movimiento es una transferencia da igual a quién fue; el nombre
 *   sólo acerca la glosa a cualquier otra que mencione a alguien.
 * - `conservar`: el valor es texto libre donde el banco escribe el comercio o el
 *   concepto —`Lugar:POLLOS CHUY FIDALGA`, `Dato Adicional: PAGO DE ACCESORIOS`,
 *   `Nota: PrimeVideoAmzn.com`—. Se quita el rótulo y se deja lo que dice.
 */
export const CAMPOS_DE_GLOSA: readonly { etiqueta: string; conservar: boolean }[] = [
  { etiqueta: 'Nombre Originante:', conservar: false },
  { etiqueta: 'Cuenta Destino:', conservar: false },
  { etiqueta: 'Cuenta Origen:', conservar: false },
  { etiqueta: 'Beneficiario:', conservar: false },
  { etiqueta: 'Remitente:', conservar: false },
  { etiqueta: 'Doc.ID:', conservar: false },
  { etiqueta: 'Ciudad:', conservar: false },
  { etiqueta: 'Nombre:', conservar: false },
  { etiqueta: 'Cuenta:', conservar: false },
  { etiqueta: 'Banco:', conservar: false },
  { etiqueta: 'Tarj:', conservar: false },
  { etiqueta: 'Dato Adicional:', conservar: true },
  { etiqueta: 'Lugar:', conservar: true },
  /*
   * `Nota:` se descarta, y la decisión se tomó midiendo, no discutiendo.
   *
   * Es texto libre, así que a veces trae el comercio —`Nota:
   * PrimeVideoAmzn.com`— y eso invitaba a conservarlo. Pero en los extractos
   * reales del Banco Económico casi siempre trae a la CONTRAPARTE: `Nota:
   * AVENDANO DIAZ LILIAN CLAUDIA (B. NACIONAL DE BOLIVIA) varios`. Conservarlo
   * costaba 11 glosas sin categoría y salvaba una o dos, porque la cabecera de
   * ese banco ya dice la operación completa —`DEBITO ACH QR`, `DEBITO POR COMPRA
   * EN COMERCIO ELECTRONIC`— y el comercio no añadía nada que la cabecera no
   * dijera ya.
   */
  { etiqueta: 'Nota:', conservar: false },
];

/** Localiza cualquiera de los rótulos, en el orden en que aparezcan. */
export const ROTULOS = new RegExp(
  CAMPOS_DE_GLOSA.map(({ etiqueta }) => etiqueta.replace(REGEXP_METACHARACTER, '\\$&')).join('|'),
  'giu',
);

/**
 * Identificadores: series de cinco o más dígitos, y las mezclas de letras y
 * números que son un código y no una palabra (`P430F44CA0`, `MSC444`).
 *
 * Cinco y no tres: `POS 110`, `CUOTA 3` o un año llevan menos, y son parte de lo
 * que la línea dice. Un número de cuenta boliviano nunca baja de siete.
 */
export const IDENTIFICADOR =
  /(?<![\p{Letter}])\d{5,}(?![\p{Letter}])|\b(?=[\p{Letter}]*\d)(?=\d*[\p{Letter}])[\p{Letter}\d]{6,}\b/gu;

/**
 * Sellos del asiento: el estado contable con el que el banco acompaña la línea.
 *
 * No identifican a nadie —por eso `dropIdentifiers` no los tocaba— pero tampoco
 * dicen nada del RUBRO: aparecen igual en un alquiler, en una nómina y en una
 * comisión, así que acercan cada glosa a todas las categorías por igual mientras
 * el rubro, que ocupa cuatro palabras, compite contra doce de relleno.
 *
 * Medido sobre un extracto de sesenta páginas: `ABONO NOMINA ASOCIACION FICT
 * F-019 | RECURRENTE | CONTABILIZADA | TX-635873-J` se abstenía; sin la cola
 * clasifica como sueldo con 1,00. De ocho familias que salían «sin determinar»,
 * siete YA estaban sembradas: lo que fallaba no era el catálogo, era la pregunta.
 */
export const SELLO_DE_ASIENTO =
  /\b(?:NO\s+)?(?:CONTABILIZADA|RECURRENTE|PROGRAMADA|LIBERADA|RETENIDO|PROVISIONAL|SIN\s+IMPACTO|SUJETO\s+A\s+COBRO|NETO\s+COMISIONES|GASTOS\s+COMPARTIDOS|AJUSTE\s+OPERATIVO|POSIBLE\s+DUPLICADO|EN\s+REVISION|NO\s+EJECUTADA)\b/giu;

/**
 * Rótulos de referencia que se quedan huérfanos cuando su valor era un
 * identificador y ya se fue: `REF PR-252782-Z` deja un `REF` señalando a nada,
 * `LOTE 1643` deja `LOTE`. Se van con lo que rotulaban.
 *
 * `MCC 4121` se va entero aunque el número no llegue a cinco cifras: es el
 * código del rubro, y el rubro ya está escrito en palabras en la misma línea.
 */
export const ROTULO_HUERFANO =
  /\bMCC\s*\d{3,4}\b|\b(?:REF|CASO|CONTRATO|MAND|POLIZA|AUT|ORDEN|LOTE|FORM|EXP|TX|REP|CAMP)\b(?=\s*(?:[-–|]|$|\s))/giu;

/**
 * Referencia con guiones —`TX-635873-J`, `MT-471966-W`, `GV-736180-C`—, tratada
 * como UN token.
 *
 * Va antes que `IDENTIFICADOR` porque aquél sólo ve la parte numérica: se
 * llevaba el `635873` y dejaba `TX` y `-J` sueltos, dos restos que el vector
 * sigue pesando. El prefijo puede venir precedido de su rótulo (`REF
 * PR-252782-Z`) y termina en un dígito de control opcional.
 */
export const REFERENCIA_CON_GUIONES =
  /\b(?:REF|CASO|CONTRATO|MAND|POLIZA|AUT|ORDEN|LOTE|FORM|EXP|REP|CAMP)?\s*\b[A-Z]{2,4}-\d{3,}(?:-[A-Z0-9]{1,3})?\b/giu;

/** Rótulo seguido de un número corto: `LOTE 1643`, `AUT 941425`, `FORM 189`. */
export const ROTULO_CON_NUMERO =
  /\b(?:REF|CASO|CONTRATO|MAND|POLIZA|AUT|ORDEN|LOTE|FORM|EXP|REP|CAMP|SUC)\s*\.?\s*\d{1,6}\b/giu;

/**
 * Lo que queda de una referencia ya retirada: un guion con dos o tres
 * caracteres, colgando entre espacios. No es una palabra de nadie.
 */
export const FRAGMENTO_SUELTO = /(?<=^|\s)[-–][A-Z0-9]{1,3}(?=\s|$)/giu;
