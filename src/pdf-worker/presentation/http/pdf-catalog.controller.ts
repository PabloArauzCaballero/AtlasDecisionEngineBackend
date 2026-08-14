/**
 * Descubrimiento del catálogo y salud (§18, §19, §35).
 *
 * `GET /pdf/templates/:id/schema` es el endpoint que convierte esto en una plataforma: otro
 * artefacto pregunta qué datos necesita un documento y recibe una respuesta que puede leer un
 * humano (`fields`) y una que puede consumir una máquina (`jsonSchema`), más un ejemplo válido.
 * Sin él, el contrato se transmite copiándolo de una conversación y se descubre que cambió
 * cuando el PDF sale con huecos.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseFilters } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { TemplateSummary } from '../../domain/contracts/template-contract';
import type {
  TemplateDefinitionResult,
  TemplateSchemaResult,
  ValidatePayloadResult,
} from '../../application/dto/generate-pdf.result';
import { ArtifactBindingUseCase } from '../../application/use-cases/artifact-binding/artifact-binding.use-case';
import { GetTemplateDefinitionUseCase } from '../../application/use-cases/get-template-definition/get-template-definition.use-case';
import { ValidatePayloadUseCase } from '../../application/use-cases/validate-template/validate-payload.use-case';
import { PdfHealthService, type PdfHealthReport } from '../health/pdf-health.service';
import { Roles } from '../../../common/security/security.decorators';
import { PdfWorkerExceptionFilter } from './pdf-worker-exception.filter';
import {
  ValidatePayloadRequestSchema,
  openApiSchemaOf,
  type ValidatePayloadRequest,
} from './pdf-request.schemas';
import {
  TemplateListResponseSchema,
  TemplateVersionsResponseSchema,
  jsonBody,
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
export class PdfCatalogController {
  constructor(
    private readonly templates: GetTemplateDefinitionUseCase,
    private readonly validate: ValidatePayloadUseCase,
    private readonly health: PdfHealthService,
    private readonly artifacts: ArtifactBindingUseCase,
  ) {}

  @Get('templates')
  @ApiOperation({ summary: 'Lista los templates publicados, en su última versión' })
  @ApiQuery({ name: 'tag', required: false, description: 'Filtra por etiqueta de descubrimiento' })
  @ApiResponse({
    status: 200,
    description: 'Templates publicados, cada uno en su última versión.',
    content: jsonBody(TemplateListResponseSchema),
  })
  listTemplates(@Query('tag') tag?: string): { templates: readonly TemplateSummary[] } {
    return { templates: this.templates.list(tag) };
  }

  @Get('templates/:templateId')
  @ApiOperation({ summary: 'Definición completa de un template' })
  @ApiParam({ name: 'templateId', example: 'generic-result-report' })
  @ApiQuery({ name: 'version', required: false, example: '1.0.0' })
  @ApiResponse({ status: 404, description: 'El template no existe.' })
  definition(
    @Param('templateId') templateId: string,
    @Query('version') version?: string,
  ): TemplateDefinitionResult {
    return this.templates.definition(templateId, version);
  }

  @Get('templates/:templateId/schema')
  @ApiOperation({
    summary: 'Contrato de datos que exige el template',
    description:
      'Devuelve `fields` (legible), `jsonSchema` (JSON Schema completo, para validar en el ' +
      'lado del consumidor) y `example` (el mismo fixture que usa la vista previa).',
  })
  @ApiParam({ name: 'templateId', example: 'credit-analysis-report' })
  @ApiQuery({ name: 'version', required: false })
  schema(
    @Param('templateId') templateId: string,
    @Query('version') version?: string,
  ): TemplateSchemaResult {
    return this.templates.schema(templateId, version);
  }

  @Get('templates/:templateId/versions')
  @ApiOperation({ summary: 'Versiones publicadas, en orden semántico ascendente' })
  @ApiParam({ name: 'templateId', example: 'credit-analysis-report' })
  @ApiResponse({
    status: 200,
    description: 'Versiones publicadas del template.',
    content: jsonBody(TemplateVersionsResponseSchema),
  })
  versions(@Param('templateId') templateId: string): {
    templateId: string;
    versions: readonly string[];
  } {
    return { templateId, versions: this.templates.versions(templateId) };
  }

  @Post('templates/:templateId/validate')
  // Nest responde 201 a todo POST. Aquí no se crea nada: es una consulta que usa POST porque
  // el payload va en el cuerpo, y un 201 haría creer a un cliente que dejó algo escrito.
  @HttpCode(200)
  @ApiOperation({
    summary: 'Comprueba un payload sin generar nada',
    description:
      'Responde 200 con `valid: false` y el detalle cuando el payload no cumple: aquí «inválido» ' +
      'es la respuesta a la pregunta, no un fallo de la llamada.',
  })
  @ApiBody({ schema: openApiSchemaOf(ValidatePayloadRequestSchema) })
  validatePayload(
    @Param('templateId') templateId: string,
    @Body(new ZodBodyPipe(ValidatePayloadRequestSchema)) request: ValidatePayloadRequest,
  ): ValidatePayloadResult {
    return this.validate.execute({
      templateId,
      templateVersion: request.templateVersion,
      payload: request.payload,
    });
  }

  // ── Casar documento con artefacto, a nivel de datos ────────────────────────

  @Get('artifacts')
  @ApiOperation({
    summary: 'Artefactos publicados que pueden alimentar un documento',
    description:
      'Sólo los que declaran contrato de salida: sin él no hay nada con lo que casar. ' +
      'Responde 503 si este despliegue no puede consultarlos (generador suelto).',
  })
  async artifactsForBinding() {
    return { artifacts: await this.artifacts.listArtifacts() };
  }

  @Get('templates/:templateId/compatibility')
  @ApiOperation({
    summary: '¿Lo que responde este artefacto lo acepta este documento?',
    description:
      'Compara campo a campo el contrato de salida del artefacto con el contrato de datos del ' +
      'documento. Un campo obligatorio que el artefacto no publica es un error; uno del ' +
      'artefacto que el documento no usa NO lo es —un artefacto alimenta varios documentos y ' +
      'cada uno cuenta una parte—.',
  })
  @ApiParam({ name: 'templateId', example: 'credit-analysis-report' })
  @ApiQuery({ name: 'artifact', required: true, description: 'Código del artefacto' })
  @ApiQuery({ name: 'artifactVersion', required: false })
  @ApiQuery({ name: 'version', required: false, description: 'Versión del template' })
  async compatibility(
    @Param('templateId') templateId: string,
    @Query('artifact') artifact: string,
    @Query('version') version?: string,
    @Query('artifactVersion') artifactVersion?: string,
  ) {
    return this.artifacts.compatibility(templateId, artifact, version, artifactVersion);
  }

  @Get('templates/:templateId/sample')
  @ApiOperation({
    summary: 'Dato de prueba construido con la salida REAL de un artefacto',
    description:
      'Sustituye al ejemplo escrito a mano: un fixture inventado demuestra que la plantilla ' +
      'maqueta, no que sirva para el artefacto que la va a usar. Los campos que el artefacto no ' +
      'puede rellenar se listan en «missing» en vez de rellenarse con un valor plausible.',
  })
  @ApiParam({ name: 'templateId', example: 'credit-analysis-report' })
  @ApiQuery({ name: 'artifact', required: true })
  @ApiQuery({ name: 'artifactVersion', required: false })
  @ApiQuery({ name: 'version', required: false })
  async sampleFromArtifact(
    @Param('templateId') templateId: string,
    @Query('artifact') artifact: string,
    @Query('version') version?: string,
    @Query('artifactVersion') artifactVersion?: string,
  ) {
    return this.artifacts.sampleFrom(templateId, artifact, version, artifactVersion);
  }

  @Get('health')
  @ApiOperation({
    summary: 'Sonda del generador documental',
    description:
      'Comprueba el motor de impresión, el catálogo de templates, los recursos, las fuentes y ' +
      'el almacenamiento. Responde 200 siempre: el veredicto está en `status`, y un 503 aquí ' +
      'escondería el cuerpo que se viene a leer.',
  })
  async healthReport(): Promise<PdfHealthReport> {
    return this.health.report();
  }
}
