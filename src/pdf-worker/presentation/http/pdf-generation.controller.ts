/**
 * Frontera HTTP de la generación (§18).
 *
 * El controlador no contiene lógica de negocio: valida el sobre, llama al caso de uso y decide
 * cómo se serializa la respuesta. Nada más. Si aquí apareciera un `if` sobre el tipo de
 * documento, ese `if` pertenece a un template.
 *
 * **La misma llamada devuelve dos cosas según `Accept`**, y no es un capricho: un servicio que
 * archiva metadatos quiere JSON y no el búfer; un navegador que descarga quiere el archivo y no
 * un JSON con dos megas en base64. Codificar siempre en base64 infla un 33 % cada respuesta
 * para el caso que menos lo necesita.
 */
import { Body, Controller, Header, HttpCode, Headers, Post, Res, UseFilters } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { GeneratePdfUseCase } from '../../application/use-cases/generate-pdf/generate-pdf.use-case';
import { PreviewTemplateUseCase } from '../../application/use-cases/preview-template/preview-template.use-case';
import { PDF_MIME_TYPE } from '../../domain/enums/document.enums';
import { assertOnlyOverridable } from '../../application/services/config-precedence';
import type { GeneratePdfResult } from '../../application/dto/generate-pdf.result';
import { PdfQueueGateway } from '../workers/pdf-queue.gateway';
import { Roles } from '../../../common/security/security.decorators';
import { PdfWorkerExceptionFilter } from './pdf-worker-exception.filter';
import {
  GeneratePdfRequestSchema,
  PreviewRequestSchema,
  openApiSchemaOf,
  type GeneratePdfRequest,
  type PreviewRequest,
} from './pdf-request.schemas';
import {
  GeneratedDocumentResponseSchema,
  QueuedGenerationResponseSchema,
  jsonBody,
  pdfBody,
} from './pdf-response.schemas';
import { ZodBodyPipe } from './zod-validation.pipe';

@ApiTags('pdf')
@Controller('pdf')
/**
 * Política de acceso de las rutas del generador.
 *
 * Sin `@Roles` el guardia global del motor cae en su modo por omisión y exige
 * una clave de API, así que el portal —que viaja con la sesión de una persona—
 * recibía un rechazo y la pantalla se quedaba SIN plantillas. No fallaba
 * ruidosamente: fallaba con una lista vacía, que se lee como «este despliegue no
 * publica documentos».
 *
 * Los roles son los mismos que abren la pestaña en el portal, y por el mismo
 * motivo que allí: ver el catálogo y generar un documento es leer y producir
 * papel con datos que esos perfiles ya pueden consultar. Administrar plantillas
 * es otra cosa y va aparte.
 */
@Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
@UseFilters(PdfWorkerExceptionFilter)
export class PdfGenerationController {
  constructor(
    private readonly generate: GeneratePdfUseCase,
    private readonly preview: PreviewTemplateUseCase,
    private readonly queue: PdfQueueGateway,
  ) {}

  @Post('generate')
  @ApiOperation({
    summary: 'Genera un documento PDF a partir de un template y su payload',
    description:
      'Con `Accept: application/pdf` responde el archivo; con cualquier otro valor, la ficha ' +
      'del documento en JSON. `metadata.idempotencyKey` hace la operación repetible.',
  })
  @ApiBody({ schema: openApiSchemaOf(GeneratePdfRequestSchema) })
  @ApiProduces('application/json', 'application/pdf')
  // Las DOS formas en la misma respuesta, porque la negociación por `Accept` es parte del
  // contrato: publicar sólo el JSON dejaría al cliente que descarga sin saber qué recibe.
  @ApiResponse({
    status: 200,
    description:
      'Documento generado: la ficha en JSON, o el archivo si se pidió `application/pdf`.',
    content: { ...jsonBody(GeneratedDocumentResponseSchema), ...pdfBody },
  })
  @ApiResponse({ status: 404, description: 'El template o la versión no existen.' })
  @ApiResponse({ status: 409, description: 'Otra generación con la misma clave está en curso.' })
  @ApiResponse({ status: 422, description: 'El payload no cumple el contrato del template.' })
  @ApiResponse({ status: 429, description: 'Sin carriles de renderizado disponibles.' })
  async generatePdf(
    @Body(new ZodBodyPipe(GeneratePdfRequestSchema)) request: GeneratePdfRequest,
    @Headers('accept') accept: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    // Se comprueba sobre el cuerpo ORIGINAL: el pipe ya rechazó las claves desconocidas, pero
    // esta llamada es la que produce el mensaje que nombra la opción protegida concreta.
    assertOnlyOverridable(request.options);
    const wantsBinary = (accept ?? '').includes(PDF_MIME_TYPE);

    const result = await this.generate.execute({
      templateId: request.templateId,
      templateVersion: request.templateVersion,
      payload: request.payload,
      brandId: request.brandId,
      metadata: request.metadata,
      options: { ...request.options, returnContent: wantsBinary },
    });

    if (wantsBinary && result.content) {
      sendPdf(response, result);
      return;
    }
    response.status(200).json(withoutContent(result));
  }

