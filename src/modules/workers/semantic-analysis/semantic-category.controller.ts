import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, TenantId } from '../../../common/security/security.decorators';
import { ImportSemanticCategoriesDto, UpsertSemanticCategoryDto } from './semantic-category.dto';
import {
  SemanticCategoryDto,
  SemanticCategoryImportSummaryDto,
} from './semantic-category.response.dto';
import { SemanticCategoryService } from './semantic-category.service';
import { UnresolvedReevaluationService } from './unresolved-reevaluation.service';

/**
 * Administración del catálogo contra el que clasifica el worker semántico.
 *
 * **Escribir aquí cambia cómo decide el motor**, así que exige rol de analista
 * de riesgo o de fraude —los mismos que gobiernan los artefactos de decisión— y
 * no el rol de operación, que puede ejecutar el worker pero no redefinir lo que
 * el worker significa. Leer sí lo puede hacer QA, que necesita ver el catálogo
 * para escribir pruebas contra él.
 */
@ApiTags('Workers · Categorías semánticas')
@Controller('v1/workers/semantic-analysis/categories')
export class SemanticCategoryController {
  constructor(
    private readonly categories: SemanticCategoryService,
    private readonly reevaluation: UnresolvedReevaluationService,
  ) {}

  /*
   * Todo lo que escribe en el catálogo dispara además una revisión de la bandeja
   * de pendientes, en segundo plano. Es lo que evita el estado en el que la
   * bandeja pide a mano términos que el motor ya sabe clasificar: quien añade la
   * categoría que faltaba no tiene por qué acordarse de volver a limpiar.
   */

  @Get()
  @ApiOperation({ summary: 'Árbol de categorías del tenant' })
  @ApiOkResponse({ description: 'Categorías ordenadas por código.', type: [SemanticCategoryDto] })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  list(@TenantId() tenantId: bigint) {
    return this.categories.list(tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Crea o reemplaza una categoría' })
  @ApiOkResponse({ description: 'Categoría escrita.', type: SemanticCategoryDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  create(@TenantId() tenantId: bigint, @Body() dto: UpsertSemanticCategoryDto) {
    return this.conRevision(tenantId, this.categories.upsert(tenantId, dto));
  }

  /**
   * El código va en la ruta y manda sobre el del cuerpo: si no, se podría enviar
   * uno distinto y reescribir una categoría ajena a la que se está editando.
   */
  @Put(':code')
  @ApiOperation({ summary: 'Actualiza una categoría' })
  @ApiOkResponse({ description: 'Categoría actualizada.', type: SemanticCategoryDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  update(
    @TenantId() tenantId: bigint,
    @Param('code') code: string,
    @Body() dto: UpsertSemanticCategoryDto,
  ) {
    return this.conRevision(tenantId, this.categories.upsert(tenantId, { ...dto, code }));
  }

  @Delete(':code')
  @ApiOperation({ summary: 'Desactiva una categoría (no se borra: las trazas la citan)' })
  @ApiOkResponse({ description: 'Categoría desactivada.', type: SemanticCategoryDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  deactivate(@TenantId() tenantId: bigint, @Param('code') code: string) {
    return this.conRevision(tenantId, this.categories.deactivate(tenantId, code));
  }

  @Post('import')
  @ApiOperation({ summary: 'Inyecta un subárbol completo desde JSON' })
  @ApiOkResponse({
    description: 'Resumen de lo creado y lo actualizado.',
    type: SemanticCategoryImportSummaryDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  import(@TenantId() tenantId: bigint, @Body() dto: ImportSemanticCategoriesDto) {
    return this.conRevision(tenantId, this.categories.importTree(tenantId, dto));
  }

  /** Devuelve lo que el servicio respondió y deja la revisión corriendo detrás. */
  private async conRevision<T>(tenantId: bigint, trabajo: Promise<T>): Promise<T> {
    const resultado = await trabajo;
    this.reevaluation.scheduleAfterCatalogChange(tenantId);
    return resultado;
  }
}
