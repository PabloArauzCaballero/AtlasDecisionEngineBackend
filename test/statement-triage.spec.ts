import { StatementRejectionReason, StatementReviewReason, WorkerRunStatus } from '@prisma/client';
import { DocumentClassifier } from '../src/modules/workers/bank-statement/core/engine/document-classifier';
import {
  DEFAULT_TRIAGE_THRESHOLDS,
  normalizeThresholds,
  triageDocument,
} from '../src/modules/workers/bank-statement/core/engine/document-triage';
import type { ExtractedPdf } from '../src/modules/workers/bank-statement/core/domain/models';
import {
  outcomeForError,
  outcomeForResult,
} from '../src/modules/workers/bank-statement/statement-outcome';

/**
 * El triage: qué se procesa, qué se pregunta y qué se rechaza.
 *
 * Se prueba aquí, sin base de datos ni PDF, porque es una regla de negocio y su
 * defecto es caro y silencioso en las dos direcciones: si la franja de revisión
 * se abre de más, la cola humana se llena de facturas y deja de leerse; si se
 * cierra de más, un extracto legítimo con el encabezado ilegible se rechaza y
 * quien lo subió no tiene a quién recurrir.
 */

function pdfDe(lineas: readonly string[]): ExtractedPdf {
  return {
    text: lineas.join('\n'),
    lines: lineas.map((text, index) => ({ text, page: 1, y: index })),
    pageCount: 1,
  } as unknown as ExtractedPdf;
}

describe('triageDocument', () => {
  it('procesa desde el umbral de aceptación, inclusive', () => {
    expect(triageDocument(DEFAULT_TRIAGE_THRESHOLDS.accept)).toBe('ACCEPT');
    expect(triageDocument(1)).toBe('ACCEPT');
  });

  it('pregunta en la franja intermedia', () => {
    expect(triageDocument(DEFAULT_TRIAGE_THRESHOLDS.review)).toBe('REVIEW');
    expect(triageDocument(0.4)).toBe('REVIEW');
  });

  it('rechaza por debajo de la franja', () => {
    expect(triageDocument(0.29)).toBe('REJECT');
    expect(triageDocument(0)).toBe('REJECT');
  });

  /*
   * Un `review` por encima del `accept` dejaría la franja de duda VACÍA: todo
   * documento dudoso pasaría a rechazarse sin que nada lo delatara, porque la
   * pantalla seguiría funcionando igual y la cola simplemente estaría vacía.
   */
  it('nunca abre una franja de revisión imposible aunque se configure al revés', () => {
    const invertido = normalizeThresholds({ accept: 0.4, review: 0.9 });
    expect(invertido.review).toBeLessThanOrEqual(invertido.accept);
    expect(triageDocument(0.5, invertido)).toBe('ACCEPT');
  });

  it('acota los valores fuera de rango en vez de propagarlos', () => {
    expect(normalizeThresholds({ accept: 5, review: -2 })).toEqual({ accept: 1, review: 0 });
    expect(normalizeThresholds({ accept: Number.NaN }).accept).toBe(0);
  });
});

describe('DocumentClassifier · los tres veredictos', () => {
  const classifier = new DocumentClassifier();

  it('acepta un extracto con tabla de movimientos', () => {
    const resultado = classifier.classify(
      pdfDe([
        'BANCO SINTETICO LAB',
        'Cuenta de prueba: CUENTA-TEST-P01 | Moneda: BOB',
        'Saldo inicial pagina: 12,450.00 BOB',
        'FECHA VALOR CANAL DESCRIPCION DEBITO CREDITO SALDO',
        '01/01/26 NOMINA ABONO NOMINA 8,276.68 20,726.68',
        '03/01/26 GOBIERNO TASA / TRAMITE 56.96 20,669.72',
      ]),
    );
    expect(resultado.verdict).toBe('ACCEPT');
    expect(resultado.isFinancialStatement).toBe(true);
  });

  /*
   * El caso que justifica todo el trabajo: un documento con rótulos financieros
   * y SIN tabla legible. Antes caía en el mismo cajón que una fotografía, y con
   * él se fue a revisión —o al rechazo— toda la franja de duda de golpe.
   */
  it('deriva a revisión el documento con señales financieras y sin tabla legible', () => {
    // Un extracto escaneado cuyo OCR sólo rescató la cabecera: el título quedó
    // ilegible («CU3NTA») y de la tabla no salió ni una fila con fecha e importe.
    // Quedan tres rótulos sueltos, que es exactamente la duda razonable.
    const resultado = classifier.classify(
      pdfDe([
        'ESTADO DE CU3NTA — PAGINA 1 DE 4',
        'Numero de cuenta: ****4471',
        'Saldo disponible al corte',
        'Fecha Descripcion Monto',
      ]),
    );
    expect(resultado.verdict).toBe('REVIEW');
    expect(resultado.isFinancialStatement).toBe(false);
  });

  it('rechaza un documento sin ninguna señal financiera', () => {
    const resultado = classifier.classify(
      pdfDe([
        'CERTIFICADO DE ASISTENCIA',
        'Se hace constar que la persona interesada asistió al taller',
        'Firmado en la ciudad correspondiente',
      ]),
    );
    expect(resultado.verdict).toBe('REJECT');
  });

  it('rechaza una factura, que era lo que llenaba la cola de revisión', () => {
    const resultado = classifier.classify(
      pdfDe([
        'FACTURA COMERCIAL N.º 0012',
        'Cliente: EMPRESA FICTICIA SRL',
        'Fecha 01/01/2026 Importe 1,200.00',
        '01/01/26 Servicio prestado 1,200.00',
        '02/01/26 Servicio prestado 300.00',
      ]),
    );
    expect(resultado.verdict).toBe('REJECT');
  });
});

