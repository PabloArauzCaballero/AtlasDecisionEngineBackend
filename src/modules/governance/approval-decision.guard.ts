import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApprovalRequestStatus, ApprovalStepStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlatformRole } from '../../common/security/platform-roles';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { isVersionContributor } from '../artifacts/version-contributors';

/** Quién puede firmar un paso de aprobación, y en qué orden: rol, segregación de funciones y duplicados. */
@Injectable()
export class ApprovalDecisionGuard {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async authorize(tenantId: bigint, stepId: bigint, principal: AuthenticatedPrincipal) {
    const step = await this.prisma.decisionApprovalStep.findFirst({
      where: {
        id: stepId,
        approvalRequest: { artifactVersion: { artifact: { tenantId } } },
      },
      include: {
        approvalRequest: {
          include: {
            artifactVersion: { include: { artifact: true } },
            steps: {
              include: { decisions: true },
              orderBy: { stepOrder: 'asc' },
            },
          },
        },
        decisions: true,
      },
    });
    if (!step)
      throw new DomainException(
        'APPROVAL_STEP_NOT_FOUND',
        'Approval step not found',
        HttpStatus.NOT_FOUND,
      );
    if (
      step.approvalRequest.status !== ApprovalRequestStatus.IN_REVIEW ||
      step.status !== ApprovalStepStatus.PENDING
    ) {
      throw new DomainException(
        'APPROVAL_STEP_CLOSED',
        'Approval step is no longer open',
        HttpStatus.CONFLICT,
      );
    }
    const priorIncomplete = step.approvalRequest.steps.some(
      (candidate) =>
        candidate.stepOrder < step.stepOrder && candidate.status !== ApprovalStepStatus.APPROVED,
    );
    if (priorIncomplete) {
      throw new DomainException(
        'APPROVAL_STEP_OUT_OF_ORDER',
        'Previous approval steps must complete first',
        HttpStatus.CONFLICT,
      );
    }
    const holdsRequiredRole = principal.roles.includes(step.requiredRole);
    const signedByAdminWildcard = !holdsRequiredRole && this.adminWildcardApplies(principal);
    if (!holdsRequiredRole && !signedByAdminWildcard) {
      throw new DomainException(
        'APPROVAL_ROLE_REQUIRED',
        `Role ${step.requiredRole} is required`,
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      step.separationOfDuties &&
      (await isVersionContributor(this.prisma, step.approvalRequest.artifactVersion, principal.id))
    ) {
      throw new DomainException(
        'SEPARATION_OF_DUTIES_VIOLATION',
        'The version author cannot approve the same version',
        HttpStatus.FORBIDDEN,
      );
    }
    // «Dos personas firman»: nadie firma TODOS los pasos de una solicitud. Se bloquea sólo al
    // firmar el último paso pendiente habiendo firmado ya todos los demás; una misma persona
    // puede firmar dos pasos si otra firma el resto. PLATFORM_ADMIN no se salta la regla.
    const otherSteps = step.approvalRequest.steps.filter((other) => other.id !== step.id);
    if (
      step.separationOfDuties &&
      otherSteps.length > 0 &&
      otherSteps.every((other) =>
        (other.decisions ?? []).some((decision) => decision.decidedBy === principal.id),
      )
    ) {
      throw new DomainException(
        'SEPARATION_OF_DUTIES_VIOLATION',
        'At least two different people must sign an approval request; this principal already signed every other step',
        HttpStatus.FORBIDDEN,
      );
    }
    if (step.decisions.some((decision) => decision.decidedBy === principal.id)) {
      throw new DomainException(
        'DUPLICATE_APPROVAL_DECISION',
        'This principal already decided this step',
        HttpStatus.CONFLICT,
      );
    }
    return { step, signedByAdminWildcard };
  }

  /**
   * ¿Puede PLATFORM_ADMIN firmar un paso cuyo rol no tiene?
   *
   * Por defecto NO (ISO 27002 5.3): el comodín convertía a cualquier administrador en QA, riesgo y
   * cumplimiento a la vez. Sólo vale si el entorno lo activa con
   * `GOVERNANCE_ADMIN_CAN_SIGN_ANY_STEP=true` —TEST/DEV, mientras nadie tenga asignados los roles
   * de cada paso— y, como en `RolesGuard`, sólo sobre una identidad firmada: una clave de API debe
   * tener el rol exacto. La regla de «al menos dos personas» se aplica igual.
   */
  private adminWildcardApplies(principal: AuthenticatedPrincipal): boolean {
    return (
      this.config.get<boolean>('GOVERNANCE_ADMIN_CAN_SIGN_ANY_STEP') === true &&
      principal.roles.includes(PlatformRole.PLATFORM_ADMIN) &&
      (principal.authMethod === 'jwt' || principal.authMethod === 'identity_provider')
    );
  }
}
