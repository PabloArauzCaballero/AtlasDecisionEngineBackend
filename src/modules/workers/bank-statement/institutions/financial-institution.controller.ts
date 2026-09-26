import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DomainException } from '../../../../common/errors/domain-exception';
import { CurrentPrincipal, Roles, TenantId } from '../../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import {
  UploadInstitutionLogoDto,
  UpsertFinancialInstitutionDto,
} from './financial-institution.dto';
import {
  FinancialInstitutionDto,
  FinancialInstitutionSeedSummaryDto,
  FinancialInstitutionSummaryDto,
  InstitutionLogoSyncDto,
} from './financial-institution.response.dto';
import { FinancialInstitutionService } from './financial-institution.service';

/**
 * El padrón de entidades financieras bolivianas del worker de extractos.
 *
 * **Escribir aquí cambia qué documentos acepta el motor**, así que exige los
 * mismos roles que gobiernan los artefactos de decisión y no el de operación,
 * que puede ejecutar el worker pero no redefinir contra qué entidades reconoce.
 * Leer sí lo puede hacer quien opera: la pantalla de extractos necesita el
 * padrón para explicar por qué se rechazó un documento.
 */
@ApiTags('Workers · Entidades financieras')
@Controller('v1/workers/bank-statement/institutions')
export class FinancialInstitutionController {
  constructor(private readonly institutions: FinancialInstitutionService) {}

