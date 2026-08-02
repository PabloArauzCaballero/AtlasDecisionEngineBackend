/** Panel de librerías autorizadas (§7): catálogo consultable y alta gobernada. */
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ApiItemsResponse, ApiPagedResponse } from '../../common/http/pagination.dto';
import { ApprovedLibraryDto, PreludeDto } from './library.response.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { LibraryQueryDto, UpsertLibraryDto } from './library.dto';
import { LibraryService } from './library.service';

@ApiTags('Approved Libraries')
@Controller('v1/libraries')
export class LibraryController {
  constructor(private readonly libraries: LibraryService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo de librerías autorizadas, filtrable por lenguaje y ambiente' })
  @ApiPagedResponse('Página del registro de librerías autorizadas.', ApprovedLibraryDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'PLATFORM_ADMIN')
  list(@TenantId() tenantId: bigint, @Query() query: LibraryQueryDto) {
    return this.libraries.list(tenantId, query);
  }

  @Get('preludes')
  @ApiOperation({
    summary: 'Implementaciones disponibles que una librería puede habilitar',
    description:
      'Solo se puede aprobar una librería cuyo prelude ya exista y esté revisado en el repositorio.',
  })
  @ApiItemsResponse(
    'Preludes disponibles en el repositorio. Catálogo cerrado, no paginado.',
    PreludeDto,
  )
  @Roles('PLATFORM_ADMIN', 'COMPLIANCE', 'RISK_ANALYST')
  preludes() {
    return { items: this.libraries.availablePreludes() };
  }

  @Post()
  @ApiOperation({ summary: 'Aprobar o actualizar una librería del registro' })
  @ApiCreatedResponse({ description: 'Librería aprobada o actualizada.', type: ApprovedLibraryDto })
  @Roles('PLATFORM_ADMIN', 'COMPLIANCE')
  upsert(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: UpsertLibraryDto,
  ) {
    return this.libraries.upsert(tenantId, dto, principal);
  }
}
