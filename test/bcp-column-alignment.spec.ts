import { BcpStatementParser } from '../src/modules/workers/bank-statement/core/parsers/bcp.parser';
import type {
  ExtractedPdf,
  PageLine,
  TextToken,
} from '../src/modules/workers/bank-statement/core/domain/models';

/**
 * Que cada columna del extracto del BCP acabe en el campo que le toca.
 *
 * ## Por qué esto merece una prueba propia
 *
 * Un desajuste de columna no se parece a un defecto. No lanza, no avisa, no deja
 * el extracto a medias: los 112 movimientos se leen, los importes son correctos,
 * los saldos cuadran y la conversión termina en verde con confianza 0,99. Lo
 * único que está mal es QUÉ TEXTO acabó en `description`, y ninguna comprobación
 * de las que ya existen mira eso.
 *
 * Lo que se veía era esto: las fichas de este formato caen en abscisas
 * relativas fijas —descripción `0,2398`, medio de atención `0,4230`, lugar
 * `0,6062`— y el rango de la descripción empezaba en `0,24`. Dos diezmilésimas
 * por encima. Como `textInRange` compara con `>=`, la descripción quedaba fuera
 * de su propio rango y el medio de atención, que sí caía dentro, ocupaba su
 * sitio. La fila entera se corría una columna.
 *
 * El daño aparecía tres capas más abajo, con otra cara: el clasificador de
 * gastos recibía 52 veces «Agencia» y 34 veces «Tarjeta De Debito» —nombres de
 * CANAL, que no describen ningún concepto— y las archivaba en «otros gastos».
 * Se leía como un fallo del clasificador y era de una constante de este archivo.
 *
 * Las medidas de abajo son las del extracto real de febrero de 2026.
 */

/** Anchura de página del extracto medido, en puntos. */
const PAGE_WIDTH = 792;

/**
 * Abscisas MEDIDAS sobre el PDF real, en proporción del ancho de página.
 *
 * Se escriben como proporción y no en puntos porque es lo que compara el
 * parser, y porque así la prueba dice exactamente lo mismo que el documento:
 * «la descripción del BCP empieza en el 24 % del ancho, no en el 24,0 %».
 */
const COLUMNA = {
  fecha: 0.0912,
  hora: 0.1769,
  descripcion: 0.2398,
  medioDeAtencion: 0.423,
  lugar: 0.6062,
  monto: 0.8231,
  saldo: 0.8896,
} as const;

function ficha(text: string, ratio: number): TextToken {
  return { text, x: ratio * PAGE_WIDTH, y: 500, width: text.length * 4.4 };
}

function linea(tokens: TextToken[], page = 1): PageLine {
  return {
    page,
    pageWidth: PAGE_WIDTH,
    y: 500,
    tokens,
    text: tokens.map((item) => item.text).join(' '),
  };
}

/** La carátula, con lo que el parser necesita para reconocer el formato. */
const CARATULA: PageLine[] = [
  linea([ficha('Extracto de Cuenta por Mes', 0.4082)]),
  linea([ficha('Nro. Cuenta:', 0.0783), ficha('701-51372058-3-54', 0.1995)]),
  linea([ficha('Cliente:', 0.0783), ficha('Santiago Roda Bagnoli', 0.1995)]),
  linea([ficha('Periodo:', 0.7045), ficha('Febrero 2026', 0.8056)]),
  linea([
    ficha('Fecha', 0.1007),
    ficha('Hora', 0.1843),
    ficha('Descripción', 0.2986),
    ficha('Medio de Atención', 0.4644),
    ficha('Lugar', 0.6801),
    ficha('Monto', 0.8048),
    ficha('Saldo', 0.8747),
  ]),
];

