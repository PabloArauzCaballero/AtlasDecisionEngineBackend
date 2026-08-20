import { DocumentClassifier } from '../src/modules/workers/bank-statement/core/engine/document-classifier';
import type { ExtractedPdf } from '../src/modules/workers/bank-statement/core/domain/models';

/**
 * La compuerta que decide si un PDF es un estado de cuenta.
 *
 * Se prueba aquí y no dentro de un extremo a extremo porque su defecto es
 * silencioso: rechaza el documento entero y el motor responde
 * `NOT_A_FINANCIAL_STATEMENT`, que se lee como «tu PDF está mal» cuando el
 * problema estaba en la compuerta.
 */

function pdfDe(lineas: readonly string[]): ExtractedPdf {
  return {
    text: lineas.join('\n'),
    lines: lineas.map((text, index) => ({ text, page: 1, y: index })),
    pageCount: 1,
  } as unknown as ExtractedPdf;
}

/** Cabecera de un extracto real: entidad, cuenta, periodo y fila de columnas. */
const CABECERA = [
  'BANCO SINTETICO LAB',
  'Cuenta de prueba: CUENTA-TEST-P01 | Moneda: BOB | Periodo: 01/01/2026 - 28/01/2026',
  'Saldo inicial pagina: 12,450.00 BOB',
  'FECHA VALOR CANAL DESCRIPCION DEBITO CREDITO SALDO',
];

const MOVIMIENTOS = [
  '01/01/26 NOMINA ABONO NOMINA ASOCIACION FICT 8,276.68 20,726.68',
  '03/01/26 GOBIERNO TASA / TRAMITE GUBERNAMENTAL 56.96 20,669.72',
  '04/01/26 BANCO INTERES A FAVOR CUENTA 9.61 20,679.33',
];

describe('DocumentClassifier', () => {
  const classifier = new DocumentClassifier();

  it('acepta un extracto sin título reconocible pero con tabla de movimientos', () => {
    const resultado = classifier.classify(pdfDe([...CABECERA, ...MOVIMIENTOS]));
    expect(resultado.isFinancialStatement).toBe(true);
  });

  /*
   * El defecto que motiva este archivo.
   *
   * Un extracto sintético de sesenta páginas se rechazaba porque en la página
   * dos una glosa decía `CUOTA HIPOTECA CONTRATO MT-471966-W`: la palabra
   * «contrato» disparaba el contraindicador y restaba 0,35 sobre un documento
   * que sumaba 0,70, dejándolo en 0,35 —por debajo del umbral—. La palabra
   * dentro de un movimiento describe EL MOVIMIENTO, no el documento.
   */
  it('no penaliza la palabra «contrato» cuando aparece en la glosa de un movimiento', () => {
    const conContratoEnElCuerpo = pdfDe([
      ...CABECERA,
      ...MOVIMIENTOS,
      '05/02/26 DEBITO AUTO CUOTA HIPOTECA CONTRATO MT-471966-W 439.79 22,527.60',
      '06/02/26 TARJETA PAGO FACTURA DE SERVICIOS 65.03 22,462.57',
    ]);
    const resultado = classifier.classify(conContratoEnElCuerpo);

    expect(resultado.detectedSignals).not.toContain('contraindicador-de-otro-documento');
    expect(resultado.isFinancialStatement).toBe(true);
  });

  /*
   * La factura boliviana era el hueco grande, y no por parecerse a un extracto:
   * lo suma TODO —imprime «Estado de Cuenta» del cliente, número de cuenta,
   * saldo, columna de importes y una tabla de consumos fechados—. Llegaba a
   * 1.00, la penalización de 0.35 la dejaba en 0.65 y se procesaba.
   *
   * Lo que la cierra no es una palabra que «suene» a factura: es el código de
   * control que el SIN pone en cada una. Ningún banco lo imprime en un extracto,
   * así que encontrarlo en la carátula no es evidencia en contra — es la
   * respuesta, y por eso el veredicto es REJECT y no una confianza rebajada.
   */
  it('rechaza sin puntuar la factura que trae la marca del SIN', () => {
    const factura = classifier.classify(
      pdfDe([
        'ESTADO DE CUENTA DEL CLIENTE',
        'FACTURA ELECTRONICA',
        'NIT: 1023456789   CODIGO DE CONTROL: A2-B4-C6-D8',
        'CUENTA: 70011223   SALDO ANTERIOR: 120,00',
        'FECHA DETALLE IMPORTE SALDO',
        '05/03/2026 CONSUMO DEL PERIODO 150,00 270,00',
        '20/03/2026 PAGO RECIBIDO 120,00 150,00',
      ]),
    );

    expect(factura.verdict).toBe('REJECT');
    expect(factura.confidence).toBe(0);
    expect(factura.documentType).toBe('TAX_INVOICE');
    // No entra en la cola: no hay nada que una persona pueda resolver mirándola.
    expect(factura.isFinancialStatement).toBe(false);
  });

  /*
   * Y la mitad que impide que el arreglo se pase de frenada: la marca decisiva
   * se busca sólo en la CARÁTULA. Un extracto real menciona facturas en las
   * glosas de sus movimientos, y esa palabra describe EL MOVIMIENTO.
   */
  it('no rechaza el extracto que paga facturas en sus movimientos', () => {
    const extracto = classifier.classify(
      pdfDe([
        ...CABECERA,
        ...MOVIMIENTOS,
        '05/02/26 DEBITO PAGO FACTURA ELECTRONICA CODIGO DE CONTROL A1-B2 65.03 22,462.57',
      ]),
    );

    expect(extracto.verdict).not.toBe('REJECT');
    expect(extracto.isFinancialStatement).toBe(true);
  });

  /*
   * Y la otra mitad: la compuerta sigue existiendo. Un documento que se ANUNCIA
   * como otra cosa se penaliza igual que antes, que es para lo que se escribió.
   */
  it('sigue penalizando al documento que se anuncia como factura en su cabecera', () => {
    const factura = pdfDe([
      'FACTURA COMERCIAL N.º 0012',
      'Cliente: EMPRESA FICTICIA SRL',
      'Fecha 01/01/2026 Importe 1,200.00',
      '01/01/26 Servicio prestado 1,200.00',
      '02/01/26 Servicio prestado 300.00',
    ]);
    const resultado = classifier.classify(factura);

    expect(resultado.detectedSignals).toContain('contraindicador-de-otro-documento');
    expect(resultado.isFinancialStatement).toBe(false);
  });
});
