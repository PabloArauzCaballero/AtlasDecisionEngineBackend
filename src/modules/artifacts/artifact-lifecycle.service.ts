import { HttpStatus, Injectable } from '@nestjs/common';
import { CompileStatus, Prisma, VersionStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DomainException } from '../../common/errors/domain-exception';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CompilerService } from '../graph/compiler.service';
import { GraphValidatorService } from '../graph/graph-validator.service';
import { ArtifactGraphReaderService } from './artifact-graph-reader.service';
import { VersionStateService } from './version-state.service';

@Injectable()
export class ArtifactLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: ArtifactGraphReaderService,
    private readonly validator: GraphValidatorService,
    private readonly compiler: CompilerService,
    private readonly states: VersionStateService,
    private readonly audit: AuditService,
  ) {}

  async validate(tenantId: bigint, versionId: bigint, principal: AuthenticatedPrincipal) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      select: { status: true },
    });
    if (!version) throw new DomainException('VERSION_NOT_FOUND', 'Artifact version not found', HttpStatus.NOT_FOUND);
    const validatableStatuses: VersionStatus[] = [
      VersionStatus.DRAFT,
      VersionStatus.VALIDATION_FAILED,
      VersionStatus.VALIDATED,
    ];
    if (!validatableStatuses.includes(version.status)) {
      throw new DomainException('VERSION_NOT_VALIDATABLE', `Version in state ${version.status} cannot be validated`, HttpStatus.CONFLICT);
    }

    const snapshot = await this.graph.loadSnapshot(tenantId, versionId);
    const report = this.validator.validate(snapshot);
    await this.prisma.$transaction(async (tx) => {
      if (report.valid) {
        await tx.decisionArtifactVersion.update({
          where: { id: versionId },
          data: { canonicalChecksum: report.checksum },
        });
        if (version.status !== VersionStatus.VALIDATED) {
          await this.states.transition(versionId, VersionStatus.VALIDATED, principal.id, 'Graph validation passed', tx);
        }
      } else if (version.status !== VersionStatus.VALIDATION_FAILED) {
        await this.states.transition(versionId, VersionStatus.VALIDATION_FAILED, principal.id, 'Graph validation failed', tx);
      }
      await this.audit.append({
        tenantId,
        eventType: report.valid ? 'VALIDATION_PASSED' : 'VALIDATION_FAILED',
        aggregateType: 'ArtifactVersion',
        aggregateId: versionId.toString(),
        actorId: principal.id,
        requestId: principal.requestId,
        payload: report as unknown as Prisma.InputJsonValue,
      }, tx);
    });
    return report;
  }

  async compile(tenantId: bigint, versionId: bigint, principal: AuthenticatedPrincipal) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      select: { status: true, canonicalChecksum: true },
    });
    if (!version) throw new DomainException('VERSION_NOT_FOUND', 'Artifact version not found', HttpStatus.NOT_FOUND);
    if (version.status !== VersionStatus.VALIDATED) {
      throw new DomainException('VERSION_NOT_COMPILED', 'Version must be VALIDATED before compilation', HttpStatus.CONFLICT);
    }

    const snapshot = await this.graph.loadSnapshot(tenantId, versionId);
    const report = this.validator.validate(snapshot);
    if (!report.valid || !report.canonicalAst || !report.checksum) {
      throw new DomainException('VALIDATION_REQUIRED', 'Graph is no longer valid and cannot be compiled', HttpStatus.CONFLICT, report.errors);
    }
    if (version.canonicalChecksum && version.canonicalChecksum !== report.checksum) {
      throw new DomainException('CHECKSUM_MISMATCH', 'Graph changed after validation; validate again', HttpStatus.CONFLICT);
    }

    const result = this.compiler.compile(report.canonicalAst, report.metrics.terminalPathCount);
    const compiled = await this.prisma.$transaction(async (tx) => {
      const record = await tx.decisionCompiledArtifact.create({
        data: {
          artifactVersionId: versionId,
          compilerVersion: CompilerService.VERSION,
          runtimeSchemaVersion: result.compiled.runtimeSchemaVersion,
          compiledPayloadJson: result.compiled as unknown as Prisma.InputJsonValue,
          compiledChecksum: result.checksum,
          compileStatus: CompileStatus.SUCCESS,
        },
      });
      await this.states.transition(versionId, VersionStatus.COMPILED, principal.id, 'Deterministic compilation succeeded', tx);
      await this.audit.append({
        tenantId,
        eventType: 'ARTIFACT_COMPILED',
        aggregateType: 'ArtifactVersion',
        aggregateId: versionId.toString(),
        actorId: principal.id,
        requestId: principal.requestId,
        payload: { compiledArtifactId: record.id.toString(), checksum: record.compiledChecksum },
      }, tx);
      return record;
    });
    return compiled;
  }

  async validateAndCompile(tenantId: bigint, versionId: bigint, principal: AuthenticatedPrincipal) {
    const report = await this.validate(tenantId, versionId, principal);
    if (!report.valid) return { validation: report, compiledArtifact: null };
    const compiledArtifact = await this.compile(tenantId, versionId, principal);
    return { validation: report, compiledArtifact };
  }

  async diff(tenantId: bigint, leftVersionId: bigint, rightVersionId: bigint) {
    const [left, right] = await Promise.all([
      this.graph.loadSnapshot(tenantId, leftVersionId),
      this.graph.loadSnapshot(tenantId, rightVersionId),
    ]);
    return {
      left: { versionId: left.version.id, checksum: left.version.checksum },
      right: { versionId: right.version.id, checksum: right.version.checksum },
      nodes: this.diffByKey(left.nodes, right.nodes, 'key'),
      edges: this.diffByKey(left.edges, right.edges, 'key'),
      conditions: this.diffByKey(left.conditions, right.conditions, 'code'),
      actions: this.diffByKey(left.actions, right.actions, 'code'),
      variables: this.diffByKey(left.variables, right.variables, 'code'),
    };
  }

  private diffByKey<T, K extends keyof T>(left: T[], right: T[], key: K) {
    const a = new Map(left.map((item) => [String(item[key]), item]));
    const b = new Map(right.map((item) => [String(item[key]), item]));
    const keys = new Set([...a.keys(), ...b.keys()]);
    const added: T[] = [];
    const removed: T[] = [];
    const changed: Array<{ before: T; after: T }> = [];
    for (const itemKey of keys) {
      const before = a.get(itemKey);
      const after = b.get(itemKey);
      if (!before && after) added.push(after);
      else if (before && !after) removed.push(before);
      else if (before && after && JSON.stringify(before) !== JSON.stringify(after)) changed.push({ before, after });
    }
    return { added, removed, changed };
  }
}