/** Un movimiento tal cual sale del extracto real, ficha a ficha. */
function movimiento(): PageLine {
  return linea([
    ficha('01/02/2026', COLUMNA.fecha),
    ficha('11:18:33', COLUMNA.hora),
    ficha('Compra Farmacorp Sc27', COLUMNA.descripcion),
    ficha('Tarjeta De Debito', COLUMNA.medioDeAtencion),
    ficha('Farmacorp Sc279 Av Cristosanta Cruz', COLUMNA.lugar),
    ficha('-96.00', COLUMNA.monto),
    ficha('359.03', COLUMNA.saldo),
  ]);
}

function documento(lines: PageLine[]): ExtractedPdf {
  const todas = [...CARATULA, ...lines];
  return {
    pageCount: 1,
    lines: todas,
    text: todas.map((line) => line.text).join('\n'),
  };
}

describe('BcpStatementParser · alineación de columnas', () => {
  const parser = new BcpStatementParser();

  it('reconoce el formato de la carátula real', () => {
    expect(parser.supports(documento([movimiento()]))).toBe(true);
  });

  it('pone la DESCRIPCIÓN en la descripción, no el medio de atención', () => {
    const [transaccion] = parser.parse(documento([movimiento()])).transactions;
    expect(transaccion?.description).toBe('Compra Farmacorp Sc27');
  });

  /*
   * La comprobación que habría atrapado el defecto de raíz. «Tarjeta De Debito»
   * y «Agencia» son los dos valores del canal en este formato: si alguno aparece
   * como descripción, la fila se corrió de columna aunque todo lo demás cuadre.
   */
  it('nunca describe un movimiento con el nombre de un canal', () => {
    const [transaccion] = parser.parse(documento([movimiento()])).transactions;
    expect(transaccion?.description).not.toMatch(/^(?:Tarjeta De Debito|Agencia|Automático)$/);
  });

  it('deja el canal y el lugar cada uno en su campo', () => {
    const [transaccion] = parser.parse(documento([movimiento()])).transactions;
    expect(transaccion?.channel).toBe('Tarjeta De Debito');
    expect(transaccion?.location).toBe('Farmacorp Sc279 Av Cristosanta Cruz');
  });

  it('conserva el importe y el saldo', () => {
    const [transaccion] = parser.parse(documento([movimiento()])).transactions;
    expect(transaccion?.debit).toBe('96.00');
    expect(transaccion?.balance).toBe('359.03');
  });

  /*
   * Las continuaciones empiezan EXACTAMENTE en la columna de descripción, así
   * que la misma frontera de más las descartaba todas —144 fichas en el extracto
   * medido— y la referencia del movimiento no llegaba nunca a la glosa.
   */
  it('anexa la continuación a la descripción en vez de descartarla', () => {
    const documentoConNota = documento([
      linea([
        ficha('01/02/2026', COLUMNA.fecha),
        ficha('13:38:36', COLUMNA.hora),
        ficha('Transferencia Qr Bm Qr Restotech', COLUMNA.descripcion),
        ficha('Agencia', COLUMNA.medioDeAtencion),
        ficha('Agencia Santa Cruz', COLUMNA.lugar),
        ficha('-41.00', COLUMNA.monto),
        ficha('279.03', COLUMNA.saldo),
      ]),
      linea([ficha('Ventaid 810717 - Banco Nacional De', COLUMNA.descripcion)]),
    ]);
    const [transaccion] = parser.parse(documentoConNota).transactions;
    expect(transaccion?.description).toContain('Transferencia Qr Bm Qr Restotech');
    expect(transaccion?.description).toContain('Ventaid 810717');
  });

  /*
   * La barrera estructural tiene que seguir en pie: una línea con texto a la
   * IZQUIERDA de la descripción es de otra sección, y ensancharla para arreglar
   * lo anterior habría dejado entrar el resumen final del extracto.
   */
  it('sigue descartando una línea con texto a la izquierda de la tabla', () => {
    const documentoConResumen = documento([
      movimiento(),
      linea([ficha('Categoría', 0.0909), ficha('Monto (Bs.)', 0.3062)]),
    ]);
    const [transaccion] = parser.parse(documentoConResumen).transactions;
    expect(transaccion?.description).toBe('Compra Farmacorp Sc27');
  });
});
