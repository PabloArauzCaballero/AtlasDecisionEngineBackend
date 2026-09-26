/**
 * Extractos bancarios SINTÉTICOS con fechas relativas a «hoy», para la suite de
 * `EXTRACTO_CAPACIDAD_PAGO`.
 *
 * ## Por qué existe y no basta con los escenarios del worker
 *
 * Los escenarios de `src/modules/workers/bank-statement/fixtures/` llevan las fechas fijas
 * (enero a marzo de 2026). El worker que el nodo `ANALIZAR_EXTRACTO` llama en el Motor aplica la
 * compuerta de VIGENCIA (`engine/recency/recency-gate.ts`): un extracto cuyo último movimiento
 * tiene más de tres días se rechaza, y con él el caso de prueba acaba en `REVISION_MANUAL` en
 * vez del desenlace que dice demostrar. Una suite con esos PDF pasa el día que se escribe y
 * falla al cuarto, sin que nada del artefacto haya cambiado.
 *
 * Aquí el último movimiento cae SIEMPRE el día anterior a `hoy`, así que el documento es
 * vigente en el momento en que el guion crea la suite y la ejecuta. Lo que NO puede hacerse es
 * reutilizar esa suite días después: por eso el guion la crea y la corre en la misma pasada.
 *
 * Y cubre TRES MESES NATURALES COMPLETOS más el mes en curso hasta ayer. Es lo que hace que el
 * documento valga también en un Motor con `BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS=true`: la política
 * de capacidad de pago da un mes por completo con 28 días cubiertos y actividad, así que basta con
 * que la carátula empiece el día 1 de hace tres meses y que cada mes tenga sus movimientos.
 *
 * ## Fidelidad
 *
 * Es el mismo generador de PDF de `fixtures/synthetic-pdf.ts` (un catálogo, una página, una
 * fuente estándar y `Td`/`Tj`) y la misma tabla del escenario `valid-basic`: Banco Ganadero, ocho
 * movimientos por mes con el sueldo el día 28, y las mismas glosas e importes. Está portado a
 * JavaScript plano porque el guion corre con `node` a secas, sin compilar el repositorio.
 * `test/extracto-capacidad-pago-documento.spec.ts` lo pasa por el motor de extractos REAL y
 * comprueba que lee lo que aquí se declara; si el motor cambia de criterio, esa prueba lo dice.
 *
 * Sin dependencias: sólo `Buffer`.
 *
 * ## Por qué CommonJS (`.cjs`) y no un módulo ES
 *
 * Lo carga el guion (`.mjs`, que importa CommonJS sin problema) y lo cargan las pruebas de Jest, que
 * no pueden cargar un `.mjs`: la única vía es `import()`, y el `import()` dinámico de este repositorio
 * (`importEsm`) sólo funciona para UNA suite por proceso —la segunda falla con «Test environment has
 * been torn down»—, y esa suite ya es `bank-statement-fixtures.spec.ts`. Un `.cjs` se carga con
 * `require`, sin transformarse y sin tocar ese mecanismo.
 */

'use strict';

const PAGE_WIDTH = 800;
const PAGE_HEIGHT = 1_100;
const FONT_SIZE = 9;
const LINE_HEIGHT = 16;
const MS_POR_DIA = 86_400_000;

const lineY = (row) => PAGE_HEIGHT - 60 - row * LINE_HEIGHT;

function escapePdfText(value) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function toLatin(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, ' ');
}

