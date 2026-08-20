/**
 * Frontera de la consola de consultas SQL (ADR-0031).
 *
 * Cuatro rutas y ninguna que escriba datos de negocio. Las tres primeras son de lectura
 * pura; la cuarta devuelve la bitácora del propio solicitante.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { SqlConsoleQueryError } from './execution/query-executor.service';
import { QueryHistoryDto, RunQueryDto } from './sql-console.dto';
import {
  QueryHistoryPageDto,
  QueryResultDto,
  QueryValidationDto,
  SqlCatalogDto,
} from './sql-console.response.dto';
import { SqlConsoleService } from './sql-console.service';

@ApiTags('SQL Console')
@Controller('v1/sql-console')
/*
 * Quién entra, y por qué NO están los otros tres roles.
 *
 * La consola cruza libremente decisiones, desenlaces, cartera y auditoría. Eso es
 * exactamente el trabajo de quien analiza riesgo o fraude, de quien cumple normativa y de
 * quien audita, y por eso son los que entran.
 *
 * `OPERATIONS` queda fuera aunque sí ve /decision-quality: allí carga desenlaces sobre una
 * lista acotada, aquí podría cruzar la cartera entera con la auditoría. Es la misma
 * separación que se sostiene en `modelMonitoring` —quien alimenta la medida no es quien la
 * interpreta— y relajarla desde una consola libre la dejaría sin efecto.
 *
 * `QA_ANALYST` tampoco: diseña artefactos y los prueba contra datos sintéticos; ninguno de
 * los cinco datasets contiene datos de prueba, todos contienen decisiones sobre personas
 * reales. `PLATFORM_ADMIN` no aparece porque ya lo cubre el comodín global.
 */
@Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'RISK_APPROVER', 'COMPLIANCE', 'AUDITOR')
export class SqlConsoleController {
  constructor(private readonly console: SqlConsoleService) {}

  @Get('catalog')
  @ApiOperation({
    summary: 'List the governed datasets, tables and columns the console can query',
  })
  @ApiOkResponse({
    description:
      'Catálogo de datasets con sus tablas y columnas, descubierto de la base, más las ' +
      'relaciones gobernadas que no se sirven y el motivo de cada una.',
    type: SqlCatalogDto,
  })
  catalog(): Promise<SqlCatalogDto> {
    return this.console.catalog();
  }

  /**
   * Planifica sin ejecutar: es el aviso de coste que BigQuery enseña antes de correr.
   *
   * Existe para que la primera noticia de que una consulta va a recorrer la tabla entera no
   * sea el tiempo de espera. Devuelve 200 incluso cuando la consulta es inválida: el
   * resultado de validar algo mal escrito es una validación que salió negativa, no un fallo
   * de la petición, y tratarlo como error obligaría al editor a distinguir «no compila» de
   * «se cayó el servidor» por el código de estado.
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate and estimate a query without executing it' })
  @ApiOkResponse({
    description: 'Resultado de la validación, con estimación si es válida.',
    type: QueryValidationDto,
  })
  validate(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: RunQueryDto,
  ): Promise<QueryValidationDto> {
    return this.console.validate(tenantId, principal, dto.statement);
  }

  @Post('query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute a read-only query against the governed datasets' })
  @ApiOkResponse({
    description: 'Filas, columnas y coste real de la consulta.',
    type: QueryResultDto,
  })
  async query(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: RunQueryDto,
  ): Promise<QueryResultDto> {
    try {
      return await this.console.run(tenantId, principal, dto.statement);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  @Get('history')
  @ApiOperation({ summary: 'List the caller´s own recent queries' })
  @ApiOkResponse({
    description: 'Historial de consultas de quien pregunta.',
    type: QueryHistoryPageDto,
  })
  history(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() dto: QueryHistoryDto,
  ): Promise<QueryHistoryPageDto> {
    return this.console.history(tenantId, principal, dto.limit);
  }

  /**
   * Una consulta rechazada es 422 y no 400.
   *
   * La petición estaba bien formada —el cuerpo es válido, la ruta existe, la sesión
   * autoriza—; lo que no se puede procesar es su contenido. La distinción no es doctrinal:
   * el portal reintenta los 4xx de forma distinta según el código, y un 400 se lee como
   * «el cliente mandó basura», que aquí sería culpar al editor de lo que escribió una
   * persona. El agotamiento del reloj sí es 400 con su propio código para que no se
   * confunda con un rechazo de la guardia.
   */
  private toHttp(error: unknown): Error {
    if (!(error instanceof SqlConsoleQueryError)) return error as Error;
    const body = { code: error.code, message: error.message, detail: error.detail };
    return error.code === 'SQL_TIMEOUT'
      ? new BadRequestException(body)
      : new UnprocessableEntityException(body);
  }
}
