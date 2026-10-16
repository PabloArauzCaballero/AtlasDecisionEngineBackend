import { Rule } from './types';

export const OUTFLOW_RULES: readonly Rule[] = [
  {
    kind: 'HIGH_RISK',
    patterns: [
      /casino/,
      /apuesta/,
      /\bbet\b|betano|betfair|1xbet|rushbet|codere/,
      /loteria/,
      /binance|coinbase|bybit|kucoin|okx|criptomoneda|\bcripto\b/,
      /forex|trading\s+online/,
    ],
  },
  {
    kind: 'DEBT_SERVICE',
    patterns: [
      /amortizaci?on/,
      /cuota\s+(de\s+)?(prestamo|credito|vehiculo|vivienda)/,
      /pago\s+(de\s+)?(prestamo|credito|cuota)/,
      /debito\s+automatico\s+(prestamo|credito|cuota)/,
      /tarjeta\s+de\s+credito/,
      /pago\s+(minimo|total)\s+tarjeta/,
      /\bleasing\b/,
      /interes\s+(de\s+)?(prestamo|mora)/,
      /mora\s+prestamo/,
      /\bbnpl\b|compra\s+en\s+cuotas|pago\s+en\s+cuotas/,
      /refinanciamiento/,
      /capital\s+e\s+intereses/,
    ],
  },
  {
    kind: 'INSURANCE_CONTRIBUTION',
    patterns: [
      /\bseguro\b/,
      /\bpoliza\b/,
      /\bafp\b|gestora\s+publica|aporte\s+jubilatorio/,
      /aporte\s+(patronal|laboral|solidario)/,
      /\bcns\b|caja\s+nacional\s+de\s+salud/,
      /\bdesgravamen\b/,
      /prevision/,
    ],
  },
  {
    kind: 'ESSENTIAL',
    patterns: [
      /\bdelapaz\b|\bcre\b|\belfec\b|\bsetar\b|\bcessa\b|\bsepsa\b/,
      /energia\s+electrica|\bluz\b/,
      /\bepsas\b|\bsaguapac\b|\bcosaalt\b|agua\s+potable/,
      /\bycsa\b|gas\s+domiciliario/,
      /\bentel\b|\btigo\b|\bviva\b|\bcotel\b|\bcomteco\b/,
      /internet|telefonia|television\s+por\s+cable/,
      /*
       * `alquiler` a secas, y no sólo «pago de alquiler». Es un cargo y el
       * cargo de un alquiler es siempre el pago: la variante que entra dinero
       * —«ALQUILER COBRADO»— ya está en la lista de abonos, así que aquí no hay
       * ambigüedad que resolver. Con la forma larga, «PAGO ALQUILER» —que es
       * como lo escribe la mitad de las transferencias— caía en gasto
       * discrecional, y el compromiso más grande de un hogar desaparecía del
       * gasto comprometido.
       */
      /\balquiler\b/,
      /\barriendo\b/,
      /anticretico/,
      /colegio|universidad|\bupb\b|\bucb\b|\bumsa\b|\bumss\b|matricula|pension\s+escolar/,
      /farmacia|clinica|hospital|laboratorio\s+clinico/,
      /supermercado|hipermaxi|fidalga|ic\s?norte|ketal|tia\b/,
      /combustible|gasolina|\bypfb\b|surtidor/,
    ],
  },
  {
    kind: 'TAX_FEE',
    patterns: [
      /\bitf\b/,
      /impuesto/,
      /comisi?on/,
      /mantenimiento\s+de\s+cuenta/,
      /\biva\b|\bit\b\s+retenido|\brc-?iva\b/,
      /\bsin\b\s+pago|impuestos\s+nacionales/,
      /gastos\s+administrativos/,
      /portes|chequera/,
    ],
  },
  {
    kind: 'CASH_WITHDRAWAL',
    patterns: [
      /retiro\s+(de\s+)?efectivo/,
      /\batm\b|cajero\s+automatico/,
      /retiro\s+(ventanilla|caja)/,
      /disposici?on\s+de\s+efectivo/,
    ],
  },
  {
    kind: 'INTERNAL_TRANSFER',
    patterns: [
      /traspaso\s+(entre|a)\s+(mis\s+)?cuentas/,
      /transferencia\s+propia/,
      /entre\s+cuentas\s+propias/,
      /mismo\s+titular/,
    ],
  },
];
