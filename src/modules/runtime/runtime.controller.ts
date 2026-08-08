/** Runtime-audience HTTP boundary for idempotent production decision requests. */
import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RUNTIME_DECISION_ROLE } from '../../common/security/platform-roles';
import {
  Audience,
  CurrentPrincipal,
  Roles,
  TenantId,
} from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ExecuteDecisionDto } from './runtime.dto';
import { RuntimeService } from './runtime.service';

/**
 * `@Audience('runtime')` decide QUÉ credencial sirve aquí; `@Roles` decide qué puede hacer.
 * Era la única de las 124 rutas del servicio que se apoyaba sólo en la audiencia, y con eso
 * cualquier credencial runtime válida —incluida una emitida para otro propósito— ejecutaba
 * decisiones. El rol es el que la semilla ya asigna por defecto, así que ningún cliente
 * aprovisionado con el bootstrap estándar cambia de comportamiento.
 */
@ApiTags('Decision Runtime')
@Controller('v1/decisions')
@Audience('runtime')
@Roles(RUNTIME_DECISION_ROLE)
export class RuntimeController {
  constructor(private readonly runtime: RuntimeService) {}

  @Post(':artifactCode')
  @ApiOperation({ summary: 'Execute an idempotent decision against the active deployment' })
  async execute(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('artifactCode') artifactCode: string,
    @Body() dto: ExecuteDecisionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.runtime.execute(tenantId, artifactCode, dto, principal);
    response.status(result.httpStatus);
    return result.body;
  }
}
