import { headerLayout } from '../src/modules/workers/bank-statement/core/engine/generic/column-detector';
import { matchHeaderField } from '../src/modules/workers/bank-statement/core/engine/generic/header-lexicon';
import type { PageLine, TextToken } from '../src/modules/workers/bank-statement/core/domain/models';

/**
 * La fila de encabezados, que es de donde el motor generalista saca TODO.
 *
 * Se prueba aparte porque su defecto no se parece a un defecto: no lanza, no
 * avisa y no deja media tabla mal leída. Deja el documento sin `transactionDate`,
 * el analizador descarta la región entera —es su requisito— y el extracto acaba
 * rechazado como si el PDF no fuera un extracto. Lo que se ve al final es
 * `NOT_A_FINANCIAL_STATEMENT` sobre un documento impecable.
 */

/** Ancho de carácter de los extractos medidos: cuerpo pequeño, ~4,4 pt. */
const CHAR = 4.4;

function token(text: string, x: number): TextToken {
  return { text, x, y: 100, width: text.length * CHAR };
}

/** Una línea con las fichas ya colocadas, como las entrega el lector de PDF. */
function line(tokens: TextToken[]): PageLine {
  return {
    page: 1,
    pageWidth: 900,
    y: 100,
    tokens,
    text: tokens.map((item) => item.text).join(' '),
  };
}

/**
 * Fichas separadas por un hueco de columna. El valor sale del corpus real: la
 * separación más estrecha entre dos columnas contiguas medida es de 3,5 anchos
 * de carácter, y es justo la que fundía «FECHA» con «VALOR».
 */
function enColumnas(labels: readonly string[], gapInChars = 3.5): TextToken[] {
  const tokens: TextToken[] = [];
  let x = 40;
  for (const label of labels) {
    const item = token(label, x);
    tokens.push(item);
    x += item.width + gapInChars * CHAR;
  }
  return tokens;
}

describe('cabecera de tabla del motor generalista', () => {
  /*
   * El defecto que motiva este archivo. Cabecera de un extracto con DOS columnas
   * de fecha —la de operación y la valor—, que es lo normal en la banca: la
   * ventana glotona del diccionario juntaba «FECHA» y «VALOR» en el rótulo
   * compuesto `fecha valor`, lo reconocía como `valueDate` y el documento se
   * quedaba sin fecha de operación. Sesenta páginas y 1.082 movimientos bien
   * alineados terminaban descartados.
   */
  it('no funde dos columnas contiguas en un rótulo compuesto', () => {
    const layout = headerLayout(
      line(
        enColumnas([
          'FECHA',
          'VALOR',
          'CANAL',
          'DESCRIPCION / METADATOS',
          'DEBITO',
          'CREDITO',
          'SALDO',
        ]),
      ),
    );

    expect(layout).toBeDefined();
    expect([...(layout?.fields ?? [])]).toEqual(
      expect.arrayContaining([
        'transactionDate',
        'channel',
        'description',
        'debit',
        'credit',
        'balance',
      ]),
    );
    // La primera columna es la fecha de la operación, no una «fecha valor» que
    // se habría comido la columna siguiente.
    expect(layout?.columns[0]?.field).toBe('transactionDate');
    expect(layout?.columns).toHaveLength(7);
  });

  /*
   * La otra mitad del contrato: cuando «F. Valor» es UN rótulo de dos palabras
   * —separación de palabra, no de columna— se sigue leyendo como uno solo. Sin
   * esto, la corrección de arriba se llevaría por delante todos los rótulos
   * compuestos del diccionario.
   */
  it('sí junta las palabras de un mismo rótulo', () => {
    const fecha = token('F.', 40);
    const valor = token('Valor', fecha.x + fecha.width + CHAR * 0.6);
    const importe = token('IMPORTE', 300);
    const layout = headerLayout(line([fecha, valor, importe]));

    expect(layout?.columns[0]?.field).toBe('valueDate');
    expect(layout?.columns[0]?.label).toBe('f. valor');
    expect(layout?.columns).toHaveLength(2);
  });

  it('una línea con un solo rótulo reconocible no es una cabecera', () => {
    // El bloque de totales del pie dice «Saldo» y no abre ninguna tabla.
    expect(headerLayout(line(enColumnas(['Saldo', 'final', 'del', 'periodo'])))).toBeUndefined();
  });

  /*
   * `DESCRIPCION / METADATOS` es UNA columna: la glosa con lo que el banco le
   * cuelga. Sin reconocerla, los 1.082 movimientos del corpus se leían sin
   * glosa, que en un extracto es casi todo lo que se lee.
   */
  it('reconoce la descripción cuando el banco la rotula con su acompañante', () => {
    expect(matchHeaderField('DESCRIPCION / METADATOS')).toBe('description');
    expect(matchHeaderField('Detalle / Referencia')).toBe('description');
    // Y no se generaliza a cualquier rótulo con barra: éste no es una glosa.
    expect(matchHeaderField('DEBITO / CREDITO')).toBeUndefined();
  });
});
