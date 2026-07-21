import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';

export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SecurityFinding {
  severity: SecuritySeverity;
  code: string;
  message: string;
}

/**
 * Security team dashboard (Fase 10): aggregates data that already exists across
 * several modules (authoring, variables, nested references, code imports,
 * governance, audit, execution) into one read model, so a reviewer never has to
 * hop between five different screens to answer "is this version safe to
 * approve". No new tables — this is a pure aggregation over existing ones.
 * Approve/reject/request-changes is intentionally NOT reimplemented here: the
 * frontend calls the existing, already-RBAC-enforced
 * POST /v1/approval-steps/{stepId}/decisions (governance module) using the
 * pending step this aggregation surfaces.
 */
@Injectable()
export class SecurityReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getVersionReview(tenantId: bigint, versionId: bigint) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      include: { artifact: true },
    });
    if (!version) {
      throw new DomainException('VERSION_NOT_FOUND', 'Artifact version not found', HttpStatus.NOT_FOUND);
    }

    const [
      nodeScripts,
      dependencies,
      references,
      referencedBy,
      approvalRequests,
      codeImports,
      auditEvents,
      executions,
    ] = await Promise.all([
      this.prisma.decisionNodeScript.findMany({ where: { artifactVersionId: versionId } }),
      this.prisma.decisionArtifactVariableDependency.findMany({
        where: { artifactVersionId: versionId },
        include: { variableVersion: { include: { definition: true } } },
      }),
      this.prisma.decisionArtifactReference.findMany({ where: { tenantId, parentArtifactVersionId: versionId } }),
      this.prisma.decisionArtifactReference.findMany({ where: { tenantId, childArtifactVersionId: versionId } }),
      this.prisma.decisionApprovalRequest.findMany({
        where: { artifactVersionId: versionId },
        include: { steps: { include: { decisions: { include: { evidence: true } } } } },
        orderBy: { requestedAt: 'desc' },
      }),
      this.prisma.decisionCodeImport.findMany({ where: { tenantId, artifactVersionId: versionId } }),
      this.prisma.decisionAuditEvent.findMany({
        where: { tenantId, aggregateType: 'ArtifactVersion', aggregateId: versionId.toString() },
        orderBy: { id: 'desc' },
        take: 50,
      }),
      this.prisma.decisionExecution.findMany({
        where: { artifactVersionId: versionId },
        select: { id: true, decisionStatus: true, executedAt: true, errors: true },
        orderBy: { executedAt: 'desc' },
        take: 20,
      }),
    ]);

    const executionsWithErrors = executions.filter((execution) => execution.errors.length);
    const findings = this.computeFindings(nodeScripts, dependencies, references, executionsWithErrors);
    const severity = this.overallSeverity(findings);

    return {
      artifact: {
        id: version.artifact.id.toString(),
        artifactCode: version.artifact.artifactCode,
        name: version.artifact.name,
        riskDomain: version.artifact.riskDomain,
      },
      version: {
        id: version.id.toString(),
        versionNumber: version.versionNumber,
        status: version.status,
        semanticVersion: version.semanticVersion,
        createdBy: version.createdBy,
        createdAt: version.createdAt,
        canonicalChecksum: version.canonicalChecksum,
      },
      severity,
      findings,
      code: nodeScripts.map((script) => ({
        nodeKey: script.nodeKey,
        language: script.language,
        checksum: script.sourceChecksum,
        sourceExcerpt: script.sourceCode.slice(0, 2000),
      })),
      variables: dependencies.map((dependency) => ({
        code: dependency.variableVersion.definition.variableCode,
        usageType: dependency.usageType,
        dataClassification: dependency.variableVersion.definition.dataClassification,
        isSensitive: dependency.variableVersion.definition.isSensitive,
      })),
      nestedTrees: {
        dependsOn: references.map((reference) => ({
          nodeKey: reference.nodeKey,
          childArtifactId: reference.childArtifactId.toString(),
          childArtifactVersionId: reference.childArtifactVersionId.toString(),
        })),
        dependedOnBy: referencedBy.map((reference) => ({
          parentArtifactVersionId: reference.parentArtifactVersionId.toString(),
          nodeKey: reference.nodeKey,
        })),
      },
      staticAnalysis: codeImports.map((codeImport) => ({
        id: codeImport.id.toString(),
        language: codeImport.language,
        status: codeImport.status,
        issues: codeImport.issuesJson,
      })),
      governance: approvalRequests.map((request) => ({
        id: request.id.toString(),
        workflowCode: request.workflowCode,
        status: request.status,
        requestedBy: request.requestedBy,
        requestedAt: request.requestedAt,
        steps: request.steps.map((step) => ({
          id: step.id.toString(),
          stepOrder: step.stepOrder,
          requiredRole: step.requiredRole,
          status: step.status,
          decisions: step.decisions.map((decision) => ({
            decidedBy: decision.decidedBy,
            decision: decision.decision,
            comments: decision.comments,
            decidedAt: decision.decidedAt,
          })),
        })),
      })),
      incidents: auditEvents.map((event) => ({
        id: event.id.toString(),
        eventType: event.eventType,
        actorId: event.actorId,
        occurredAt: event.occurredAt,
        // Direct incident -> version navigation: the frontend links straight to
        // this exact artifact version, not a generic audit feed.
        artifactId: version.artifact.id.toString(),
        versionId: version.id.toString(),
      })),
      executions: {
        total: executions.length,
        withErrors: executionsWithErrors.length,
        recent: executions.map((execution) => ({
          id: execution.id.toString(),
          status: execution.decisionStatus,
          executedAt: execution.executedAt,
          errorCount: execution.errors.length,
        })),
      },
    };
  }

  async exportReport(tenantId: bigint, versionId: bigint) {
    return this.getVersionReview(tenantId, versionId);
  }

  private computeFindings(
    nodeScripts: Array<{ language: string }>,
    dependencies: Array<{ variableVersion: { definition: { isSensitive: boolean; dataClassification: string } } }>,
    references: unknown[],
    executionsWithErrors: unknown[],
  ): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    if (nodeScripts.length) {
      findings.push({
        severity: 'HIGH',
        code: 'CONTAINS_SCRIPT_NODES',
        message: `This version runs ${nodeScripts.length} script node(s) (${[...new Set(nodeScripts.map((script) => script.language))].join(', ')}) — verify the sandbox mode before approving.`,
      });
    }
    const sensitiveCount = dependencies.filter((dependency) => dependency.variableVersion.definition.isSensitive).length;
    if (sensitiveCount) {
      findings.push({
        severity: 'HIGH',
        code: 'SENSITIVE_VARIABLES',
        message: `${sensitiveCount} variable dependency(ies) are marked sensitive.`,
      });
    }
    const restrictedCount = dependencies.filter(
      (dependency) => !['INTERNAL', 'PUBLIC'].includes(dependency.variableVersion.definition.dataClassification.toUpperCase()),
    ).length;
    if (restrictedCount) {
      findings.push({
        severity: 'MEDIUM',
        code: 'RESTRICTED_CLASSIFICATION_VARIABLES',
        message: `${restrictedCount} variable dependency(ies) use a non-internal data classification.`,
      });
    }
    if (references.length) {
      findings.push({
        severity: 'MEDIUM',
        code: 'NESTED_REFERENCES',
        message: `This version invokes ${references.length} nested artifact reference(s) — review the referenced artifacts too.`,
      });
    }
    if (executionsWithErrors.length) {
      findings.push({
        severity: 'MEDIUM',
        code: 'RECENT_EXECUTION_ERRORS',
        message: `${executionsWithErrors.length} of the most recent executions recorded an error.`,
      });
    }
    return findings;
  }

  private overallSeverity(findings: SecurityFinding[]): SecuritySeverity {
    if (findings.some((finding) => finding.severity === 'HIGH')) return 'HIGH';
    if (findings.some((finding) => finding.severity === 'MEDIUM')) return 'MEDIUM';
    return 'LOW';
  }
}
