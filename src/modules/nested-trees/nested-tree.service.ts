import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { computeMaxDepthFrom, detectCycle, findAncestors, type ArtifactReferenceEdge } from './cycle-detector';
import {
  CreateArtifactReferenceDto,
  UpdateArtifactReferenceDto,
} from './nested-tree.dto';

export interface DependencyGraphNode {
  artifactId: string;
  artifactCode: string;
  name: string;
}

export interface DependencyGraphEdge {
  parentArtifactVersionId: string;
  parentArtifactId: string;
  childArtifactId: string;
  childArtifactVersionId: string;
  nodeKey: string;
}

@Injectable()
export class NestedTreeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async create(
    tenantId: bigint,
    parentVersionId: bigint,
    dto: CreateArtifactReferenceDto,
    principal: AuthenticatedPrincipal,
  ) {
    const parentVersion = await this.assertEditableParentVersion(tenantId, parentVersionId);
    const childArtifactId = BigInt(dto.childArtifactId);
    const childVersionId = BigInt(dto.childArtifactVersionId);
    await this.assertReferencableChild(tenantId, parentVersion.artifactId, childArtifactId, childVersionId);
    await this.assertNoCycleOrDepthOverflow(tenantId, parentVersion.artifactId, childArtifactId);

    const reference = await this.prisma.$transaction(async (tx) => {
      const created = await tx.decisionArtifactReference.create({
        data: {
          tenantId,
          parentArtifactVersionId: parentVersionId,
          nodeKey: dto.nodeKey,
          childArtifactId,
          childArtifactVersionId: childVersionId,
          inputMappingJson: dto.inputMapping as unknown as Prisma.InputJsonValue,
          outputMappingJson: dto.outputMapping as unknown as Prisma.InputJsonValue,
          timeoutMs: dto.timeoutMs ?? this.config.get<number>('NESTED_TREE_DEFAULT_TIMEOUT_MS') ?? 2000,
          onErrorPolicy: dto.onErrorPolicy ?? 'FAIL',
          fallbackOutputJson: dto.fallbackOutput as unknown as Prisma.InputJsonValue | undefined,
          requiredRole: dto.requiredRole,
          createdBy: principal.id,
        },
      });
      await this.audit.append({
        tenantId,
        eventType: 'ARTIFACT_REFERENCE_CREATED',
        aggregateType: 'DecisionArtifactVersion',
        aggregateId: parentVersionId.toString(),
        actorId: principal.id,
        requestId: principal.requestId,
        payload: {
          nodeKey: dto.nodeKey,
          childArtifactId: childArtifactId.toString(),
          childArtifactVersionId: childVersionId.toString(),
        },
      }, tx);
      return created;
    });
    return reference;
  }

  async update(
    tenantId: bigint,
    parentVersionId: bigint,
    referenceId: bigint,
    dto: UpdateArtifactReferenceDto,
    principal: AuthenticatedPrincipal,
  ) {
    const parentVersion = await this.assertEditableParentVersion(tenantId, parentVersionId);
    const existing = await this.getOwned(tenantId, parentVersionId, referenceId);
    this.assertRoleAllows(existing.requiredRole, principal);

    let childArtifactId = existing.childArtifactId;
    let childVersionId = existing.childArtifactVersionId;
    if (dto.childArtifactVersionId) {
      childVersionId = BigInt(dto.childArtifactVersionId);
      const version = await this.prisma.decisionArtifactVersion.findFirst({
        where: { id: childVersionId, artifact: { tenantId } },
        select: { artifactId: true },
      });
      if (!version) {
        throw new DomainException('CHILD_VERSION_NOT_FOUND', 'Child artifact version not found', HttpStatus.NOT_FOUND);
      }
      childArtifactId = version.artifactId;
      await this.assertReferencableChild(tenantId, parentVersion.artifactId, childArtifactId, childVersionId);
      await this.assertNoCycleOrDepthOverflow(tenantId, parentVersion.artifactId, childArtifactId, existing.id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.decisionArtifactReference.update({
        where: { id: existing.id },
        data: {
          childArtifactId,
          childArtifactVersionId: childVersionId,
          inputMappingJson: dto.inputMapping
            ? (dto.inputMapping as unknown as Prisma.InputJsonValue)
            : undefined,
          outputMappingJson: dto.outputMapping
            ? (dto.outputMapping as unknown as Prisma.InputJsonValue)
            : undefined,
          timeoutMs: dto.timeoutMs,
          onErrorPolicy: dto.onErrorPolicy,
          fallbackOutputJson: dto.fallbackOutput as unknown as Prisma.InputJsonValue | undefined,
          requiredRole: dto.requiredRole,
        },
      });
      await this.audit.append({
        tenantId,
        eventType: 'ARTIFACT_REFERENCE_UPDATED',
        aggregateType: 'DecisionArtifactVersion',
        aggregateId: parentVersionId.toString(),
        actorId: principal.id,
        requestId: principal.requestId,
        payload: { referenceId: existing.id.toString() },
      }, tx);
      return result;
    });
    return updated;
  }

  async delete(
    tenantId: bigint,
    parentVersionId: bigint,
    referenceId: bigint,
    principal: AuthenticatedPrincipal,
  ): Promise<void> {
    await this.assertEditableParentVersion(tenantId, parentVersionId);
    const existing = await this.getOwned(tenantId, parentVersionId, referenceId);
    this.assertRoleAllows(existing.requiredRole, principal);
    await this.prisma.$transaction(async (tx) => {
      await tx.decisionArtifactReference.delete({ where: { id: existing.id } });
      await this.audit.append({
        tenantId,
        eventType: 'ARTIFACT_REFERENCE_DELETED',
        aggregateType: 'DecisionArtifactVersion',
        aggregateId: parentVersionId.toString(),
        actorId: principal.id,
        requestId: principal.requestId,
        payload: { referenceId: existing.id.toString(), nodeKey: existing.nodeKey },
      }, tx);
    });
  }

  async list(tenantId: bigint, parentVersionId: bigint) {
    await this.assertParentVersionTenant(tenantId, parentVersionId);
    return this.prisma.decisionArtifactReference.findMany({
      where: { tenantId, parentArtifactVersionId: parentVersionId },
      orderBy: { nodeKey: 'asc' },
    });
  }

  /**
   * Dependency graph for the visual navigation view: every artifact reachable from
   * `artifactId` through references (its dependencies), and every artifact that
   * depends on it (its dependents) — up to the configured max depth in either
   * direction, so the view can never render an unbounded graph.
   */
  async getDependencyGraph(tenantId: bigint, artifactId: bigint) {
    const maxDepth = this.config.get<number>('NESTED_TREE_MAX_DEPTH') ?? 5;
    const allReferences = await this.prisma.decisionArtifactReference.findMany({
      where: { tenantId },
      select: {
        id: true,
        nodeKey: true,
        parentArtifactVersionId: true,
        childArtifactId: true,
        childArtifactVersionId: true,
      },
    });
    const versionIds = [
      ...new Set(allReferences.map((reference) => reference.parentArtifactVersionId.toString())),
    ].map(BigInt);
    const versions = await this.prisma.decisionArtifactVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, artifactId: true },
    });
    const versionToArtifact = new Map(versions.map((version) => [version.id.toString(), version.artifactId]));

    const edges: DependencyGraphEdge[] = allReferences
      .map((reference) => {
        const parentArtifactId = versionToArtifact.get(reference.parentArtifactVersionId.toString());
        if (!parentArtifactId) return null;
        return {
          parentArtifactVersionId: reference.parentArtifactVersionId.toString(),
          parentArtifactId: parentArtifactId.toString(),
          childArtifactId: reference.childArtifactId.toString(),
          childArtifactVersionId: reference.childArtifactVersionId.toString(),
          nodeKey: reference.nodeKey,
        };
      })
      .filter((edge): edge is DependencyGraphEdge => edge !== null);

    const rootId = artifactId.toString();
    const reachableForward = reachableWithinDepth(edges, rootId, maxDepth, 'forward');
    const reachableBackward = reachableWithinDepth(edges, rootId, maxDepth, 'backward');
    const involvedArtifactIds = new Set([...reachableForward, ...reachableBackward, rootId]);
    const relevantEdges = edges.filter(
      (edge) => involvedArtifactIds.has(edge.parentArtifactId) && involvedArtifactIds.has(edge.childArtifactId),
    );

    const artifacts = await this.prisma.decisionArtifact.findMany({
      where: { tenantId, id: { in: [...involvedArtifactIds].map(BigInt) } },
      select: { id: true, artifactCode: true, name: true },
    });
    const nodes: DependencyGraphNode[] = artifacts.map((artifact) => ({
      artifactId: artifact.id.toString(),
      artifactCode: artifact.artifactCode,
      name: artifact.name,
    }));

    return { nodes, edges: relevantEdges, maxDepth };
  }

  private async assertEditableParentVersion(tenantId: bigint, parentVersionId: bigint) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: parentVersionId, artifact: { tenantId } },
      select: { id: true, artifactId: true, status: true },
    });
    if (!version) {
      throw new DomainException('VERSION_NOT_FOUND', 'Artifact version not found', HttpStatus.NOT_FOUND);
    }
    if (version.status !== 'DRAFT' && version.status !== 'VALIDATION_FAILED') {
      throw new DomainException(
        'VERSION_IMMUTABLE',
        `Nested references can only be edited on a DRAFT or VALIDATION_FAILED version; current state is ${version.status}`,
        HttpStatus.CONFLICT,
      );
    }
    return version;
  }

  private async assertParentVersionTenant(tenantId: bigint, parentVersionId: bigint) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: parentVersionId, artifact: { tenantId } },
      select: { id: true },
    });
    if (!version) {
      throw new DomainException('VERSION_NOT_FOUND', 'Artifact version not found', HttpStatus.NOT_FOUND);
    }
  }

  private async getOwned(tenantId: bigint, parentVersionId: bigint, referenceId: bigint) {
    const reference = await this.prisma.decisionArtifactReference.findFirst({
      where: { id: referenceId, tenantId, parentArtifactVersionId: parentVersionId },
    });
    if (!reference) {
      throw new DomainException('REFERENCE_NOT_FOUND', 'Artifact reference not found', HttpStatus.NOT_FOUND);
    }
    return reference;
  }

  private assertRoleAllows(requiredRole: string | null, principal: AuthenticatedPrincipal): void {
    if (!requiredRole) return;
    if (principal.roles.includes(requiredRole) || principal.roles.includes('PLATFORM_ADMIN')) return;
    throw new DomainException(
      'FORBIDDEN',
      `This reference requires the ${requiredRole} role to modify`,
      HttpStatus.FORBIDDEN,
    );
  }

  private async assertReferencableChild(
    tenantId: bigint,
    parentArtifactId: bigint,
    childArtifactId: bigint,
    childVersionId: bigint,
  ): Promise<void> {
    if (childArtifactId === parentArtifactId) {
      throw new DomainException(
        'SELF_REFERENCE_FORBIDDEN',
        'An artifact cannot directly reference itself',
        HttpStatus.BAD_REQUEST,
      );
    }
    const childArtifact = await this.prisma.decisionArtifact.findFirst({
      where: { id: childArtifactId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!childArtifact) {
      throw new DomainException('CHILD_ARTIFACT_NOT_FOUND', 'Child artifact not found', HttpStatus.NOT_FOUND);
    }
    const childVersion = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: childVersionId, artifactId: childArtifactId },
      select: { id: true },
    });
    if (!childVersion) {
      throw new DomainException(
        'CHILD_VERSION_NOT_FOUND',
        'Child artifact version not found for the given child artifact',
        HttpStatus.NOT_FOUND,
      );
    }
    const compiled = await this.prisma.decisionCompiledArtifact.findFirst({
      where: { artifactVersionId: childVersionId, compileStatus: 'SUCCESS' },
      orderBy: { compiledAt: 'desc' },
      select: { id: true },
    });
    if (!compiled) {
      throw new DomainException(
        'CHILD_VERSION_NOT_COMPILED',
        'The referenced child version has no successful compiled artifact yet; compile it before referencing it',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async assertNoCycleOrDepthOverflow(
    tenantId: bigint,
    parentArtifactId: bigint,
    childArtifactId: bigint,
    excludeReferenceId?: bigint,
  ): Promise<void> {
    const maxDepth = this.config.get<number>('NESTED_TREE_MAX_DEPTH') ?? 5;
    const existingReferences = await this.prisma.decisionArtifactReference.findMany({
      where: { tenantId, ...(excludeReferenceId ? { id: { not: excludeReferenceId } } : {}) },
      select: { parentArtifactVersionId: true, childArtifactId: true },
    });
    const versionIds = [
      ...new Set(existingReferences.map((reference) => reference.parentArtifactVersionId.toString())),
    ].map(BigInt);
    const versions = await this.prisma.decisionArtifactVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, artifactId: true },
    });
    const versionToArtifact = new Map(versions.map((version) => [version.id.toString(), version.artifactId]));
    const edges: ArtifactReferenceEdge[] = existingReferences
      .map((reference) => {
        const parent = versionToArtifact.get(reference.parentArtifactVersionId.toString());
        if (!parent) return null;
        return { parentArtifactId: parent.toString(), childArtifactId: reference.childArtifactId.toString() };
      })
      .filter((edge): edge is ArtifactReferenceEdge => edge !== null);

    const candidate: ArtifactReferenceEdge = {
      parentArtifactId: parentArtifactId.toString(),
      childArtifactId: childArtifactId.toString(),
    };
    const cycle = detectCycle(edges, candidate);
    if (cycle.hasCycle) {
      throw new DomainException(
        'CIRCULAR_ARTIFACT_REFERENCE',
        `This reference would create a circular dependency: ${(cycle.path ?? []).join(' -> ')}`,
        HttpStatus.CONFLICT,
        { path: cycle.path },
      );
    }

    const ancestors = findAncestors(edges, candidate.parentArtifactId);
    let deepest = 0;
    for (const ancestor of ancestors) {
      const depth = computeMaxDepthFrom(edges, ancestor, candidate);
      if (depth > deepest) deepest = depth;
    }
    if (deepest > maxDepth) {
      throw new DomainException(
        'NESTED_TREE_MAX_DEPTH_EXCEEDED',
        `This reference would make the nested-tree depth reach ${deepest}, exceeding the configured maximum of ${maxDepth}`,
        HttpStatus.CONFLICT,
        { depth: deepest, maxDepth },
      );
    }
  }
}

function reachableWithinDepth(
  edges: DependencyGraphEdge[],
  rootId: string,
  maxDepth: number,
  direction: 'forward' | 'backward',
): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const [from, to] = direction === 'forward' ? [edge.parentArtifactId, edge.childArtifactId] : [edge.childArtifactId, edge.parentArtifactId];
    const list = adjacency.get(from) ?? [];
    list.push(to);
    adjacency.set(from, list);
  }
  const visited = new Set<string>();
  let frontier = [rootId];
  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return visited;
}
