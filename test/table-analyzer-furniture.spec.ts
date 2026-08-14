import { TableAnalyzer } from '../src/modules/workers/bank-statement/core/engine/generic/table-analyzer';
import type {
  ExtractedPdf,
  PageLine,
  TextToken,
} from '../src/modules/workers/bank-statement/core/domain/models';

/**
 * Qué cuenta como «renglón no atribuido» en un documento paginado.
 *
 * La advertencia se publica al consumidor y se lee como pérdida de datos, así
 * que tiene que contar sólo lo que de verdad se quedó fuera. El membrete y el
 * pie que cada página repite caen fuera de toda fila por definición: contarlos
 * hacía que un extracto leído entero —1.200 filas, ni una perdida— avisara de
 * 415 renglones sueltos, y con la cifra inflada así, el aviso que sí importa
 * queda enterrado.
 */

const PAGE_WIDTH = 900;
const CHAR = 4.4;

function token(text: string, x: number): TextToken {
  return { text, x, y: 0, width: text.length * CHAR };
}

function line(page: number, y: number, cells: readonly (readonly [string, number])[]): PageLine {
  const tokens = cells.map(([text, x]) => ({ ...token(text, x), y }));
  return {
    page,
    pageWidth: PAGE_WIDTH,
    y,
    tokens,
    text: tokens.map((item) => item.text).join(' '),
  };
}

/** Movimientos de una página: interlineado uniforme, como cualquier tabla. */
const ROWS_PER_PAGE = 6;

/** Membrete, cabecera de tabla, sus movimientos y pie. La forma de una página. */
function page(number: number, extra: readonly PageLine[] = []): PageLine[] {
  const rows = Array.from({ length: ROWS_PER_PAGE }, (_, index) =>
    line(number, 650 - index * 50, [
      [`0${index + 1}/0${number}/2026`, 40],
      ['PAGO SERVICIOS', 200],
      ['250,00', 400],
    ]),
  );
  return [
    line(number, 800, [['BANCO DE PRUEBA', 40]]),
    line(number, 700, [
      ['FECHA', 40],
      ['DESCRIPCION', 200],
      ['IMPORTE', 400],
    ]),
    ...rows,
    ...extra,
    line(number, 100, [[`Pagina ${number} de 3`, 40]]),
  ];
}

function pdfDe(lines: readonly PageLine[], pageCount: number): ExtractedPdf {
  return { pageCount, lines: [...lines], text: lines.map((item) => item.text).join('\n') };
}

function avisoDeHuerfanos(pdf: ExtractedPdf): string | undefined {
  return new TableAnalyzer()
    .analyze(pdf)
    .warnings.find((aviso) => aviso.startsWith('renglones-no-atribuidos'));
}

describe('renglones no atribuidos de un documento paginado', () => {
  const tresPaginas = pdfDe([...page(1), ...page(2), ...page(3)], 3);

  it('lee todos los movimientos de las tres páginas', () => {
    const analysis = new TableAnalyzer().analyze(tresPaginas);
    expect(analysis.movements).toHaveLength(3 * ROWS_PER_PAGE);
  });

  it('no cuenta como sueltos el membrete y el pie que cada página repite', () => {
    expect(avisoDeHuerfanos(tresPaginas)).toBeUndefined();
  });

  /*
   * La otra mitad: lo que de verdad se quedó fuera se sigue diciendo. Sin esto,
   * la corrección de arriba silenciaría justo el aviso que existe para avisar.
   */
  it('sí cuenta un renglón que no se repite y no entró en ninguna fila', () => {
    // Lejos de la última fila: pegado a ella sería parte de su glosa, que es
    // otra cosa y la decide el ensamblador, no esta heurística.
    const suelto = line(2, 200, [['NOTA AL MARGEN SIN MOVIMIENTO', 40]]);
    const conSuelto = pdfDe([...page(1), ...page(2, [suelto]), ...page(3)], 3);

    expect(avisoDeHuerfanos(conSuelto)).toBe('renglones-no-atribuidos:1');
    // Y no se pierde ningún movimiento por el camino.
    expect(new TableAnalyzer().analyze(conSuelto).movements).toHaveLength(3 * ROWS_PER_PAGE);
  });

  /*
   * Con una o dos páginas, «repetirse» no significa nada: no hay mobiliario que
   * reconocer y todo sobrante se cuenta, que es el comportamiento de siempre.
   * El membrete no aparece porque queda por ENCIMA de la cabecera, y una región
   * empieza donde su cabecera termina.
   */
  it('en un documento de una página no reconoce mobiliario', () => {
    const unaPagina = pdfDe(page(1), 1);
    expect(avisoDeHuerfanos(unaPagina)).toBe('renglones-no-atribuidos:1');
  });
});
