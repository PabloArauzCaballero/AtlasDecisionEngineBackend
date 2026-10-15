import { PlatformRole } from '../../common/security/platform-roles';

/** Los pasos de firma, en orden: QA, riesgo y —si se pide— cumplimiento. */
export function buildApprovalSteps(requireCompliance: boolean | undefined) {
  return [
    {
      stepOrder: 1,
      requiredRole: PlatformRole.QA_ANALYST,
      minApprovals: 1,
      separationOfDuties: true,
    },
    {
      stepOrder: 2,
      requiredRole: PlatformRole.RISK_APPROVER,
      minApprovals: 1,
      separationOfDuties: true,
    },
    ...(requireCompliance
      ? [
          {
            stepOrder: 3,
            requiredRole: PlatformRole.COMPLIANCE,
            minApprovals: 1,
            separationOfDuties: true,
          },
        ]
      : []),
  ];
}
