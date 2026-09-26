/**
 * Ejemplo de consumo desde otro artefacto del ecosistema (§43).
 *
 * Es código real y compilado, no pseudocódigo: si el contrato del generador cambiara de forma
 * incompatible, este archivo dejaría de compilar y el ejemplo de la documentación no podría
 * quedarse obsoleto en silencio.
 *
 * Lo que hay que mirar es lo que NO aparece: ni una etiqueta HTML, ni un color, ni un margen,
 * ni el nombre de una fuente, ni Playwright, ni una ruta de plantilla. El algoritmo entrega
 * datos estructurados y termina. Esa es toda la tesis del §51.
 *
 * Depende de `PdfGeneratorPort`, no de una clase concreta: el día que el generador se saque a
 * su propio despliegue, el módulo anfitrión registra `HttpPdfGeneratorAdapter` en lugar de
 * `LocalPdfGeneratorAdapter` y este archivo no cambia.
 */
import { Inject, Injectable } from '@nestjs/common';
import { PDF_GENERATOR_PORT, type PdfGeneratorPort } from '../sdk/pdf-generator.port';
import type { GenericResultReportPayload } from '../templates/documents/generic-result-report/1.0.0/schema';

/** Lo que produce un algoritmo cualquiera. No tiene nada que ver con documentos. */
export interface AnalysisOutcome {
  readonly subjectName: string;
  readonly score: number;
  readonly decision: 'APPROVED' | 'REJECTED' | 'REVIEW';
  readonly rules: ReadonlyArray<{
    readonly code: string;
    readonly threshold: number;
    readonly observed: number;
    readonly passed: boolean;
  }>;
  readonly correlationId: string;
}

@Injectable()
export class AnalysisReportPublisher {
  constructor(@Inject(PDF_GENERATOR_PORT) private readonly pdf: PdfGeneratorPort) {}

  /**
   * Publica el resultado como documento y devuelve la ficha.
   *
   * `idempotencyKey` deriva del hecho de negocio —el identificador de correlación de la
   * ejecución—, no de un aleatorio: es lo que hace que un reintento del algoritmo no emita un
   * segundo informe del mismo análisis (§31).
   */
  async publish(outcome: AnalysisOutcome): Promise<{ documentId: string; pdf: Buffer }> {
    const payload: GenericResultReportPayload = {
      title: 'Resultado del análisis',
      subtitle: outcome.subjectName,
      summary: [
        { label: 'Puntaje', value: outcome.score, caption: 'sobre 1000' },
        { label: 'Decisión', value: outcome.decision },
      ],
      sections: [
        {
          title: 'Reglas evaluadas',
          description: 'Umbral configurado frente al valor observado en esta ejecución.',
          table: {
            columns: [
              { key: 'code', label: 'Regla' },
              { key: 'threshold', label: 'Umbral' },
              { key: 'observed', label: 'Observado' },
              { key: 'passed', label: 'Cumple' },
            ],
            // Las filas son valores planos. El contrato del template lo exige, y por eso el
            // informe nunca puede acabar imprimiendo «[object Object]» en una celda.
            rows: outcome.rules.map((rule) => ({ ...rule })),
          },
        },
      ],
    };

    const result = await this.pdf.generate({
      templateId: 'generic-result-report',
      // Se fija la versión A PROPÓSITO. Sin ella el generador serviría la última publicada, y
      // el día que salga una 2.0.0 con otro contrato este algoritmo empezaría a recibir 422 en
      // producción sin haber cambiado una línea.
      templateVersion: '1.0.0',
      payload,
      metadata: {
        correlationId: outcome.correlationId,
        requestedBy: 'analysis-engine',
        idempotencyKey: `analysis:${outcome.correlationId}`,
      },
      options: { filename: `analisis-${outcome.subjectName}`, persist: true },
    });

    return { documentId: result.documentId, pdf: result.content ?? Buffer.alloc(0) };
  }

  /**
   * Descubre qué exige el template sin tenerlo escrito en ningún sitio (§19).
   *
   * Es lo que permite que un artefacto compruebe su payload en SU batería de pruebas y se
   * entere de un cambio de contrato al compilar, no al recibir el primer 422.
   */
  async assertPayloadStillFits(payload: unknown): Promise<void> {
    const verdict = await this.pdf.validate('generic-result-report', payload, '1.0.0');
    if (!verdict.valid) {
      throw new Error(
        `El payload dejó de cumplir el contrato: ${verdict.issues
          .map((issue) => `${issue.field} (${issue.problem})`)
          .join('; ')}`,
      );
    }
  }
}