  @Get()
  @ApiOperation({ summary: 'Padrón de entidades financieras del tenant' })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    description:
      'Incluye las dadas de baja. Se pide de forma expresa porque una entidad inactiva ya no reconoce documentos y verla mezclada con las vigentes induce a creer que sí.',
  })
  @ApiOkResponse({
    description: 'Entidades ordenadas por tipo y código.',
    type: [FinancialInstitutionDto],
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  list(@TenantId() tenantId: bigint, @Query('includeInactive') includeInactive?: string) {
    return this.institutions.list(tenantId, includeInactive === 'true');
  }

  @Get('summary')
  @ApiOperation({ summary: 'Estado del padrón y entidades que faltan respecto de la nómina ASFI' })
  @ApiOkResponse({
    description: 'Recuento por tipo y faltantes.',
    type: FinancialInstitutionSummaryDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  summary(@TenantId() tenantId: bigint) {
    return this.institutions.summary(tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Da de alta una entidad en el padrón' })
  @ApiOkResponse({ description: 'Entidad escrita.', type: FinancialInstitutionDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: UpsertFinancialInstitutionDto,
  ) {
    return this.institutions.upsert(tenantId, dto, principal.id);
  }

  /**
   * El código va en la ruta y manda sobre el del cuerpo: si no, se podría enviar
   * uno distinto y reescribir la entidad equivocada desde el formulario de otra.
   */
  @Put(':code')
  @ApiOperation({ summary: 'Actualiza una entidad del padrón' })
  @ApiOkResponse({ description: 'Entidad actualizada.', type: FinancialInstitutionDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  update(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('code') code: string,
    @Body() dto: UpsertFinancialInstitutionDto,
  ) {
    return this.institutions.upsert(tenantId, { ...dto, code }, principal.id);
  }

  @Delete(':code')
  @ApiOperation({ summary: 'Da de baja una entidad (no se borra: las trazas la citan)' })
  @ApiOkResponse({ description: 'Entidad desactivada.', type: FinancialInstitutionDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  deactivate(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('code') code: string,
  ) {
    return this.institutions.deactivate(tenantId, code, principal.id);
  }

  @Post(':code/reactivate')
  @ApiOperation({ summary: 'Vuelve a poner en servicio una entidad dada de baja' })
  @ApiOkResponse({ description: 'Entidad reactivada.', type: FinancialInstitutionDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  reactivate(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('code') code: string,
  ) {
    return this.institutions.reactivate(tenantId, code, principal.id);
  }

  // -------------------------------------------------------------- logotipos

  /**
   * El logotipo de una entidad, como imagen.
   *
   * Va por su propia ruta y no dentro del listado: sesenta y ocho imágenes en
   * base64 serían varios megabytes de JSON para pintar una tabla, y así el
   * navegador puede cachear cada una por separado.
   *
   * Lo puede leer quien opera. Es la misma audiencia que el listado del padrón —
   * la pantalla que explica por qué se rechazó un documento enseña de qué
   * entidad hablaba— y una imagen sin datos personales dentro.
   */
  @Get(':code/logo')
  @ApiOperation({ summary: 'Logotipo de una entidad' })
  @ApiProduces('image/svg+xml', 'image/png', 'image/jpeg')
  /*
   * El cuerpo se declara aunque la respuesta se escriba con `@Res()`.
   *
   * `@ApiProduces` sólo dice en qué formatos puede venir; sin `@ApiOkResponse` la operación se
   * publica con una respuesta 200 SIN contenido, y un cliente generado desde el contrato cree que
   * este endpoint no devuelve nada. Lo destapó `docs:openapi:check` al regenerar el artefacto: la
   * regla es fallo duro y llevaba tiempo incumplida sin que se viera, porque `openapi/openapi.json`
   * estaba desactualizado y esta operación ni siquiera figuraba.
   */
  @ApiOkResponse({
    description: 'El logotipo. El tipo real viaja en `Content-Type`.',
    content: {
      'image/svg+xml': { schema: { type: 'string', format: 'binary' } },
      'image/png': { schema: { type: 'string', format: 'binary' } },
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  async logo(
    @TenantId() tenantId: bigint,
    @Param('code') code: string,
    @Res() response: Response,
  ): Promise<void> {
    const logo = await this.institutions.logo(tenantId, code);
    if (!logo) {
      throw new DomainException(
        'INSTITUTION_LOGO_NOT_FOUND',
        `La entidad ${code} no tiene logotipo cargado.`,
        HttpStatus.NOT_FOUND,
        { code },
      );
    }
    /*
     * `nosniff` y `Content-Disposition: inline` con nombre propio: el logotipo lo
     * pudo cargar una persona, se sirve desde el mismo origen que el portal, y
     * sin la cabecera un navegador que decida por su cuenta que el archivo es
     * HTML lo ejecutaría con la sesión de quien administra el padrón. El SVG ya
     * se comprueba al escribirlo; esto es la segunda cerradura.
     */
    response.setHeader('Content-Type', logo.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', `inline; filename="${code}"`);
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.status(HttpStatus.OK).send(logo.data);
  }

  @Put(':code/logo')
  @ApiOperation({ summary: 'Carga el logotipo de una entidad' })
  @ApiOkResponse({ description: 'Entidad con su logotipo.', type: FinancialInstitutionDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  setLogo(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('code') code: string,
    @Body() dto: UploadInstitutionLogoDto,
  ) {
    return this.institutions.setLogo(tenantId, code, dto, principal.id);
  }

  @Delete(':code/logo')
  @ApiOperation({ summary: 'Quita el logotipo de una entidad' })
  @ApiOkResponse({ description: 'Entidad sin logotipo.', type: FinancialInstitutionDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  removeLogo(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('code') code: string,
  ) {
    return this.institutions.removeLogo(tenantId, code, principal.id);
  }

  @Post('logos/sync')
  @ApiOperation({
    summary:
      'Carga los logotipos que trae el motor y reemplaza los monogramas por la marca oficial',
    description:
      'Escribe donde no hay logotipo, y donde hay un monograma que la semilla ya puede sustituir por el logotipo oficial. Nunca pisa uno cargado a mano. Con dryRun responde qué haría sin escribir.',
  })
  @ApiOkResponse({ description: 'Resumen de la carga.', type: InstitutionLogoSyncDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  syncLogos(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: { dryRun?: boolean },
  ) {
    return this.institutions.syncLogos(tenantId, body?.dryRun === true, principal.id);
  }

  @Post('seed')
  @ApiOperation({
    summary: 'Inyecta las entidades de la nómina ASFI que falten en el padrón',
    description:
      'Sólo crea lo que falta; nunca pisa una entidad existente. Con dryRun responde qué haría sin escribir.',
  })
  @ApiOkResponse({
    description: 'Resumen de lo sembrado.',
    type: FinancialInstitutionSeedSummaryDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  seed(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: { dryRun?: boolean },
  ) {
    return this.institutions.syncSeed(tenantId, body?.dryRun === true, principal.id);
  }
}
