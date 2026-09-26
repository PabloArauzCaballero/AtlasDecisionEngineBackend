/**
 * La compuerta del CONTENEDOR, medida sobre bytes de PDF puestos a mano.
 *
 * Se prueba sin `pdfjs-dist` a propósito, y no sólo porque sólo pueda cargarse
 * en una máquina virtual de Jest por corrida: es que la compuerta NO interpreta
 * el PDF. Lee sus bytes y cuenta marcas, y esa es su garantía de seguridad —el
 * archivo lo sube un desconocido y aquí no se ejecuta nada de lo que trae—. Una
 * prueba que necesitara un lector completo estaría probando otra cosa.
 */
import {
  assessAuthenticity,
  DEFAULT_AUTHENTICITY_OPTIONS,
} from '../src/modules/workers/bank-statement/core/engine/authenticity/authenticity-gate';
import {
  assessProvenance,
  readPdfProvenance,
} from '../src/modules/workers/bank-statement/core/engine/authenticity/pdf-forensics';

/** Un PDF mínimo con el diccionario `/Info` que se le quiera dar. */
function pdf(info: string, extra = ''): Buffer {
  return Buffer.from(
    `%PDF-1.7\n` +
      `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
      `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n` +
      `3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n` +
      `4 0 obj\n<< /Type /Font /BaseFont /Helvetica >>\nendobj\n` +
      `5 0 obj\n<< ${info} >>\nendobj\n` +
      extra +
      `trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\n%%EOF\n`,
    'latin1',
  );
}

describe('compuerta de autenticidad del contenedor', () => {
  it('acepta un PDF de un motor de informes sin marcas de edición', () => {
    const veredicto = assessAuthenticity(
      pdf("/Producer (JasperReports Library 6.20.0) /CreationDate (D:20260401090000-04'00')"),
      1,
    );

    expect(veredicto.verdict).toBe('AUTHENTIC');
    expect(veredicto.disposition).toBe('ACCEPT');
    expect(veredicto.report.suspicionScore).toBeLessThan(DEFAULT_AUTHENTICITY_OPTIONS.reviewScore);
  });

  it('rechaza el compuesto con una herramienta de diseño', () => {
    const veredicto = assessAuthenticity(pdf('/Producer (Adobe Photoshop 25.0)'), 1);

    expect(veredicto.verdict).toBe('TAMPERED');
    expect(veredicto.disposition).toBe('REJECT');
    expect(veredicto.report.signals.map((signal) => signal.code)).toContain(
      'HERRAMIENTA_DE_AUTORIA',
    );
  });

  it('rechaza el que se volvió a guardar en la Vista Previa de macOS', () => {
    /*
     * Es el que más se cuela: un extracto descargado del banco y abierto no
     * cambia; uno que pasó por Vista Previa y se guardó es, por definición, un
     * archivo distinto del que emitió el banco.
     */
    expect(assessAuthenticity(pdf('/Producer (Quartz PDFContext)'), 1).verdict).toBe('TAMPERED');
  });

  it('rechaza SIEMPRE el que trae contenido ejecutable, aunque el resto esté limpio', () => {
    const veredicto = assessAuthenticity(
      pdf(
        '/Producer (iText 7.2.5)',
        '6 0 obj\n<< /S /JavaScript /JS (app.alert\\(1\\)) >>\nendobj\n',
      ),
      1,
    );

    expect(veredicto.verdict).toBe('TAMPERED');
    expect(veredicto.report.suspicionScore).toBe(100);
    expect(veredicto.report.signals.some((signal) => signal.severity === 'CRITICAL')).toBe(true);
  });

  it('manda a REVISIÓN lo que sólo tiene indicios, en vez de rechazarlo', () => {
    /*
     * La impresión desde el navegador es lo que hace media Bolivia con su banca
     * por internet, y una reescritura puede ser del propio emisor. Ninguna de las
     * dos justifica un rechazo; juntas justifican que alguien lo mire.
     */
    const veredicto = assessAuthenticity(
      pdf(
        '/Producer (Skia/PDF m125) /CreationDate (D:20260401090000Z) /ModDate (D:20260403141200Z)',
      ),
      1,
    );

    expect(veredicto.verdict).toBe('SUSPECT');
    expect(veredicto.disposition).toBe('REVIEW');
  });

  it('detecta las anotaciones superpuestas, que son la tachadura digital', () => {
    const veredicto = assessAuthenticity(
      pdf('/Producer (iText 7.2.5)', '6 0 obj\n<< /Type /Annot /Subtype /FreeText >>\nendobj\n'),
      1,
    );

    expect(veredicto.report.signals.map((signal) => signal.code)).toContain(
      'ANOTACIONES_SUPERPUESTAS',
    );
    expect(veredicto.disposition).not.toBe('ACCEPT');
  });

  it('no penaliza al escaneado por ausencias que en una imagen no significan nada', () => {
    /*
     * En una página sin texto no hay fuentes que incrustar. Penalizarlo sería
     * castigar dos veces al mismo documento: el motor ya lo manda a OCR o lo
     * deriva por no tener capa de texto.
     */
    const provenance = readPdfProvenance(pdf('/Producer (Canon iR-ADV Scanner)'));
    const conTexto = assessProvenance(provenance, 1);
    const sinTexto = assessProvenance(provenance, 0);

    expect(sinTexto.suspicionScore).toBeLessThanOrEqual(conTexto.suspicionScore);
  });

  it('lee el productor aunque venga en UTF-16, que es como lo escribe Word', () => {
    const utf16 = Buffer.from('\\376\\377\\000W\\000o\\000r\\000d', 'latin1').toString('latin1');
    const provenance = readPdfProvenance(pdf(`/Producer (${utf16})`));

    expect(provenance.producer).toBe('Word');
  });

  it('en modo de MEDICIÓN conserva el veredicto y sólo relaja el desenlace', () => {
    /*
     * Es lo que permite responder «¿cuántos documentos rechazaríamos?» sin haber
     * rechazado ninguno todavía. Perder el veredicto al apagar la exigencia haría
     * imposible medir el efecto antes de encenderla.
     */
    const veredicto = assessAuthenticity(pdf('/Producer (Adobe Photoshop 25.0)'), 1, {
      ...DEFAULT_AUTHENTICITY_OPTIONS,
      enforce: false,
    });

    expect(veredicto.verdict).toBe('TAMPERED');
    expect(veredicto.disposition).toBe('ACCEPT');
    expect(veredicto.reasons).toContain('compuerta-en-medicion');
  });

  it('cuenta las reescrituras por lo BAJO', () => {
    /*
     * Dos formas de contar lo mismo —`/Prev` y `%%EOF`— y se toma la menor:
     * cuando la señal va a pesar en un rechazo, se prefiere no ver una edición
     * real a inventar una que no hubo.
     */
    const dosRevisiones = readPdfProvenance(
      Buffer.from(
        `%PDF-1.7\n1 0 obj\n<< >>\nendobj\ntrailer\n<< /Size 2 /Root 1 0 R >>\n%%EOF\n` +
          `trailer\n<< /Size 3 /Root 1 0 R /Prev 100 >>\n%%EOF\n` +
          `trailer\n<< /Size 4 /Root 1 0 R /Prev 200 >>\n%%EOF\n`,
        'latin1',
      ),
    );

    expect(dosRevisiones.incrementalUpdates).toBe(2);
  });
});