describe('outcomeForError', () => {
  it('rechaza un documento que no es un extracto, sin pasar por la cola', () => {
    const outcome = outcomeForError('NOT_A_FINANCIAL_STATEMENT');
    expect(outcome.status).toBe(WorkerRunStatus.PDF_INVALID);
    expect(outcome.rejectionReason).toBe(StatementRejectionReason.NOT_BANK_STATEMENT);
    // La invariante que mantiene la cola legible.
    expect(outcome.reviewReason).toBeNull();
  });

  it('deriva el documento dudoso a la cola, con su categoría', () => {
    const outcome = outcomeForError('DOUBTFUL_DOCUMENT');
    expect(outcome.status).toBe(WorkerRunStatus.PENDING_REVIEW);
    expect(outcome.reviewReason).toBe(StatementReviewReason.DOUBTFUL_DOCUMENT);
    expect(outcome.rejectionReason).toBeNull();
  });

  it('deriva el vencimiento de plazo a revisión y no a fallo', () => {
    const outcome = outcomeForError('PDF_PROCESSING_TIMEOUT');
    expect(outcome.status).toBe(WorkerRunStatus.PENDING_REVIEW);
    expect(outcome.reviewReason).toBe(StatementReviewReason.TIMEOUT);
    // Prioridad alta: hay alguien esperando al otro lado.
    expect(outcome.reviewPriority).toBe(1);
  });

  it('deriva el banco no reconocido y el formato sin analizador a la misma categoría', () => {
    expect(outcomeForError('UNSUPPORTED_INSTITUTION').reviewReason).toBe(
      StatementReviewReason.UNKNOWN_BANK,
    );
    expect(outcomeForError('UNSUPPORTED_STATEMENT_FORMAT').reviewReason).toBe(
      StatementReviewReason.UNKNOWN_BANK,
    );
  });

  it('rechaza el PDF ilegible en vez de encolar un archivo que nadie puede abrir', () => {
    expect(outcomeForError('PDF_EXTRACTION_FAILED').rejectionReason).toBe(
      StatementRejectionReason.CORRUPTED_PDF,
    );
    expect(outcomeForError('ENCRYPTED_PDF').rejectionReason).toBe(
      StatementRejectionReason.UNREADABLE_DOCUMENT,
    );
  });

  /*
   * Un código nuevo que alguien marque como revisable sin declarar su categoría
   * NO puede colarse en la cola sin motivo: un pendiente sin categoría rompe
   * justo lo que hace legible la lista, y el fallo se vería —a diferencia de una
   * fila mal clasificada, que nadie detecta porque la pantalla sigue pintando.
   */
  it('falla en vez de encolar un caso revisable sin categoría declarada', () => {
    const outcome = outcomeForError('CODIGO_QUE_NADIE_DECLARO', 'REVIEW');
    expect(outcome.status).toBe(WorkerRunStatus.FAILED);
    expect(outcome.reviewReason).toBeNull();
  });
});

describe('outcomeForResult', () => {
  const limpio = { overallConfidence: 0.92, errors: [], warnings: [] };

  it('da por bueno un resultado con confianza alta y sin advertencias', () => {
    expect(outcomeForResult(limpio, 0.5).status).toBe(WorkerRunStatus.SUCCEEDED);
  });

  it('entrega con advertencias sin gastar revisión humana', () => {
    const outcome = outcomeForResult({ ...limpio, warnings: ['paginas-sin-texto:1'] }, 0.5);
    expect(outcome.status).toBe(WorkerRunStatus.SUCCEEDED_WITH_WARNINGS);
    expect(outcome.reviewReason).toBeNull();
  });

  it('deriva por baja confianza de EXTRACCIÓN, no de clasificación', () => {
    const outcome = outcomeForResult({ ...limpio, overallConfidence: 0.31 }, 0.5);
    expect(outcome.status).toBe(WorkerRunStatus.PENDING_REVIEW);
    expect(outcome.reviewReason).toBe(StatementReviewReason.LOW_CONFIDENCE);
  });

  /*
   * Las comprobaciones contables mandan sobre la confianza: un dato que
   * CONTRADICE lo que el banco imprime es peor que un dato incierto, porque se
   * publicaría como cierto. Con las dos condiciones a la vez gana ésta.
   */
  it('prioriza el descuadre contable sobre la confianza', () => {
    const outcome = outcomeForResult(
      { overallConfidence: 0.2, errors: ['BALANCE_MISMATCH: 3 filas'], warnings: [] },
      0.5,
    );
    expect(outcome.reviewReason).toBe(StatementReviewReason.AMBIGUOUS_DATA);
    expect(outcome.reviewPriority).toBe(1);
  });
});
