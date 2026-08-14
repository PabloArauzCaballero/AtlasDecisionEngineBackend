/**
 * Campo canónico al que se mapea una columna, cualquiera que sea el rótulo con
 * el que el banco la imprima.
 */
export type CanonicalField =
  | 'transactionDate'
  | 'valueDate'
  | 'time'
  | 'description'
  | 'reference'
  | 'documentNumber'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance'
  | 'currency'
  | 'channel'
  | 'branch'
  | 'movementType';

/**
 * Diccionario de rótulos, construido a partir de los siete formatos ya medidos
 * y de las variantes habituales en la banca boliviana y en plantillas en
 * inglés. Es **datos, no código**: añadir un sinónimo no cambia ninguna
 * decisión del motor.
 *
 * El orden importa. Se busca la coincidencia más larga primero, de modo que
 * `fecha valor` no se lea como `fecha` y `nro documento` no se lea como
 * `documento` de otra columna.
 *
 * Los paréntesis de unidad se acotan con `[^)]*` y **nunca** con `.*`. La
 * búsqueda prueba ventanas de varias fichas, así que un cuantificador glotón
 * haría que `debito (bs) credito (bs) saldo (bs)` —la cabecera entera de un
 * extracto que rotula la moneda en cada columna— coincidiera con `debito` y
 * fundiera tres columnas en una, dejando el documento sin importes legibles.
 */
interface HeaderAlias {
  readonly field: CanonicalField;
  readonly patterns: readonly RegExp[];
}

const ALIASES: readonly HeaderAlias[] = [
  {
    field: 'valueDate',
    patterns: [/^f(?:echa)?\.?\s*(?:de\s+)?valor$/, /^value\s+date$/],
  },
  {
    field: 'transactionDate',
    patterns: [
      /^fecha(?:\s+(?:y\s+hora|movimiento|de\s+movimiento|operacion|de\s+operacion|transaccion|de\s+transaccion|proceso|contable))?$/,
      /^f\.?\s*(?:operacion|mov|movimiento)$/,
      /^(?:transaction\s+)?date$/,
      /^posting\s+date$/,
    ],
  },
  { field: 'time', patterns: [/^hora$/, /^time$/, /^hh:mm$/] },
  {
    field: 'description',
    patterns: [
      /^descripcion(?:\s+(?:de\s+la\s+transaccion|del\s+movimiento|de\s+la\s+operacion))?$/,
      /^(?:detalle|glosa|concepto|transaccion|movimiento|operacion)$/,
      /^(?:description|details|narrative|particulars)$/,
      /*
       * Rótulo de dos partes, `DESCRIPCION / METADATOS`, que es UNA columna: la
       * glosa y lo que el banco cuelga de ella —referencias, códigos, estado—.
       * Sin esta línea la columna se reconocía como desconocida y el extracto
       * salía con todos sus movimientos sin glosa, que en un extracto es casi
       * todo lo que se lee.
       *
       * La alternancia se enumera en vez de admitir cualquier palabra tras la
       * barra: `DEBITO / CREDITO` también es un rótulo de dos partes y NO es una
       * descripción, y una regla que aceptara cualquier cosa lo leería como tal.
       */
      /^(?:descripcion|detalle|glosa|concepto)\s*\/\s*(?:metadatos|detalle|detalles|referencia|referencias|observaciones|concepto|glosa|descripcion)$/,
    ],
  },
  {
    field: 'documentNumber',
    patterns: [
      /^(?:nro|n|num|numero)\.?\s*(?:de\s+)?(?:documento|doc|trn|transaccion|operacion|comprobante)(?:\.?\s*\/?\s*cheque)?$/,
      /^(?:nro|n|num)\.?\s*trn\.?\s*\/?\s*cheque$/,
      /^(?:documento|cheque|comprobante|voucher|document\s+number)$/,
    ],
  },
  {
    field: 'reference',
    patterns: [
      /^(?:referencia|ref|refer\.?)$/,
      /^cod\.?\s*(?:bca|banco|bancario)\.?$/,
      /^(?:codigo|cod)\.?$/,
      /^reference$/,
    ],
  },
  {
    field: 'debit',
    patterns: [
      /^(?:debito|debitos|debe|cargo|cargos|salida|salidas|egreso|egresos)(?:\s*\([^)]*\))?$/,
      /^(?:debit|debits|withdrawal|withdrawals|charges)$/,
    ],
  },
  {
    field: 'credit',
    patterns: [
      /^(?:credito|creditos|haber|abono|abonos|entrada|entradas|ingreso|ingresos|deposito|depositos)(?:\s*\([^)]*\))?$/,
      /^(?:credit|credits|deposit|deposits)$/,
    ],
  },
  {
    field: 'amount',
    patterns: [
      /^(?:monto|importe|valor|monto\s+movimiento)(?:\s*\([^)]*\))?$/,
      /^(?:amount|value)(?:\s*\([^)]*\))?$/,
    ],
  },
  {
    field: 'balance',
    patterns: [
      /^(?:saldo|saldos|saldo\s+(?:disponible|contable|resultante|actual))(?:\s*\([^)]*\))?$/,
      /^(?:balance|running\s+balance)(?:\s*\([^)]*\))?$/,
    ],
  },
  {
    field: 'movementType',
    patterns: [
      /^(?:tipo|tipo\s+(?:de\s+)?(?:movimiento|operacion|transaccion))$/,
      /^d\s*\/\s*c$/,
      /^(?:dc|d\.c\.|type)$/,
    ],
  },
  {
    field: 'branch',
    patterns: [/^(?:sucursal|suc|agencia|ag|oficina|plaza)\.?$/, /^(?:branch|office)$/],
  },
  {
    field: 'channel',
    patterns: [/^(?:canal|via|medio(?:\s+de\s+atencion)?)$/, /^(?:channel|atm\/pos)$/],
  },
  {
    field: 'currency',
    patterns: [/^(?:moneda|divisa)$/, /^currency$/],
  },
];

/**
 * Normaliza un rótulo antes de compararlo: sin tildes, sin puntuación
 * redundante y en minúsculas. Sin esto, `Descripción` y `DESCRIPCION` serían
 * rótulos distintos y el diccionario tendría que duplicar cada entrada.
 */
export function normalizeHeaderText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rótulos adicionales que un perfil añade sin tocar el diccionario. */
export type ExtraAliases = ReadonlyMap<CanonicalField, readonly RegExp[]>;

/**
 * Campo canónico de un rótulo, o `undefined` si no se reconoce.
 *
 * Los alias de un perfil se prueban **antes** que el diccionario: un formato
 * concreto puede llamar «Cargo» a algo que en general no es un débito, y el
 * perfil existe justamente para decir eso sin cambiar la regla común.
 */
export function matchHeaderField(value: string, extra?: ExtraAliases): CanonicalField | undefined {
  const normalized = normalizeHeaderText(value);
  if (!normalized) return undefined;
  if (extra) {
    for (const [field, patterns] of extra) {
      if (patterns.some((pattern) => pattern.test(normalized))) return field;
    }
  }
  for (const alias of ALIASES) {
    if (alias.patterns.some((pattern) => pattern.test(normalized))) {
      return alias.field;
    }
  }
  return undefined;
}

/**
 * Campos sin los cuales una tabla no es una tabla de movimientos. La fecha y
 * algún importe son el mínimo: sin ellos no hay movimiento que reconstruir.
 */
export const REQUIRED_FIELDS: readonly CanonicalField[] = ['transactionDate'];

export const AMOUNT_FIELDS: readonly CanonicalField[] = ['amount', 'debit', 'credit', 'balance'];
