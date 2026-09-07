import { adviseColumns } from '../src/modules/workers/bank-statement/core/engine/generic/column-advisor';
import type {
  ColumnAdvice,
  ColumnAdviceRequest,
  StatementColumnAdvisorPort,
} from '../src/modules/workers/bank-statement/core/engine/generic/column-advisor';
import { TableAnalyzer } from '../src/modules/workers/bank-statement/core/engine/generic/table-analyzer';
import type {
  ExtractedPdf,
  PageLine,
  TextToken,
} from '../src/modules/workers/bank-statement/core/domain/models';
import type { CanonicalField } from '../src/modules/workers/bank-statement/core/engine/generic/header-lexicon';

/**
 * El consejero de columnas, con el **saldo corriente como juez**.
 *
 * Ninguna de estas pruebas llama a un modelo: el doble contesta lo que se le
 * dice. Lo que se protege es lo único que hace seguro enchufar uno aquí —que su
 * propuesta se aplica sólo si la aritmética del extracto la confirma— y las tres
 * puertas que evitan pagar por una llamada inútil o aceptar una lectura peor.
 */

const PAGE_WIDTH = 900;
const CHAR = 4.4;

function token(text: string, x: number): TextToken {
  return { text, x, y: 0, width: text.length * CHAR };
}

function line(y: number, cells: readonly (readonly [string, number])[]): PageLine {
  const tokens = cells.map(([text, x]) => ({ ...token(text, x), y }));
  return { page: 1, pageWidth: PAGE_WIDTH, y, tokens, text: tokens.map((t) => t.text).join(' ') };
}

const FILAS: readonly (readonly [string, string, string, string])[] = [
  ['01/03/2026', 'PAGO SERVICIOS', '-250,00', '1.750,00'],
  ['02/03/2026', 'DEPOSITO', '500,00', '2.250,00'],
  ['03/03/2026', 'RETIRO CAJERO', '-100,00', '2.150,00'],
];

/**
 * Un extracto cuya columna de importe se llama como no la llama nadie.
 *
 * `VALOR NETO OPERACION` no está en el diccionario, así que el analizador se
 * queda sin campo de importe y no construye NI UN movimiento — que es el caso
 * real de una entidad sin analizador propio, y el que justifica todo esto.
 */
function extracto(rotuloImporte: string): ExtractedPdf {
  const lines: PageLine[] = [
    line(800, [['BANCO DE PRUEBA', 40]]),
    line(700, [
      ['FECHA', 40],
      ['DESCRIPCION', 200],
      [rotuloImporte, 400],
      ['SALDO', 650],
    ]),
    ...FILAS.map((fila, indice) =>
      line(650 - indice * 50, [
        [fila[0], 40],
        [fila[1], 200],
        [fila[2], 400],
        [fila[3], 650],
      ]),
    ),
  ];
  return { pageCount: 1, lines, text: lines.map((l) => l.text).join('\n') };
}

function consejero(
  respuesta: ColumnAdvice | null,
): StatementColumnAdvisorPort & { peticiones: ColumnAdviceRequest[] } {
  const peticiones: ColumnAdviceRequest[] = [];
  return {
    provider: 'doble',
    peticiones,
    advise: (request: ColumnAdviceRequest): Promise<ColumnAdvice | null> => {
      peticiones.push(request);
      return Promise.resolve(respuesta);
    },
  };
}

function mapa(entradas: readonly (readonly [string, CanonicalField])[]): ColumnAdvice {
  return new Map(entradas);
}

describe('adviseColumns', () => {
  it('rescata un extracto ilegible cuando el saldo confirma la asignación', async () => {
    const pdf = extracto('VALOR NETO OPERACION');
    const baseline = new TableAnalyzer().analyze(pdf);
    expect(baseline.movements).toHaveLength(0);

    const advisor = consejero(mapa([['VALOR NETO OPERACION', 'amount']]));
    const resultado = await adviseColumns(advisor, pdf, baseline);

    expect(resultado).not.toBeNull();
    expect(resultado?.analysis.movements).toHaveLength(3);
    // Sólo se le mandaron RÓTULOS, ni una fila ni un importe.
    expect(advisor.peticiones[0]?.unknownLabels).toEqual(['VALOR NETO OPERACION']);
    expect(JSON.stringify(advisor.peticiones[0])).not.toMatch(/1\.750|PAGO SERVICIOS/u);
  });

  it('descarta una asignación equivocada: el saldo no cuadra y no se aplica', async () => {
    const pdf = extracto('VALOR NETO OPERACION');
    const baseline = new TableAnalyzer().analyze(pdf);

    // El importe leído como si fuera el saldo: plausible y falso.
    const advisor = consejero(mapa([['VALOR NETO OPERACION', 'balance']]));
    await expect(adviseColumns(advisor, pdf, baseline)).resolves.toBeNull();
  });

  it('no gasta una llamada si el extracto ya se lee y cuadra', async () => {
    const pdf = extracto('IMPORTE');
    const baseline = new TableAnalyzer().analyze(pdf);
    expect(baseline.movements.length).toBeGreaterThan(0);

    const advisor = consejero(mapa([['IMPORTE', 'amount']]));
    await expect(adviseColumns(advisor, pdf, baseline)).resolves.toBeNull();
    expect(advisor.peticiones).toHaveLength(0);
  });

  it('no gasta una llamada si no hay ningún rótulo desconocido', async () => {
    const pdf = extracto('IMPORTE');
    const advisor = consejero(mapa([]));
    // Se le pasa un análisis vacío a mano: hay descuadre aparente, pero nada que mapear.
    await expect(
      adviseColumns(advisor, pdf, { ...new TableAnalyzer().analyze(pdf), movements: [] }),
    ).resolves.toBeNull();
    expect(advisor.peticiones).toHaveLength(0);
  });

  it('sobrevive a un consejero que no contesta', async () => {
    const pdf = extracto('VALOR NETO OPERACION');
    const baseline = new TableAnalyzer().analyze(pdf);
    await expect(adviseColumns(consejero(null), pdf, baseline)).resolves.toBeNull();
  });
});