/** PDF de una página con texto posicionado. Determinista: mismas celdas, mismos bytes. */
function buildSyntheticPdf(cells, metadata = {}) {
  const content =
    'BT\n/F1 ' +
    FONT_SIZE +
    ' Tf\n' +
    cells
      .map((cell) => `1 0 0 1 ${cell.x} ${cell.y} Tm (${escapePdfText(toLatin(cell.text))}) Tj`)
      .join('\n') +
    '\nET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  const entries = [];
  if (metadata.producer) entries.push(`/Producer (${escapePdfText(toLatin(metadata.producer))})`);
  if (metadata.creationDate) entries.push(`/CreationDate (D:${metadata.creationDate})`);
  const info = entries.length > 0 ? `<< ${entries.join(' ')} >>` : null;
  if (info) objects.push(info);

  // El desplazamiento EXACTO en bytes de cada objeto va en la tabla xref: se mide mientras se
  // escribe, no después, porque `pdfjs` no perdona un desplazamiento equivocado.
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R` +
    (info ? ` /Info ${objects.length} 0 R` : '') +
    ` >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

const bolivianos = (value) =>
  value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dos = (n) => String(n).padStart(2, '0');

/** `dd/mm/aaaa` en UTC, que es como el motor de extractos interpreta las fechas. */
function diaImpreso(fecha) {
  return `${dos(fecha.getUTCDate())}/${dos(fecha.getUTCMonth() + 1)}/${fecha.getUTCFullYear()}`;
}

function sumarDias(fecha, dias) {
  return new Date(fecha.getTime() + dias * MS_POR_DIA);
}

/** Medianoche UTC del día de `fecha`. */
function inicioDelDia(fecha) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

/**
 * Las glosas y los importes de un mes, con el día del mes en que caen. Son los del escenario
 * `valid-basic` sin la variación que allí existe para probar la volatilidad: aquí un ingreso
 * exacto es lo que permite fijar el resultado del algoritmo con cifras redondas.
 */
function mes(ingresoMensual) {
  return [
    { dia: 3, descripcion: 'PAGO CUOTA PRESTAMO PERSONAL 4412', debito: 950 },
    { dia: 5, descripcion: 'PAGO SERVICIO ELECTRICO CRE', debito: 280 },
    { dia: 8, descripcion: 'COMPRA SUPERMERCADO HIPERMAXI', debito: 640 },
    { dia: 12, descripcion: 'PAGO SEGURO DE VIDA DESGRAVAMEN', debito: 145 },
    { dia: 15, descripcion: 'RETIRO CAJERO AUTOMATICO', debito: 500 },
    { dia: 18, descripcion: 'CONSUMO RESTAURANTE', debito: 210 },
    { dia: 22, descripcion: 'DEBITO ITF DEL PERIODO', debito: 18.5 },
    { dia: 28, descripcion: 'ABONO DE HABERES PLANILLA MENSUAL', credito: ingresoMensual },
  ];
}

const utc = (anio, indiceDeMes, dia) => new Date(Date.UTC(anio, indiceDeMes, dia));

/**
 * Tres meses naturales completos (24 movimientos) más un cargo el propio día de cierre (ayer):
 * sin él el último apunte sería el sueldo del día 28 y el documento caducaría antes de tiempo. Ese
 * cargo NO lleva abono, así que los abonos son exactamente `ingresoMensual × 3`. Si ayer cae dentro
 * de un mes que ya lleva 28 días, la política de capacidad de pago lo cuenta como un cuarto mes
 * completo; con tres basta.
 *
 * `tipo: 'pocos-movimientos'` construye en cambio tres movimientos, para el extracto que el
 * algoritmo considera demasiado corto para describir una cuenta.
 */
function movimientosDe(tipo, ingresoMensual, cierre) {
  if (tipo === 'pocos-movimientos') {
    return [
      { fecha: sumarDias(cierre, -20), descripcion: 'PAGO CUOTA PRESTAMO PERSONAL 4412', debito: 950 },
      { fecha: sumarDias(cierre, -10), descripcion: 'PAGO SERVICIO ELECTRICO CRE', debito: 280 },
      { fecha: cierre, descripcion: 'ABONO DE HABERES PLANILLA MENSUAL', credito: ingresoMensual },
    ];
  }
  const anio = cierre.getUTCFullYear();
  const indice = cierre.getUTCMonth();
  const cierraElMes = cierre.getTime() === utc(anio, indice + 1, 0).getTime();
  const ultimoCompleto = cierraElMes ? indice : indice - 1;

  const movimientos = [-2, -1, 0].flatMap((desplazamiento) => {
    const primero = utc(anio, ultimoCompleto + desplazamiento, 1);
    return mes(ingresoMensual).map((item) => ({
      fecha: utc(primero.getUTCFullYear(), primero.getUTCMonth(), item.dia),
      descripcion: item.descripcion,
      debito: item.debito,
      credito: item.credito,
    }));
  });
  movimientos.push({ fecha: cierre, descripcion: 'COMPRA SUPERMERCADO HIPERMAXI', debito: 120 });
  return movimientos;
}

/** Día 1 del primer mes que cubre el extracto: lo que la carátula imprime como inicio del periodo. */
function inicioDelPeriodo(tipo, movimientos) {
  const primera = movimientos[0].fecha;
  return tipo === 'pocos-movimientos' ? primera : utc(primera.getUTCFullYear(), primera.getUTCMonth(), 1);
}

/**
 * Construye el extracto.
 *
 * @param {object} opciones
 * @param {Date} opciones.hoy Día contra el que el documento es vigente. El último movimiento cae
 *   el día anterior: a un día de antigüedad hay margen por los dos lados de la tolerancia de la
 *   compuerta (tres días) frente a un reloj del Motor que vaya algo adelantado o atrasado.
 * @param {number} [opciones.ingresoMensual] Sueldo de cada mes. Con `tres-meses` los abonos leídos
 *   suman `ingresoMensual × 3`, exactamente.
 * @param {'tres-meses'|'pocos-movimientos'} [opciones.tipo]
 * @returns {{ base64: string, fileName: string, abonos: number, movimientos: number }}
 */
function construirExtractoSintetico({
  hoy = new Date(),
  ingresoMensual = 5_000,
  tipo = 'tres-meses',
} = {}) {
  const cierre = sumarDias(inicioDelDia(hoy), -1);
  const movimientos = movimientosDe(tipo, ingresoMensual, cierre);
  const inicio = inicioDelPeriodo(tipo, movimientos);

  const cabecera = [
    { text: 'BANCO GANADERO S.A.', x: 20, y: lineY(0) },
    { text: 'EXTRACTO DE CUENTA CORRIENTE', x: 20, y: lineY(1) },
    { text: 'CLIENTE: CLIENTE DE PRUEBA', x: 20, y: lineY(2) },
    { text: 'CUENTA: 1234567890', x: 20, y: lineY(3) },
    { text: `PERIODO: ${diaImpreso(inicio)} AL ${diaImpreso(cierre)}`, x: 20, y: lineY(4) },
  ];

  const saldoInicial = 10_000;
  const celdas = [
    { text: 'SALDO INICIAL', x: 20, y: lineY(5) },
    { text: bolivianos(saldoInicial), x: 620, y: lineY(5) },
    { text: 'FECHA', x: 20, y: lineY(7) },
    { text: 'DESCRIPCION', x: 120, y: lineY(7) },
    { text: 'DEBITO', x: 420, y: lineY(7) },
    { text: 'CREDITO', x: 520, y: lineY(7) },
    { text: 'SALDO', x: 620, y: lineY(7) },
  ];

  // El saldo corriente se calcula aquí, no se teclea: el motor CONCILIA su continuidad y un
  // saldo mal escrito acabaría en revisión por datos ambiguos, que se leería como un fallo suyo.
  let saldo = saldoInicial;
  let abonos = 0;
  movimientos.forEach((movimiento, indice) => {
    const fila = 8 + indice;
    saldo += (movimiento.credito ?? 0) - (movimiento.debito ?? 0);
    abonos += movimiento.credito ?? 0;
    celdas.push(
      { text: diaImpreso(movimiento.fecha), x: 20, y: lineY(fila) },
      { text: movimiento.descripcion, x: 120, y: lineY(fila) },
      { text: bolivianos(Number(saldo.toFixed(2))), x: 620, y: lineY(fila) },
    );
    if (movimiento.debito) celdas.push({ text: bolivianos(movimiento.debito), x: 420, y: lineY(fila) });
    if (movimiento.credito)
      celdas.push({ text: bolivianos(movimiento.credito), x: 520, y: lineY(fila) });
  });
  const filaFinal = 9 + movimientos.length;
  celdas.push(
    { text: 'SALDO FINAL', x: 20, y: lineY(filaFinal) },
    { text: bolivianos(Number(saldo.toFixed(2))), x: 620, y: lineY(filaFinal) },
  );

  const emision = sumarDias(cierre, 1);
  const pdf = buildSyntheticPdf([...cabecera, ...celdas], {
    producer: 'JasperReports Library 6.20.0',
    creationDate:
      `${emision.getUTCFullYear()}${dos(emision.getUTCMonth() + 1)}${dos(emision.getUTCDate())}` +
      "090000-04'00'",
  });

  return {
    base64: pdf.toString('base64'),
    fileName: 'extracto-sintetico.pdf',
    abonos: Number(abonos.toFixed(2)),
    movimientos: movimientos.length,
  };
}

module.exports = { construirExtractoSintetico };
