import type { Regla } from './glosa-regla';

/**
 * Rubros de la capa 1 — Ingresos nombrados y movimientos financieros nombrados.
 * Ver `glosa-rubros.ts` para el orden entre grupos, que importa.
 */
export const RUBROS_INGRESOS_Y_FINANZAS: readonly Regla[] = [
  // --- Ingresos nombrados --------------------------------------------------
  {
    patron: /\b(?:SUELDO|SALARIO|HABERES|PLANILLA|NOMINA|REMUNERACION|AGUINALDO|BONO\s+ANUAL)\b/u,
    salida: ['GASTOS.NOMINA'],
    entrada: ['INGRESOS.SUELDO'],
    porque: 'la glosa declara el pago de haberes',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:FINIQUITO|INDEMNIZACION|DESAHUCIO|BENEFICIOS\s+SOCIALES)\b/u,
    salida: ['GASTOS.LABORALES.FINIQUITO'],
    entrada: ['INGRESOS.FINIQUITO'],
    porque: 'la glosa declara un finiquito o beneficios sociales',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:WESTERN\s+UNION|MONEYGRAM|RIA\b|REMESA|GIRO\s+DEL\s+EXTERIOR|MORE\s+MONEY)\b/u,
    salida: ['GASTOS.REMESA'],
    entrada: ['INGRESOS.REMESA'],
    porque: 'la glosa declara una remesa',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:VIATICO|VIATICOS)\b/u,
    salida: ['GASTOS.EMPRESARIALES.VIATICOS'],
    entrada: ['INGRESOS.VIATICOS'],
    porque: 'la glosa declara viáticos',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:BONO\s+JUANA\s+AZURDUY|RENTA\s+DIGNIDAD|BONO\s+JUANCITO|SUBSIDIO|SUBVENCION)\b/u,
    salida: ['GASTOS.SUBVENCIONES'],
    entrada: ['INGRESOS.SUBSIDIO', 'INGRESOS.SUBVENCION'],
    porque: 'la glosa declara un subsidio o subvención del Estado',
    certeza: 'ALTA',
  },

  // --- Financiero nombrado -------------------------------------------------
  {
    patron: /\b(?:DPF|DEPOSITO\s+A\s+PLAZO|AHORRO\s+PROGRAMADO|CAJA\s+DE\s+AHORRO\s+META)\b/u,
    salida: ['GASTOS.AHORRO'],
    entrada: ['INGRESOS.RESCATE', 'INGRESOS.FINANCIERO'],
    porque: 'la glosa declara un movimiento de ahorro a plazo',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:AMORTIZACION|CUOTA\s+PRESTAMO|CUOTA\s+CREDITO|CUOTA\s+HIPOTEC|CAPITAL\s+E\s+INTERES|PRESTAMO)\b/u,
    salida: ['GASTOS.FINANCIEROS.PRESTAMOS'],
    entrada: ['INGRESOS.PRESTAMO'],
    porque: 'la glosa declara la cuota de un préstamo',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:MORA|INTERES\s+PENAL|PENALIDAD\s+POR\s+ATRASO|GASTOS\s+DE\s+COBRANZA)\b/u,
    salida: ['GASTOS.FINANCIEROS.MORA'],
    entrada: [],
    porque: 'la glosa declara un cargo por mora',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:LEASING|ARRENDAMIENTO\s+FINANCIERO)\b/u,
    salida: ['GASTOS.FINANCIEROS.LEASING'],
    entrada: [],
    porque: 'la glosa declara un leasing',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:SEGURO|POLIZA|ASEGURADORA|ALIANZA\s+SEGUROS|BISA\s+SEGUROS|NACIONAL\s+SEGUROS|CREDINFORM)\b/u,
    salida: ['GASTOS.FINANCIEROS.SEGUROS'],
    entrada: ['INGRESOS.SEGURO'],
    porque: 'la glosa declara una prima o un siniestro de seguro',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:COMPRA\s+VENTA\s+DE\s+MONEDA|CAMBIO\s+DE\s+DIVISA|TIPO\s+DE\s+CAMBIO|MESA\s+DE\s+DINERO|FOREX)\b/u,
    salida: ['GASTOS.FINANCIEROS.CAMBIO'],
    entrada: ['INGRESOS.CAMBIO'],
    porque: 'la glosa declara una operación de cambio de divisa',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:BINANCE|CRIPTO|BITCOIN|USDT|BLOCKCHAIN|WALLET\s+CRIPTO)\b/u,
    salida: ['GASTOS.FINANCIEROS.CRIPTO'],
    entrada: [],
    porque: 'la glosa declara una operación con criptoactivos',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CONTRACARGO|CHARGEBACK|CONTRA\s*CARGO)\b/u,
    salida: ['GASTOS.FINANCIEROS.CONTRACARGO'],
    entrada: ['INGRESOS.DISPUTA'],
    porque: 'la glosa declara un contracargo',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:EMBARGO|RETENCION\s+JUDICIAL|ORDEN\s+JUDICIAL|JUZGADO|ASISTENCIA\s+FAMILIAR)\b/u,
    salida: ['GASTOS.FINANCIEROS.JUDICIAL'],
    entrada: ['INGRESOS.JUDICIAL'],
    porque: 'la glosa declara una retención u orden judicial',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:LIQUIDACION\s+POS|LIQUIDACION\s+ADQUIRENCIA|ABONO\s+COMERCIO|SETTLEMENT)\b/u,
    salida: ['GASTOS.ADQUIRENCIA'],
    entrada: ['INGRESOS.ADQUIRENCIA'],
    porque: 'la glosa declara una liquidación del adquirente de tarjetas',
    certeza: 'ALTA',
  },
];
