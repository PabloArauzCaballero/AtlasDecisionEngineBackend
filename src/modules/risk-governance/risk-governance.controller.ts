/** Gobierno del riesgo: apetito de cartera, licitud vigente, calibración y expediente. */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CalibrationService } from './calibration.service';
import {
  CalibrationRequestDto,
  DecideReidentificationDto,
  RecordConsentDto,
  RecordModelDossierDto,
  RecordPortfolioStateDto,
  RequestReidentificationDto,
  RevokeConsentDto,
  UpsertExposureLimitDto,
} from './risk-governance.dto';
import {
  CalibrationReportDto,
  ConsentListDto,
  ExposureLimitListDto,
  GovernanceWriteResultDto,
  ReidentificationListDto,
} from './risk-governance.response.dto';
import { RiskGovernanceService } from './risk-governance.service';

@ApiTags('Risk Governance')
@Controller('v1/risk-governance')
export class RiskGovernanceController {
  constructor(
    private readonly governance: RiskGovernanceService,
    private readonly calibration: CalibrationService,
  ) {}

  // --- Apetito de cartera -------------------------------------------------

  /**
   * Los límites vigentes con su consumo de hoy.
   *
   * Es la pantalla que explica por qué una solicitud buena se rechazó un 28 de mes: sin ella, ese
   * rechazo parece un defecto del modelo y alguien acaba aflojando el corte.
   */
  @Get('limits')
  @ApiOperation({ summary: 'Portfolio exposure limits with their current utilisation' })
  @ApiOkResponse({ description: 'Límites y consumo.', type: ExposureLimitListDto })
  @Roles('RISK_ANALYST', 'RISK_APPROVER', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS')
  listLimits(@TenantId() tenantId: bigint) {
    return this.governance.listLimits(tenantId);
  }

  /** Sólo `RISK_APPROVER`: un límite de cartera es apetito de riesgo, no configuración. */
  @Post('limits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update a portfolio exposure limit' })
  @ApiOkResponse({ description: 'Límite guardado.', type: GovernanceWriteResultDto })
  @Roles('RISK_APPROVER')
  upsertLimit(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: UpsertExposureLimitDto,
  ) {
    return this.governance.upsertLimit(tenantId, dto, principal);
  }

  /** Lo reporta la conciliación con el sistema de cartera, no una persona. */
  @Post('portfolio-state')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a portfolio metric observation (exposure, PAR30, budget…)' })
  @ApiOkResponse({ description: 'Estado registrado.', type: GovernanceWriteResultDto })
  @Roles('OPERATIONS', 'RISK_ANALYST')
  recordPortfolioState(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: RecordPortfolioStateDto,
  ) {
    return this.governance.recordPortfolioState(tenantId, dto, principal);
  }

  // --- Licitud vigente ----------------------------------------------------

  /**
   * `POST` también para consultar: la referencia del titular no puede viajar en la URL, donde
   * acabaría en el registro de acceso, en el proxy y en la traza.
   */
  @Post('consents/lookup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consents of one data subject, each with its verdict for today' })
  @ApiOkResponse({ description: 'Permisos del titular.', type: ConsentListDto })
  @Roles('COMPLIANCE', 'OPERATIONS', 'AUDITOR')
  consents(@TenantId() tenantId: bigint, @Body() dto: RevokeConsentDto) {
    return this.governance.consentsOf(tenantId, dto.subjectReference);
  }

  @Post('consents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a data subject consent with its validity window' })
  @ApiOkResponse({ description: 'Permiso registrado.', type: GovernanceWriteResultDto })
  @Roles('COMPLIANCE', 'OPERATIONS')
  recordConsent(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: RecordConsentDto,
  ) {
    return this.governance.recordConsent(tenantId, dto, principal);
  }

  @Post('consents/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a consent' })
  @ApiOkResponse({ description: 'Permiso revocado.', type: GovernanceWriteResultDto })
  @Roles('COMPLIANCE', 'OPERATIONS')
  revokeConsent(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: RevokeConsentDto,
  ) {
    return this.governance.revokeConsent(tenantId, dto, principal);
  }

  // --- Reidentificación ---------------------------------------------------

  @Get('reidentifications')
  @ApiOperation({ summary: 'Reidentification requests and who decided them' })
  @ApiOkResponse({ description: 'Solicitudes de reidentificación.', type: ReidentificationListDto })
  @Roles('COMPLIANCE', 'AUDITOR', 'RISK_APPROVER')
  listReidentifications(@TenantId() tenantId: bigint) {
    return this.governance.listReidentifications(tenantId);
  }

  @Post('reidentifications')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask to reidentify a pseudonymous subject, stating why' })
  @ApiOkResponse({ description: 'Solicitud registrada.', type: GovernanceWriteResultDto })
  @Roles('COMPLIANCE', 'OPERATIONS')
  requestReidentification(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: RequestReidentificationDto,
  ) {
    return this.governance.requestReidentification(tenantId, dto, principal);
  }

  /** El servicio rechaza que quien pidió sea quien aprueba: sin eso, la segunda firma es teatro. */
  @Post('reidentifications/decide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a reidentification request' })
  @ApiOkResponse({ description: 'Solicitud resuelta.', type: GovernanceWriteResultDto })
  @Roles('COMPLIANCE', 'RISK_APPROVER')
  decideReidentification(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: DecideReidentificationDto,
  ) {
    return this.governance.decideReidentification(tenantId, dto, principal);
  }

  // --- Calibración y expediente ------------------------------------------

  @Post('calibration')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compute and store the calibration curve of a deployed version' })
  @ApiOkResponse({ description: 'Curva de calibración.', type: CalibrationReportDto })
  @Roles('RISK_ANALYST', 'COMPLIANCE', 'AUDITOR', 'RISK_APPROVER')
  calibrate(@TenantId() tenantId: bigint, @Body() dto: CalibrationRequestDto) {
    return this.calibration.calibrate(tenantId, dto);
  }

  @Get('calibration')
  @ApiOperation({ summary: 'Last stored calibration curve, without recomputing' })
  @ApiOkResponse({ description: 'Curva guardada.', type: CalibrationReportDto })
  @Roles('RISK_ANALYST', 'COMPLIANCE', 'AUDITOR', 'RISK_APPROVER')
  storedCalibration(
    @TenantId() tenantId: bigint,
    @Query('artifactVersionId') artifactVersionId: string,
    @Query('windowDays') windowDays: string,
  ) {
    return this.calibration.storedCurve(tenantId, artifactVersionId, Number(windowDays) || 90);
  }

  /** El servicio rechaza que la firme quien creó la versión: sería un trámite, no una validación. */
  @Post('model-dossier')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record independent validation and revalidation due date of a version' })
  @ApiOkResponse({ description: 'Expediente registrado.', type: GovernanceWriteResultDto })
  @Roles('RISK_APPROVER', 'COMPLIANCE')
  recordDossier(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: RecordModelDossierDto,
  ) {
    return this.governance.recordDossier(tenantId, dto, principal);
  }
}
