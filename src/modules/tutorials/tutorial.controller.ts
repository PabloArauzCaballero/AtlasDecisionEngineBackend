/** Authenticated API for reading and idempotently updating the caller's tutorial progress. */
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PLATFORM_ROLES } from '../../common/security/platform-roles';
import { ApiArrayResponse } from '../../common/http/pagination.dto';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { UpsertTutorialProgressDto } from './tutorial.dto';
import { TutorialProgressDto } from './tutorial.response.dto';
import { TutorialService } from './tutorial.service';

@ApiTags('Tutorials')
@Controller('v1')
export class TutorialController {
  constructor(private readonly tutorials: TutorialService) {}

  @Get('tutorial-progress')
  @ApiOperation({ summary: 'List tutorial progress for the authenticated user' })
  @ApiArrayResponse(
    'Progreso del usuario autenticado. Array desnudo: acotado a sus propios tutoriales.',
    TutorialProgressDto,
  )
  @Roles(...PLATFORM_ROLES)
  list(@TenantId() tenantId: bigint, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.tutorials.listProgress(tenantId, principal.id);
  }

  @Put('tutorial-progress/:tutorialId')
  @ApiOperation({ summary: 'Create or update one tutorial progress record' })
  @ApiOkResponse({ description: 'Progreso creado o actualizado.', type: TutorialProgressDto })
  @Roles(...PLATFORM_ROLES)
  upsert(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tutorialId') tutorialId: string,
    @Body() dto: UpsertTutorialProgressDto,
  ) {
    return this.tutorials.upsertProgress(tenantId, principal.id, tutorialId, dto);
  }
}
