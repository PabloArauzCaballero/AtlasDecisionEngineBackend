/** Maintains tenant-safe policy links and computes coverage without asserting approval. */
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  CreateBusinessObjectiveDto,
  LinkPolicyArtifactDto,
  LinkPolicyTestSuiteDto,
  ObjectiveListQueryDto,
} from './traceability.dto';

/** Techo de filas de la matriz de cobertura; ver la nota en `coverageMatrix`. */
const MAX_MATRIX_ROWS = 500;

@Injectable()
export class TraceabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async createObjective(
    tenantId: bigint,
    dto: CreateBusinessObjectiveDto,
    principal: AuthenticatedPrincipal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const objective = await tx.businessObjective.create({
        data: {
          tenantId,
          objectiveCode: dto.objectiveCode,
          name: dto.name,
          metric: dto.metric,
          targetJson: dto.target as Prisma.InputJsonValue,
          ownerTeam: dto.ownerTeam,
          policyRequirements: {
            create: dto.policies.map((policy) => ({
              policyCode: policy.policyCode,
              rationale: policy.rationale,
              owner: policy.owner,
              severity: policy.severity,
            })),
          },
        },
        include: { policyRequirements: true },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'BUSINESS_OBJECTIVE_CREATED',
          aggregateType: 'BusinessObjective',
          aggregateId: objective.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            objectiveCode: objective.objectiveCode,
            policyCount: objective.policyRequirements.length,
          },
        },
        tx,
      );
      return objective;
    });
  }

  async list(tenantId: bigint, query: ObjectiveListQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(
      query,
      this.config.get<number>('MAX_PAGE_SIZE') ?? 100,
    );
    const where = { tenantId, isActive: true };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.businessObjective.findMany({
        where,
        include: {
          policyRequirements: {
            include: {
              artifactLinks: {
                include: { artifactVersion: { include: { artifact: true } } },
              },
              testLinks: { include: { testSuite: true } },
            },
          },
        },
        orderBy: { objectiveCode: 'asc' },
        skip,
        take,
      }),
      this.prisma.businessObjective.count({ where }),
    ]);
    return pageResult(
      items.map((objective) => ({
        ...objective,
        policyCount: objective.policyRequirements.length,
        artifactCount: objective.policyRequirements.reduce(
          (sum, policy) => sum + policy.artifactLinks.length,
          0,
        ),
        testCount: objective.policyRequirements.reduce(
          (sum, policy) => sum + policy.testLinks.length,
          0,
        ),
        status: objective.isActive ? 'ACTIVE' : 'INACTIVE',
      })),
      total,
      page,
      pageSize,
    );
  }

  async getObjective(tenantId: bigint, objectiveId: bigint) {
    const objective = await this.prisma.businessObjective.findFirst({
      where: { id: objectiveId, tenantId },
      include: {
        policyRequirements: {
          include: {
            artifactLinks: {
              include: { artifactVersion: { include: { artifact: true } } },
            },
            testLinks: { include: { testSuite: true } },
          },
        },
      },
    });
    if (!objective)
      throw new DomainException(
        'OBJECTIVE_NOT_FOUND',
        'Business objective not found',
        HttpStatus.NOT_FOUND,
      );
    return { ...objective, status: objective.isActive ? 'ACTIVE' : 'INACTIVE' };
  }

  async coverageMatrix(tenantId: bigint) {
    const objectives = await this.prisma.businessObjective.findMany({
      where: { tenantId, isActive: true },
      include: {
        policyRequirements: {
          include: { artifactLinks: true, testLinks: true },
          orderBy: { policyCode: 'asc' },
          // Cota defensiva: la matriz se materializa entera en memoria y se serializa de una
          // vez. El catálogo de gobierno crece despacio, así que ningún tenant real la roza;
          // está para que un catálogo desbocado degrade la vista en vez de tumbar el proceso.
          take: MAX_MATRIX_ROWS,
        },
      },
      orderBy: { objectiveCode: 'asc' },
      take: MAX_MATRIX_ROWS,
    });
    const policyMap = new Map<string, { id: string; policyCode: string }>();
    for (const objective of objectives) {
      for (const policy of objective.policyRequirements) {
        policyMap.set(policy.policyCode, {
          id: policy.id.toString(),
          policyCode: policy.policyCode,
        });
      }
    }
    const policies = [...policyMap.values()];
    let covered = 0;
    // Denominador: los cruces que SON un requisito, no las celdas de la rejilla. Ver la
    // nota de `NOT_APPLICABLE` más abajo.
    let required = 0;
    const matrixObjectives = objectives.map((objective) => {
      const requirements = new Map(
        objective.policyRequirements.map((policy) => [policy.policyCode, policy]),
      );
      const coverage = Object.fromEntries(
        policies.map((policy) => {
          const requirement = requirements.get(policy.policyCode);
          /*
           * La celda existe pero el cruce NO.
           *
           * Una política pertenece a UN objetivo (`policyRequirement.businessObjectiveId`),
           * y la matriz publica una columna por cada código del tenant. Estas celdas se
           * devolvían como `GAP` y se contaban en `total`, así que el porcentaje no podía
           * llegar a 100: con 27 objetivos de una política cada uno, sólo 27 de las 729
           * celdas eran cubribles y un tenant con TODA su evidencia enlazada leía 4 %.
           * Se mantiene la celda —la matriz sigue siendo rectangular, que es lo que la
           * hace legible— pero se dice que no aplica en vez de acusar un hueco que nadie
           * puede cerrar.
           */
          if (!requirement) return [policy.policyCode, 'NOT_APPLICABLE'];
          required += 1;
          const hasArtifact = Boolean(requirement.artifactLinks.length);
          const hasTest = Boolean(requirement.testLinks.length);
          const state =
            hasArtifact && hasTest ? 'COMPLETE' : hasArtifact || hasTest ? 'PARTIAL' : 'GAP';
          if (state === 'COMPLETE') covered += 1;
          return [policy.policyCode, state];
        }),
      );
      return {
        id: objective.id,
        objectiveCode: objective.objectiveCode,
        name: objective.name,
        coverage,
      };
    });
    return {
      policies,
      objectives: matrixObjectives,
      covered,
      total: required,
    };
  }

  async linkArtifact(
    tenantId: bigint,
    policyId: bigint,
    dto: LinkPolicyArtifactDto,
    principal: AuthenticatedPrincipal,
  ) {
    await this.assertPolicyTenant(tenantId, policyId);
    const versionId = parseBigIntId(dto.artifactVersionId, 'artifactVersionId');
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
    });
    if (!version)
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.policyArtifactLink.create({
        data: { policyRequirementId: policyId, artifactVersionId: versionId },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'POLICY_ARTIFACT_LINKED',
          aggregateType: 'PolicyRequirement',
          aggregateId: policyId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { artifactVersionId: versionId.toString() },
        },
        tx,
      );
      return link;
    });
  }

  async linkTestSuite(
    tenantId: bigint,
    policyId: bigint,
    dto: LinkPolicyTestSuiteDto,
    principal: AuthenticatedPrincipal,
  ) {
    await this.assertPolicyTenant(tenantId, policyId);
    const suiteId = parseBigIntId(dto.testSuiteId, 'testSuiteId');
    const suite = await this.prisma.decisionTestSuite.findFirst({
      where: { id: suiteId, artifactVersion: { artifact: { tenantId } } },
    });
    if (!suite)
      throw new DomainException(
        'TEST_SUITE_NOT_FOUND',
        'Test suite not found',
        HttpStatus.NOT_FOUND,
      );
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.policyTestLink.create({
        data: { policyRequirementId: policyId, testSuiteId: suiteId },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'POLICY_TEST_LINKED',
          aggregateType: 'PolicyRequirement',
          aggregateId: policyId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { testSuiteId: suiteId.toString() },
        },
        tx,
      );
      return link;
    });
  }

  private async assertPolicyTenant(tenantId: bigint, policyId: bigint): Promise<void> {
    const policy = await this.prisma.policyRequirement.findFirst({
      where: { id: policyId, businessObjective: { tenantId } },
      select: { id: true },
    });
    if (!policy)
      throw new DomainException(
        'POLICY_NOT_FOUND',
        'Policy requirement not found',
        HttpStatus.NOT_FOUND,
      );
  }
}
