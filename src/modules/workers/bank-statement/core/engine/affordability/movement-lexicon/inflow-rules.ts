import { Rule } from './types';

/**
 * El orden IMPORTA y es de más específico a más general.
 *
 * «PAGO PRESTAMO» y «PAGO SERVICIO LUZ» empiezan igual; si la regla de pagos
 * genéricos fuera antes, la cuota del préstamo caería en gasto esencial y el
 * compromiso más importante del expediente desaparecería del cálculo.
 */
export const INFLOW_RULES: readonly Rule[] = [
  {
    kind: 'REVERSAL',
    patterns: [
      /revers/,
      /anulaci?on/,
      /devoluci?on/,
      /extorno/,
      /contrasiento/,
      /nota\s+de\s+credito\s+por\s+error/,
      /rechazo\s+de\s+(pago|transferencia)/,
    ],
  },
  {
    kind: 'CREDIT_DISBURSEMENT',
    patterns: [
      /desembolso/,
      /abono\s+de\s+prestamo/,
      /liquidaci?on\s+de\s+prestamo/,
      /credito\s+otorgado/,
      /adelanto\s+de\s+sueldo/,
      /prestamo\s+(personal|de\s+consumo|otorgado)/,
      /linea\s+de\s+credito\s+utilizada/,
      /avance\s+de\s+efectivo/,
    ],
  },
  {
    kind: 'PAYROLL',
    patterns: [
      /\bhaberes?\b/,
      /planilla/,
      /\bsueldo/,
      /\bsalario/,
      /remuneraci?on/,
      /pago\s+de\s+personal/,
      /abono\s+de\s+haberes/,
      /nomina/,
      /aguinaldo/,
      /bono\s+de\s+produccion/,
      /pago\s+quincena/,
    ],
  },
  {
    kind: 'INTERNAL_TRANSFER',
    patterns: [
      /traspaso\s+(entre|a)\s+(mis\s+)?cuentas/,
      /transferencia\s+propia/,
      /entre\s+cuentas\s+propias/,
      /mismo\s+titular/,
      /traspaso\s+ahorro/,
    ],
  },
  {
    kind: 'BUSINESS',
    patterns: [
      /\bqr\b/,
      /cobro\s+qr/,
      /recaudaci?on/,
      /ventas?\s+(del\s+dia|pos|tarjeta)/,
      /liquidaci?on\s+(pos|comercio|adquirencia)/,
      /honorarios/,
      /factura\s+cobrada/,
      /\bpos\b/,
      /abono\s+comercio/,
    ],
  },
  {
    kind: 'RECURRING_OTHER',
    patterns: [
      /renta\s+dignidad/,
      /bono\s+juana\s+azurduy/,
      /\bpension\b/,
      /jubilaci?on/,
      /alquiler\s+cobrado/,
      /remesa/,
      /western\s+union|money\s?gram|\bria\b/,
      /giro\s+recibido/,
      /transferencia\s+recibida/,
      /\bach\b\s+recibid/,
      /\blip\b\s+recibid/,
      /deposito\s+de\s+tercero/,
    ],
  },
];
