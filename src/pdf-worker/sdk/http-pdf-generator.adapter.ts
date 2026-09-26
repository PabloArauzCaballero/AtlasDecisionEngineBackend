/**
 * Cliente HTTP: el worker corre como servicio aparte.
 *
 * Se entrega junto al cliente en proceso para que sacar el generador a su propio despliegue sea
 * cambiar UNA línea de composición y no reescribir a los consumidores. Los dos implementan
 * `PdfGeneratorPort`, así que un algoritmo no distingue el uno del otro.
 *
 * Pide el documento con `Accept: application/pdf` y reconstruye la ficha desde las cabeceras
 * de trazabilidad. La alternativa —dos llamadas, o base64 en el JSON— o dobla el trabajo o
 * infla la respuesta un 33 %.
 */
import type {
  GeneratePdfCommand,
  PreviewTemplateCommand,
} from '../application/dto/generate-pdf.command';
import type {
  GeneratePdfResult,
  TemplateSchemaResult,
  ValidatePayloadResult,
} from '../application/dto/generate-pdf.result';
import type { TemplateSummary } from '../domain/contracts/template-contract';
import { PdfRenderError } from '../domain/errors/pdf-worker.errors';
import type { PdfGeneratorPort } from './pdf-generator.port';

export interface HttpPdfGeneratorOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  /** Cabeceras fijas: clave de servicio, tenant, lo que exija el despliegue. */
  readonly headers?: Readonly<Record<string, string>>;
}

export class HttpPdfGeneratorAdapter implements PdfGeneratorPort {
  constructor(private readonly options: HttpPdfGeneratorOptions) {}

  async generate<TPayload>(command: GeneratePdfCommand<TPayload>): Promise<GeneratePdfResult> {
    const wantsContent = command.options?.returnContent !== false;
    const response = await this.send('POST', '/pdf/generate', command, {
      accept: wantsContent ? 'application/pdf' : 'application/json',
    });
    return wantsContent
      ? this.readDocument(response)
      : ((await response.json()) as GeneratePdfResult);
  }

  async preview(command: PreviewTemplateCommand): Promise<GeneratePdfResult> {
    return this.readDocument(
      await this.send('POST', '/pdf/preview', command, { accept: 'application/pdf' }),
    );
  }

  async listTemplates(tag?: string): Promise<readonly TemplateSummary[]> {
    const path = tag ? `/pdf/templates?tag=${encodeURIComponent(tag)}` : '/pdf/templates';
    const body = (await (await this.send('GET', path)).json()) as {
      templates: readonly TemplateSummary[];
    };
    return body.templates;
  }

  async describeTemplate(templateId: string, version?: string): Promise<TemplateSchemaResult> {
    const suffix = version ? `?version=${encodeURIComponent(version)}` : '';
    const path = `/pdf/templates/${encodeURIComponent(templateId)}/schema${suffix}`;
    return (await (await this.send('GET', path)).json()) as TemplateSchemaResult;
  }

  async validate(
    templateId: string,
    payload: unknown,
    version?: string,
  ): Promise<ValidatePayloadResult> {
    const path = `/pdf/templates/${encodeURIComponent(templateId)}/validate`;
    const response = await this.send('POST', path, { payload, templateVersion: version });
    return (await response.json()) as ValidatePayloadResult;
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/+$/, '')}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...this.options.headers,
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw await this.asError(response);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Conserva el error del worker en lugar de sustituirlo.
   *
   * Un 422 con el campo y la regla es exactamente lo que quien llama necesita; envolverlo en
   * un «fallo del generador documental» genérico obligaría a leer los registros del otro
   * servicio para saber que faltaba un campo.
   */
  private async asError(response: Response): Promise<Error> {
    const detail = await response.text().catch(() => '');
    try {
      const problem = JSON.parse(detail) as { title?: string; detail?: string; errors?: unknown };
      const error = new PdfRenderError(problem.detail ?? problem.title ?? 'error remoto', {
        status: response.status,
        code: problem.title,
        errors: problem.errors,
      });
      return error;
    } catch {
      return new PdfRenderError(`respuesta ${response.status} del generador documental`, {
        status: response.status,
        body: detail.slice(0, 500),
      });
    }
  }

  private async readDocument(response: Response): Promise<GeneratePdfResult> {
    const content = Buffer.from(await response.arrayBuffer());
    const template = (response.headers.get('x-template') ?? '@').split('@');
    return {
      documentId: response.headers.get('x-document-id') ?? 'unknown',
      template: { id: template[0], version: template[1] ?? '0.0.0' },
      filename: filenameFrom(response.headers.get('content-disposition')),
      mimeType: 'application/pdf',
      sizeBytes: content.byteLength,
      checksum: response.headers.get('x-document-checksum') ?? '',
      createdAt: new Date().toISOString(),
      status: 'GENERATED',
      brandId: 'remote',
      trace: { renderer: 'remote', renderDurationMs: 0 },
      content,
    };
  }
}

function filenameFrom(disposition: string | null): string {
  const match = /filename="([^"]+)"/.exec(disposition ?? '');
  return match ? match[1] : 'document.pdf';
}
