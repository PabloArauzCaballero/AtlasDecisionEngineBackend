/** Frontera de los derechos del titular de datos (LGPD art. 18 y 20; CCPA/CPRA). */
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CreateDataSubjectRequestDto } from './data-subject.dto';
import {
  DataSubjectRequestHistoryDto,
  DataSubjectRequestResultDto,
} from './data-subject.response.dto';
import { DataSubjectService } from './data-subject.service';

@ApiTags('Data Subject Rights')
@Controller('v1/data-subject-requests')
// COMPLIANCE y OPERATIONS: quien atiende el canal del titular. Deliberadamente NO los roles
// de autoría — consultar todas las decisiones sobre una persona es una capacidad distinta de
// diseñar el artefacto que las toma.
@Roles('COMPLIANCE', 'OPERATIONS', 'AUDITOR')
export class DataSubjectController {
  constructor(private readonly requests: DataSubjectService) {}

  /**
   * `POST` también para consultar, y no `GET`, porque la referencia del titular no puede
   * viajar en la URL: acabaría en el registro de acceso, en el proxy y en la traza.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register a data subject request and resolve it against the decision history',
  })
  @ApiOkResponse({
    description: 'Solicitud registrada con su resolución y alcance.',
    type: DataSubjectRequestResultDto,
  })
  submit(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateDataSubjectRequestDto,
  ) {
    return this.requests.submit(tenantId, dto, principal);
  }

  @Post('history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List the requests already handled for a data subject' })
  @ApiOkResponse({
    description: 'Historial de solicitudes del titular.',
    type: DataSubjectRequestHistoryDto,
  })
  history(
    @TenantId() tenantId: bigint,
    @Body() dto: Pick<CreateDataSubjectRequestDto, 'subjectReference'>,
  ) {
    return this.requests.history(tenantId, dto.subjectReference);
  }
}
