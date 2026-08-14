/**
 * Administración de templates: el «CRUD» y el formato que el backend acepta.
 *
 * Las dos rutas de `format/` son PÚBLICAS a propósito y el resto va detrás del guardia. Saber
 * qué formato se admite no es un secreto —está en esta documentación y en el código— y
 * obligar a autenticarse para leerlo sólo consigue que la gente lo copie de otro sitio y lo
 * copie mal. Publicar plantillas sí necesita permiso.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { StoredTemplate, TemplateBundle } from '../../domain/contracts/template-bundle';
import { errorCatalogEntries, type ErrorCatalogEntry } from '../../domain/errors/error-catalog';
import {
  ManageTemplatesUseCase,
  type TemplateInventoryEntry,
} from '../../application/use-cases/manage-templates/manage-templates.use-case';
import {
  TEMPLATE_BUNDLE_COMPILER_PORT,
  type TemplateBundleCompilerPort,
} from '../../application/ports/template-bundle-compiler.port';
import {
  ErrorCatalogResponseSchema,
  jsonBody,
  StoredTemplateResponseSchema,
  TemplateBundleResponseSchema,
  TemplateFormatSchemaResponseSchema,
  TemplateInventoryResponseSchema,
} from './pdf-response.schemas';
import { Inject } from '@nestjs/common';
import { Roles } from '../../../common/security/security.decorators';
import { PdfWorkerExceptionFilter } from './pdf-worker-exception.filter';
import { TemplateAdminGuard } from './template-admin.guard';

@ApiTags('pdf-templates')
@Controller('pdf')
// Leer el formato y el catálogo de errores lo puede hacer cualquiera de la
// pestaña; publicar plantillas exige ADEMÁS la clave de administración, que
// comprueba `TemplateAdminGuard` en cada ruta protegida.
@Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
@UseFilters(PdfWorkerExceptionFilter)
export class PdfTemplateAdminController {
  constructor(
    private readonly templates: ManageTemplatesUseCase,
    @Inject(TEMPLATE_BUNDLE_COMPILER_PORT) private readonly compiler: TemplateBundleCompilerPort,
  ) {}

  // ── Formato admitido (público) ─────────────────────────────────────────────

  @Get('template-format/example')
  @ApiOperation({
    summary: 'Descarga un paquete de template de EJEMPLO, completo y funcional',
    description:
      'Se puede subir tal cual: se publica y genera un PDF. Ejercita todo el vocabulario —cada ' +
      'tipo de campo, enum, lista de objetos, límites— y usa los parciales compartidos, así que ' +
      'sirve de plantilla de partida. Cambie el identificador y ajuste los campos.',
  })
  @Header('content-type', 'application/json; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="template-de-ejemplo.json"')
  @ApiResponse({
    status: 200,
    description: 'Paquete de ejemplo, completo y listo para publicar tal cual.',
    content: jsonBody(TemplateBundleResponseSchema),
  })
  exampleBundle(@Res() response: Response): void {
    // Se sirve con `content-disposition` para que el navegador lo DESCARGUE en vez de pintarlo:
    // el uso previsto es guardarlo, editarlo y volver a subirlo.
    response.status(200).send(JSON.stringify(this.compiler.example(), null, 2));
  }

  @Get('template-format/schema')
  @ApiOperation({
    summary: 'JSON Schema del paquete que el backend acepta',
    description:
      'El contrato del FORMATO, no el de un template concreto. Permite validar un paquete en ' +
      'el lado del cliente antes de intentar publicarlo.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contrato del FORMATO de paquete, no el de un template concreto.',
    content: jsonBody(TemplateFormatSchemaResponseSchema),
  })
  formatSchema(): { format: string; jsonSchema: unknown } {
    return { format: 'atlas-pdf-template-bundle/1', jsonSchema: this.compiler.jsonSchema() };
  }

  @Get('errors')
  @ApiOperation({
    summary: 'Catálogo completo de errores del generador documental',
    description:
      'Todos los códigos que este worker puede devolver, con su estado HTTP, qué significan, ' +
      'por qué ocurren, cómo se resuelven, si reintentar sirve de algo y quién puede ' +
      'arreglarlos. Una prueba impide que este catálogo y el código se desincronicen.',
  })
  @ApiResponse({
    status: 200,
    description: 'Todos los códigos que este worker puede devolver, explicados.',
    content: jsonBody(ErrorCatalogResponseSchema),
  })
  errorCatalog(): { errors: readonly ErrorCatalogEntry[] } {
    return { errors: errorCatalogEntries() };
  }

  // ── CRUD (protegido) ───────────────────────────────────────────────────────

  @Get('admin/templates')
  @UseGuards(TemplateAdminGuard)
  @ApiOperation({
    summary: 'Inventario completo, con origen y estado de cada versión',
    description:
      '`origin` distingue los templates incorporados (viajan con el código) de los publicados ' +
      'por la API. Sólo estos últimos se pueden modificar o retirar.',
  })
  @ApiResponse({
    status: 200,
    description: 'Inventario completo, con el origen y el estado de cada versión.',
    content: jsonBody(TemplateInventoryResponseSchema),
  })
  @ApiResponse({ status: 401, description: 'Credencial de administración ausente o inválida.' })
  @ApiResponse({ status: 404, description: 'La administración está desactivada.' })
  async inventory(): Promise<{ templates: readonly TemplateInventoryEntry[] }> {
    return { templates: await this.templates.inventory() };
  }

  @Post('admin/templates')
  @UseGuards(TemplateAdminGuard)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Publica un template nuevo',
    description:
      'Valida el paquete completo —formato, plantilla, estilos, contrato y datos de ejemplo—, ' +
      'lo compila y lo registra. Si la versión ya existe responde 409 sugiriendo la siguiente: ' +
      'las versiones publicadas son inmutables, porque un informe archivado declara con cuál ' +
      'salió. Actualizar un template es publicar otra versión.',
  })
  @ApiBody({ description: 'Paquete de template. Vea GET /pdf/template-format/example.' })
  @ApiResponse({
    status: 201,
    description: 'Template publicado y registrado.',
    content: jsonBody(StoredTemplateResponseSchema),
  })
  @ApiResponse({ status: 409, description: 'Esa versión ya está publicada.' })
  @ApiResponse({ status: 422, description: 'El paquete no cumple el formato.' })
  async publish(@Body() bundle: unknown, @Req() request: Request): Promise<StoredTemplate> {
    const createdBy = headerValue(request, 'x-requested-by');
    return this.templates.publish(bundle, createdBy);
  }

  @Get('admin/templates/:templateId/:version/source')
  @UseGuards(TemplateAdminGuard)
  @ApiOperation({
    summary: 'Descarga el paquete de un template publicado por la API',
    description:
      'Devuelve el JSON tal cual se subió: es el punto de partida para publicar la versión ' +
      'siguiente. Un template incorporado responde 403 — se edita en el repositorio.',
  })
  @ApiParam({ name: 'templateId', example: 'certificado-de-cuenta' })
  @ApiParam({ name: 'version', example: '1.0.0' })
  @ApiResponse({
    status: 200,
    description: 'El paquete tal cual se subió: punto de partida para la versión siguiente.',
    content: jsonBody(TemplateBundleResponseSchema),
  })
  async source(
    @Param('templateId') templateId: string,
    @Param('version') version: string,
    @Res() response: Response,
  ): Promise<void> {
    const bundle: TemplateBundle = await this.templates.source(templateId, version);
    response
      .status(200)
      .setHeader('content-type', 'application/json; charset=utf-8')
      .setHeader('content-disposition', `attachment; filename="${templateId}-${version}.json"`)
      .send(JSON.stringify(bundle, null, 2));
  }

  @Post('admin/templates/:templateId/:version/deprecate')
  @UseGuards(TemplateAdminGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Marca una versión como obsoleta',
    description:
      'Es la forma recomendada de «borrar»: deja de recomendarse pero SIGUE generando, así que ' +
      'lo ya emitido con ella se puede reproducir.',
  })
  @ApiResponse({
    status: 200,
    description: 'Versión marcada como obsoleta. Sigue generando: lo emitido se reproduce.',
    content: jsonBody(StoredTemplateResponseSchema),
  })
  async deprecate(
    @Param('templateId') templateId: string,
    @Param('version') version: string,
  ): Promise<StoredTemplate> {
    return this.templates.deprecate(templateId, version);
  }

  @Post('admin/templates/:templateId/:version/republish')
  @UseGuards(TemplateAdminGuard)
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async republish(
    @Param('templateId') templateId: string,
    @Param('version') version: string,
  ): Promise<StoredTemplate> {
    return this.templates.republish(templateId, version);
  }

  @Delete('admin/templates/:templateId/:version')
  @UseGuards(TemplateAdminGuard)
  @HttpCode(204)
  @ApiOperation({
    summary: 'Borra una versión publicada por la API',
    description:
      'Borrado REAL. Existe para deshacer una publicación equivocada. Si ya se emitieron ' +
      'documentos con esa versión, se pierde la capacidad de reproducirlos: use «deprecate».',
  })
  @ApiResponse({ status: 204, description: 'Versión retirada del catálogo y del almacén.' })
  @ApiResponse({ status: 403, description: 'Es un template incorporado.' })
  async remove(
    @Param('templateId') templateId: string,
    @Param('version') version: string,
  ): Promise<void> {
    await this.templates.remove(templateId, version);
  }
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' && single.length > 0 ? single.slice(0, 160) : undefined;
}
