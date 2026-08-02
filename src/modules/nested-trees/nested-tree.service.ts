import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  computeMaxDepthFrom,
  detectCycle,
  findAncestors,
  type ArtifactReferenceEdge,
} from './cycle-detector';
import { CreateArtifactReferenceDto, UpdateArtifactReferenceDto } from './nested-tree.dto';
import { validateReferenceContract } from './reference-contract.validator';

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
  private readonly logger = new Logger(NestedTreeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async create(
    tenantId: bigint,
    parentVersionId: bigint,
    dto: CreateArtifactReferenceDto,
    principal: AuthenticatedPrincipal,
  ) {
    const parentVersion = await this.assertEditableParentVersion(tenantId, parentVersionId);
    const childArtifactId = parseBigIntId(dto.childArtifactId, 'childArtifactId');
    const childVersionId = parseBigIntId(dto.childArtifactVersionId, 'childArtifactVersionId');
    await this.assertReferencableChild(
      tenantId,
      parentVersion.artifactId,
      childArtifactId,
      childVersionId,
    );
    await this.assertNoCycleOrDepthOverflow(tenantId, parentVersion.artifactId, childArtifactId);
    this.assertVersionPolicy(dto);
    await this.assertCompatibleContracts(
      parentVersionId,
      childVersionId,
      dto.inputMapping,
      dto.outputMapping,
    );

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
          timeoutMs:
            dto.timeoutMs ?? this.config.get<number>('NESTED_TREE_DEFAULT_TIMEOUT_MS') ?? 2000,
          onErrorPolicy: dto.onErrorPolicy ?? 'FAIL',
          fallbackOutputJson: dto.fallbackOutput as unknown as Prisma.InputJsonValue | undefined,
          requiredRole: dto.requiredRole,
          environmentCode: dto.environmentCode,
          versionSelection: dto.versionSelection ?? 'EXACT',
          maxRetries: dto.maxRetries ?? 0,
          retryDelayMs: dto.retryDelayMs ?? 0,
          executionConditionJson: dto.executionCondition as unknown as
            Prisma.InputJsonValue | undefined,
          isRequired: dto.isRequired ?? true,
          tracePolicy: dto.tracePolicy ?? 'FULL',
          createdBy: principal.id,
        },
      });
      await this.audit.append(
        {
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
        },
        tx,
      );
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
      childVersionId = parseBigIntId(dto.childArtifactVersionId, 'childArtifactVersionId');
      const version = await this.prisma.decisionArtifactVersion.findFirst({
        where: { id: childVersionId, artifact: { tenantId } },
        select: { artifactId: true },
      });
      if (!version) {
        throw new DomainException(
          'CHILD_VERSION_NOT_FOUND',
          'Child artifact version not found',
          HttpStatus.NOT_FOUND,
        );
      }
      childArtifactId = version.artifactId;
      await this.assertReferencableChild(
        tenantId,
        parentVersion.artifactId,
        childArtifactId,
        childVersionId,
      );
      await this.assertNoCycleOrDepthOverflow(
        tenantId,
        parentVersion.artifactId,
        childArtifactId,
        existing.id,
      );
    }

    // Cambiar la versión del hijo O el mapeo obliga a revalidar: el contrato efectivo
    // es el par (versión, mapeo), y tocar cualquiera de los dos puede romperlo.
    if (dto.childArtifactVersionId || dto.inputMapping || dto.outputMapping) {
      await this.assertCompatibleContracts(
        parentVersionId,
        childVersionId,
        (dto.inputMapping ?? existing.inputMappingJson) as never,
        (dto.outputMapping ?? existing.outputMappingJson) as never,
      );
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
          environmentCode: dto.environmentCode,
          versionSelection: dto.versionSelection,
          maxRetries: dto.maxRetries,
          retryDelayMs: dto.retryDelayMs,
          executionConditionJson: dto.executionCondition as unknown as
            Prisma.InputJsonValue | undefined,
          isRequired: dto.isRequired,
          tracePolicy: dto.tracePolicy,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'ARTIFACT_REFERENCE_UPDATED',
          aggregateType: 'DecisionArtifactVersion',
          aggregateId: parentVersionId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { referenceId: existing.id.toString() },
        },
        tx,
      );
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
      await this.audit.append(
        {
          tenantId,
          eventType: 'ARTIFACT_REFERENCE_DELETED',
          aggregateType: 'DecisionArtifactVersion',
          aggregateId: parentVersionId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { referenceId: existing.id.toString(), nodeKey: existing.nodeKey },
        },
        tx,
      );
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
    const maxEdges = this.config.get<number>('NESTED_TREE_GRAPH_MAX_EDGES') ?? 2_000;
    const rootId = artifactId.toString();

    // Se recorre por niveles consultando SOLO la frontera. La versión anterior traía a
    // memoria todas las referencias del tenant y luego descartaba casi todas: el coste
    // crecía con el catálogo entero aunque el artefacto no tuviera ninguna dependencia,
    // que es un OOM barato en cuanto un tenant grande abre esta vista.
    const versionToArtifact = new Map<string, string>();
    const edges: DependencyGraphEdge[] = [];
    const seenEdges = new Set<string>();
    const involvedArtifactIds = new Set<string>([rootId]);
    let frontier = [artifactId];
    let truncated = false;

    for (let depth = 0; depth < maxDepth && frontier.length && !truncated; depth += 1) {
      const frontierVersions = await this.prisma.decisionArtifactVersion.findMany({
        where: { artifactId: { in: frontier }, artifact: { tenantId } },
        select: { id: true, artifactId: true },
      });
      for (const version of frontierVersions) {
        versionToArtifact.set(version.id.toString(), version.artifactId.toString());
      }

      const references = await this.prisma.decisionArtifactReference.findMany({
        where: {
          tenantId,
          OR: [
            // Hacia abajo: referencias declaradas por cualquier versión de la frontera.
            { parentArtifactVersionId: { in: frontierVersions.map((version) => version.id) } },
            // Hacia arriba: quién depende de los artefactos de la frontera.
            { childArtifactId: { in: frontier } },
          ],
        },
        select: {
          id: true,
          nodeKey: true,
          parentArtifactVersionId: true,
          childArtifactId: true,
          childArtifactVersionId: true,
        },
        orderBy: { id: 'asc' },
        // Cota por nivel: ni una sola consulta puede traer más de lo que cabe en el
        // grafo. El corte por total se aplica luego, al deduplicar (el recorrido hacia
        // arriba vuelve a devolver aristas ya vistas y no deben gastar presupuesto).
        take: maxEdges + 1,
      });
      if (references.length > maxEdges) truncated = true;

      // Los padres descubiertos hacia arriba traen versiones que aún no están en el mapa.
      const unknownParentVersions = [
        ...new Set(
          references
            .map((reference) => reference.parentArtifactVersionId.toString())
            .filter((id) => !versionToArtifact.has(id)),
        ),
      ].map(BigInt);
      if (unknownParentVersions.length) {
        const parents = await this.prisma.decisionArtifactVersion.findMany({
          where: { id: { in: unknownParentVersions }, artifact: { tenantId } },
          select: { id: true, artifactId: true },
        });
        for (const parent of parents) {
          versionToArtifact.set(parent.id.toString(), parent.artifactId.toString());
        }
      }

      const discovered: bigint[] = [];
      for (const reference of references) {
        const parentArtifactId = versionToArtifact.get(
          reference.parentArtifactVersionId.toString(),
        );
        // Una versión padre que no resuelve pertenece a otro tenant: la RLS y el filtro
        // por tenant la dejaron fuera, así que su arista tampoco debe aparecer.
        if (!parentArtifactId) continue;
        const edgeKey = reference.id.toString();
        if (seenEdges.has(edgeKey)) continue;
        if (edges.length >= maxEdges) {
          truncated = true;
          break;
        }
        seenEdges.add(edgeKey);
        edges.push({
          parentArtifactVersionId: reference.parentArtifactVersionId.toString(),
          parentArtifactId,
          childArtifactId: reference.childArtifactId.toString(),
          childArtifactVersionId: reference.childArtifactVersionId.toString(),
          nodeKey: reference.nodeKey,
        });
        for (const neighbour of [parentArtifactId, reference.childArtifactId.toString()]) {
          if (involvedArtifactIds.has(neighbour)) continue;
          involvedArtifactIds.add(neighbour);
          discovered.push(BigInt(neighbour));
        }
      }
      frontier = discovered;
    }

    const artifacts = await this.prisma.decisionArtifact.findMany({
      where: { tenantId, id: { in: [...involvedArtifactIds].map(BigInt) } },
      select: { id: true, artifactCode: true, name: true },
    });
    const nodes: DependencyGraphNode[] = artifacts.map((artifact) => ({
      artifactId: artifact.id.toString(),
      artifactCode: artifact.artifactCode,
      name: artifact.name,
    }));

    // El recorte se declara: una vista que calla que dejó aristas fuera se lee como
    // "estas son todas las dependencias", que es justo lo contrario de lo que pasó.
    if (truncated) {
      this.logger.warn(
        `Dependency graph for artifact ${rootId} truncated at ${maxEdges} edges (tenant ${tenantId.toString()})`,
      );
    }
    return { nodes, edges, maxDepth, maxEdges, truncated };
  }

  private async assertEditableParentVersion(tenantId: bigint, parentVersionId: bigint) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: parentVersionId, artifact: { tenantId } },
      select: { id: true, artifactId: true, status: true },
    });
    if (!version) {
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
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
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async getOwned(tenantId: bigint, parentVersionId: bigint, referenceId: bigint) {
    const reference = await this.prisma.decisionArtifactReference.findFirst({
      where: { id: referenceId, tenantId, parentArtifactVersionId: parentVersionId },
    });
    if (!reference) {
      throw new DomainException(
        'REFERENCE_NOT_FOUND',
        'Artifact reference not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return reference;
  }

  private assertRoleAllows(requiredRole: string | null, principal: AuthenticatedPrincipal): void {
    if (!requiredRole) return;
    if (principal.roles.includes(requiredRole) || principal.roles.includes('PLATFORM_ADMIN'))
      return;
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
      throw new DomainException(
        'CHILD_ARTIFACT_NOT_FOUND',
        'Child artifact not found',
        HttpStatus.NOT_FOUND,
      );
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

  /**
   * §9.1: en PROD una referencia debe apuntar a una versión exacta. Resolver «la activa
   * del ambiente» significa que la misma entrada puede dar resultados distintos según
   * cuándo se ejecute, y eso rompe la reproducibilidad que exige una decisión auditable.
   */
  private assertVersionPolicy(dto: CreateArtifactReferenceDto): void {
    if (
      dto.versionSelection === 'ACTIVE_IN_ENVIRONMENT' &&
      (dto.environmentCode ?? '').toUpperCase() === 'PROD'
    ) {
      throw new DomainException(
        'REFERENCE_VERSION_POLICY_FORBIDDEN',
        'En PROD la referencia debe fijar una versión exacta: resolver la activa del ambiente haría la decisión irreproducible',
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * Comprueba que el contrato del hijo pueda satisfacerse con lo que el padre ofrece
   * (§9.2). Se ejecuta al guardar, no al ejecutar: una referencia rota descubierta en
   * producción ya costó una decisión fallida.
   */
  private async assertCompatibleContracts(
    parentVersionId: bigint,
    childVersionId: bigint,
    inputMapping: CreateArtifactReferenceDto['inputMapping'],
    outputMapping: CreateArtifactReferenceDto['outputMapping'],
  ): Promise<void> {
    const [parentContext, childContract] = await Promise.all([
      this.loadParentContext(parentVersionId),
      this.loadChildContract(childVersionId),
    ]);
    const issues = validateReferenceContract({
      childInputs: childContract.inputs,
      childOutputs: childContract.outputs,
      parentContext,
      inputMapping: inputMapping ?? [],
      outputMapping: outputMapping ?? [],
    });
    if (issues.length) {
      throw new DomainException(
        'REFERENCE_CONTRACT_INCOMPATIBLE',
        `El contrato del artefacto referenciado no puede satisfacerse: ${issues[0].message}`,
        HttpStatus.CONFLICT,
        { issues },
      );
    }
  }

  /** Variables de entrada e intermedias que el padre puede ofrecer como origen. */
  private async loadParentContext(parentVersionId: bigint) {
    const [dependencies, intermediates] = await Promise.all([
      this.prisma.decisionArtifactVariableDependency.findMany({
        where: { artifactVersionId: parentVersionId },
        include: { variableVersion: { include: { definition: true } } },
      }),
      this.prisma.decisionIntermediateVariable.findMany({
        where: { artifactVersionId: parentVersionId },
      }),
    ]);
    return [
      ...dependencies.map((dependency) => ({
        code: dependency.variableVersion.definition.variableCode,
        dataType: dependency.variableVersion.dataType,
        required: dependency.isRequired,
        nullable: dependency.variableVersion.nullable,
      })),
      ...intermediates.map((intermediate) => ({
        code: intermediate.code,
        dataType: intermediate.dataType,
        required: true,
        nullable: intermediate.nullable,
      })),
    ];
  }

  private async loadChildContract(childVersionId: bigint) {
    const dependencies = await this.prisma.decisionArtifactVariableDependency.findMany({
      where: { artifactVersionId: childVersionId },
      include: { variableVersion: { include: { definition: true } } },
    });
    const mapped = dependencies.map((dependency) => ({
      isOutput: dependency.usageType.startsWith('OUTPUT'),
      entry: {
        code: dependency.variableVersion.definition.variableCode,
        dataType: dependency.variableVersion.dataType,
        required: dependency.isRequired,
        nullable: dependency.variableVersion.nullable,
      },
    }));
    return {
      inputs: mapped.filter((item) => !item.isOutput).map((item) => item.entry),
      outputs: mapped.filter((item) => item.isOutput).map((item) => item.entry),
    };
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
      ...new Set(
        existingReferences.map((reference) => reference.parentArtifactVersionId.toString()),
      ),
    ].map(BigInt);
    const versions = await this.prisma.decisionArtifactVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, artifactId: true },
    });
    const versionToArtifact = new Map(
      versions.map((version) => [version.id.toString(), version.artifactId]),
    );
    const edges: ArtifactReferenceEdge[] = existingReferences
      .map((reference) => {
        const parent = versionToArtifact.get(reference.parentArtifactVersionId.toString());
        if (!parent) return null;
        return {
          parentArtifactId: parent.toString(),
          childArtifactId: reference.childArtifactId.toString(),
        };
      })
      .filter((edge): edge is ArtifactReferenceEdge => edge !== null);

    const candidate: ArtifactReferenceEdge = {
      parentArtifactId: parentArtifactId.toString(),
      childArtifactId: childArtifactId.toString(),
    };
    const cycle = detectCycle(edges, candidate);
    if (cycle.hasCycle) {
      this.metrics.recordBlockedCycle('CIRCULAR_REFERENCE');
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
      this.metrics.recordBlockedCycle('MAX_DEPTH_EXCEEDED');
      throw new DomainException(
        'NESTED_TREE_MAX_DEPTH_EXCEEDED',
        `This reference would make the nested-tree depth reach ${deepest}, exceeding the configured maximum of ${maxDepth}`,
        HttpStatus.CONFLICT,
        { depth: deepest, maxDepth },
      );
    }
  }
}
