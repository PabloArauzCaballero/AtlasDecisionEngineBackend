/** Runtime-audience boundary through which AtlasBackend attaches the onboarding dossier to a case. */
import { Body, Controller, Param, Put } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { RUNTIME_DECISION_ROLE } from '../../common/security/platform-roles';
import {
  Audience,
  CurrentPrincipal,
  Roles,
  TenantId,
} from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { AttachOnboardingDossierDto, OnboardingDossierResultDto } from './onboarding-dossier.dto';
import { OnboardingDossierService } from './onboarding-dossier.service';

/**
 * Controlador aparte, y no una ruta más de `ManualReviewController`, porque quien llama es OTRO:
 * aquel es el plano de gestión de los analistas (audiencia `management`, roles de revisión); éste
 * lo usa la integración de AtlasBackend con su credencial de ejecución (`DECISION_ENGINE_API_KEY`,
 * audiencia `runtime`, rol `DECISION_RUNTIME`), la misma con la que ya pide las decisiones. Así ni
 * un analista escribe evidencia por aquí ni la llave de ejecución lee ni resuelve la bandeja.
 */
@ApiTags('Manual Review')
@Controller('v1/manual-reviews/by-execution')
@Audience('runtime')
@Roles(RUNTIME_DECISION_ROLE)
export class OnboardingDossierController {
  constructor(private readonly dossiers: OnboardingDossierService) {}

  @Put(':executionId/onboarding-dossier')
  @ApiOperation({
    summary: 'Attach the onboarding dossier to the review case of an execution',
    description:
      'Guarda el expediente del alta en `evidenceJson.alta` del caso de la ejecución, sin tocar ' +
      'estado ni asignación. Si la ejecución no tiene caso y llega `openIfMissing`, lo abre (OPEN, ' +
      'cola `IDENTIDAD` por defecto, plazo 240 min). Idempotente: repetir el envío reemplaza el ' +
      'expediente. Ejecución de otro tenant o inexistente: 404 `EXECUTION_NOT_FOUND`; sin caso y ' +
      'sin `openIfMissing`: 404 `MANUAL_REVIEW_NOT_FOUND`; caso ya cerrado: 409 ' +
      '`MANUAL_REVIEW_CLOSED`.',
  })
  @ApiOkResponse({
    description: 'Caso con el expediente adjunto; `created` dice si lo abrió esta llamada.',
    type: OnboardingDossierResultDto,
  })
  @ApiNotFoundResponse({ description: 'Ejecución inexistente o ajena, o sin caso que adjuntar.' })
  @ApiConflictResponse({ description: 'El caso ya está resuelto o cancelado.' })
  @ApiPayloadTooLargeResponse({ description: 'El expediente supera 256 KB serializado.' })
  attach(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('executionId') executionId: string,
    @Body() dto: AttachOnboardingDossierDto,
  ) {
    return this.dossiers.attach(
      tenantId,
      parseBigIntId(executionId, 'executionId'),
      dto,
      principal,
    );
  }
}