  @Post('generate/async')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Encola la generación y responde de inmediato',
    description:
      'Devuelve 202 con el identificador del trabajo. El documento se persiste y el desenlace ' +
      'se publica como PDF_GENERATED o PDF_GENERATION_FAILED. Requiere PDF_QUEUE_ENABLED=true.',
  })
  @ApiBody({ schema: openApiSchemaOf(GeneratePdfRequestSchema) })
  @ApiResponse({
    status: 202,
    description: 'Trabajo aceptado y encolado.',
    content: jsonBody(QueuedGenerationResponseSchema),
  })
  @ApiResponse({ status: 503, description: 'El procesamiento asíncrono está desactivado.' })
  async generateAsync(
    @Body(new ZodBodyPipe(GeneratePdfRequestSchema)) request: GeneratePdfRequest,
  ): Promise<{ jobId: string; queuedAhead: number; status: 'QUEUED' }> {
    assertOnlyOverridable(request.options);
    const enqueued = await this.queue.enqueue({
      templateId: request.templateId,
      templateVersion: request.templateVersion,
      payload: request.payload,
      brandId: request.brandId,
      metadata: request.metadata,
      options: { ...request.options, persist: true, returnContent: false },
    });
    return { ...enqueued, status: 'QUEUED' };
  }

  @Post('preview')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Previsualiza un template con sus datos ficticios',
    description:
      'Sin `payload` usa el fixture declarado por el template. Nunca persiste. Responde siempre ' +
      'el archivo, porque es lo único que sirve para mirar un diseño.',
  })
  @ApiBody({ schema: openApiSchemaOf(PreviewRequestSchema) })
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'El archivo previsualizado.', content: pdfBody })
  async previewTemplate(
    @Body(new ZodBodyPipe(PreviewRequestSchema)) request: PreviewRequest,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.preview.execute(request);
    if (!result.content) {
      response.status(500).json({ title: 'PREVIEW_WITHOUT_CONTENT', status: 500 });
      return;
    }
    sendPdf(response, result, 'inline');
  }
}

function sendPdf(
  response: Response,
  result: GeneratePdfResult,
  disposition: 'inline' | 'attachment' = 'attachment',
): void {
  response.setHeader('content-type', PDF_MIME_TYPE);
  response.setHeader('content-length', String(result.sizeBytes));
  // `filename*` en UTF-8 además del `filename` simple: sin la forma extendida, un nombre con
  // tilde o eñe llega troceado a los clientes que sólo entienden latin-1.
  response.setHeader(
    'content-disposition',
    `${disposition}; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
  );
  // Cabeceras de trazabilidad: permiten conciliar el archivo descargado con el registro sin
  // tener que abrirlo ni pedir la ficha por separado.
  response.setHeader('x-document-id', result.documentId);
  response.setHeader('x-document-checksum', result.checksum);
  response.setHeader('x-template', `${result.template.id}@${result.template.version}`);
  response.status(200).end(result.content);
}

function withoutContent(result: GeneratePdfResult): Omit<GeneratePdfResult, 'content'> {
  const { content: _content, ...rest } = result;
  return rest;
}
