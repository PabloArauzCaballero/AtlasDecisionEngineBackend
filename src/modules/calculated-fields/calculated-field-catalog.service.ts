import { HttpStatus, Injectable } from '@nestjs/common';
import { CalculatedFieldImplKind, CalculatedFieldStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import type { CalculatedFieldQueryDto, CreateCalculatedFieldDto } from './calculated-field.dto';

/** Alta y consulta del catálogo de campos calculados (§5). */
@Injectable()
export class CalculatedFieldCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: bigint, query: CalculatedFieldQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(query);
    const where: Prisma.CalculatedFieldWhereInput = {
      tenantId,
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { fieldCode: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.implementationKind || query.status
        ? {
            versions: {
              some: {
                ...(query.implementationKind
                  ? { implementationKind: query.implementationKind as CalculatedFieldImplKind }
                  : {}),
                ...(query.status ? { status: query.status as CalculatedFieldStatus } : {}),
              },
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.calculatedField.findMany({
        where,
        orderBy: [{ category: 'asc' }, { fieldCode: 'asc' }],
        skip,
        take,
        include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
      }),
      this.prisma.calculatedField.count({ where }),
    ]);
    return pageResult(
      rows.map((row) => ({
        id: row.id.toString(),
        fieldCode: row.fieldCode,
        name: row.name,
        description: row.description,
        category: row.category,
        ownerTeam: row.ownerTeam,
        isActive: row.isActive,
        latestVersion: row.versions[0]?.versionNumber ?? null,
        status: row.versions[0]?.status ?? null,
        implementationKind: row.versions[0]?.implementationKind ?? null,
        returnType:
          (row.versions[0]?.returnJson as { dataType?: string } | undefined)?.dataType ?? null,
        updatedAt: row.updatedAt,
      })),
      total,
      page,
      pageSize,
    );
  }

  async get(tenantId: bigint, fieldId: bigint) {
    const field = await this.prisma.calculatedField.findFirst({
      where: { id: fieldId, tenantId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            libraries: { include: { library: true } },
            testCases: { orderBy: { id: 'asc' } },
            // §5.2 «Dependencias»: qué artefactos usan esta versión. Es también lo que
            // impide retirarla a ciegas: el borrado está restringido en la base.
            artifactUses: {
              include: {
                artifactVersion: {
                  select: {
                    id: true,
                    versionNumber: true,
                    semanticVersion: true,
                    status: true,
                    artifact: { select: { artifactCode: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!field) {
      throw new DomainException(
        'CALCULATED_FIELD_NOT_FOUND',
        'Campo calculado no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      id: field.id.toString(),
      fieldCode: field.fieldCode,
      name: field.name,
      description: field.description,
      rationale: field.rationale,
      category: field.category,
      ownerTeam: field.ownerTeam,
      isActive: field.isActive,
      versions: field.versions.map((version) => ({
        id: version.id.toString(),
        versionNumber: version.versionNumber,
        status: version.status,
        implementationKind: version.implementationKind,
        inputs: version.inputsJson,
        returns: version.returnJson,
        comments: version.commentsJson,
        operation: version.operationJson,
        sourceCode: version.sourceCode,
        timeoutMs: version.timeoutMs,
        errorPolicy: version.errorPolicy,
        defaultValue: version.defaultValueJson,
        environment: version.environment,
        contentHash: version.contentHash,
        authorId: version.authorId,
        reviewerId: version.reviewerId,
        approverId: version.approverId,
        createdAt: version.createdAt,
        publishedAt: version.publishedAt,
        libraries: version.libraries.map((link) => ({
          id: link.library.id.toString(),
          logicalName: link.library.logicalName,
          packageName: link.library.packageName,
          version: link.library.version,
          language: link.library.language,
          category: link.library.category,
        })),
        usedBy: version.artifactUses.map((use) => ({
          artifactCode: use.artifactVersion.artifact.artifactCode,
          artifactName: use.artifactVersion.artifact.name,
          artifactVersionId: use.artifactVersion.id.toString(),
          versionNumber: use.artifactVersion.versionNumber,
          semanticVersion: use.artifactVersion.semanticVersion,
          status: use.artifactVersion.status,
          nodeKey: use.nodeKey,
          callKey: use.callKey,
          target: `${use.targetKind.toLowerCase()}.${use.targetCode}`,
        })),
        testCases: version.testCases.map((testCase) => ({
          id: testCase.id.toString(),
          name: testCase.name,
          inputs: testCase.inputsJson,
          expected: testCase.expectedJson,
          expectedErrorCode: testCase.expectedErrorCode,
        })),
      })),
    };
  }

  async create(tenantId: bigint, dto: CreateCalculatedFieldDto, principal: AuthenticatedPrincipal) {
    const existing = await this.prisma.calculatedField.findFirst({
      where: { tenantId, fieldCode: dto.fieldCode },
      select: { id: true },
    });
    if (existing) {
      throw new DomainException(
        'CALCULATED_FIELD_CODE_TAKEN',
        `Ya existe un campo calculado con el código ${dto.fieldCode}`,
        HttpStatus.CONFLICT,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.calculatedField.create({ data: { tenantId, ...dto } });
      await this.audit.append(
        {
          tenantId,
          eventType: 'CALCULATED_FIELD_CREATED',
          aggregateType: 'CalculatedField',
          aggregateId: created.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { fieldCode: created.fieldCode, category: created.category },
        },
        tx,
      );
      return { id: created.id.toString(), fieldCode: created.fieldCode };
    });
  }
}
