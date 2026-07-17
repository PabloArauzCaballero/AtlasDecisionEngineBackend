import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  CreateReasonCodeDto,
  CreateVariableDefinitionDto,
  CreateVariableVersionDto,
  ReasonCodeListQueryDto,
  VariableListQueryDto,
} from './variable.dto';
import { pageResult, paginationArgs } from '../../common/http/pagination';

@Injectable()
export class VariableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async createDefinition(
    tenantId: bigint,
    dto: CreateVariableDefinitionDto,
    principal: AuthenticatedPrincipal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const definition = await tx.decisionVariableDefinition.create({
        data: {
          tenantId,
          variableCode: dto.variableCode,
          canonicalName: dto.canonicalName,
          businessDescription: dto.businessDescription,
          dataClassification: dto.dataClassification,
          ownerTeam: dto.ownerTeam,
          isSensitive: dto.isSensitive,
          versions: {
            create: this.versionCreateData(1, dto.initialVersion),
          },
        },
        include: {
          versions: { include: { sources: true, validationRules: true } },
        },
      });
      await this.audit.append({
        tenantId,
        eventType: 'VARIABLE_DEFINITION_CREATED',
        aggregateType: 'VariableDefinition',
        aggregateId: definition.id.toString(),
        actorId: principal.id,
        requestId: principal.requestId,
        payload: { variableCode: definition.variableCode, sensitive: definition.isSensitive },
      }, tx);
      return definition;
    });
  }

  async createVersion(
    tenantId: bigint,
    definitionId: bigint,
    dto: CreateVariableVersionDto,
    principal: AuthenticatedPrincipal,
  ) {
    const definition = await this.prisma.decisionVariableDefinition.findFirst({
      where: { id: definitionId, tenantId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (!definition) {
      throw new DomainException('VARIABLE_NOT_FOUND', 'Variable definition not found', HttpStatus.NOT_FOUND);
    }
    const latest = definition.versions[0];
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    return this.prisma.$transaction(async (tx) => {
      if (latest && !latest.effectiveTo) {
        await tx.decisionVariableVersion.update({
          where: { id: latest.id },
          data: { effectiveTo: new Date() },
        });
      }
      const version = await tx.decisionVariableVersion.create({
        data: {
          variableDefinitionId: definitionId,
          ...this.versionCreateData(versionNumber, dto),
        },
        include: { sources: true, validationRules: true },
      });
      await this.audit.append({
        tenantId,
        eventType: 'VARIABLE_VERSION_CREATED',
        aggregateType: 'VariableDefinition',
        aggregateId: definitionId.toString(),
        actorId: principal.id,
        requestId: principal.requestId,
        payload: { variableCode: definition.variableCode, versionNumber },
      }, tx);
      return version;
    });
  }

  async list(tenantId: bigint, query: VariableListQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where: Prisma.DecisionVariableDefinitionWhereInput = {
      tenantId,
      isActive: true,
      ...(query.search
        ? {
            OR: [
              { variableCode: { contains: query.search, mode: 'insensitive' } },
              { canonicalName: { contains: query.search, mode: 'insensitive' } },
              { businessDescription: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.decisionVariableDefinition.count({ where }),
      this.prisma.decisionVariableDefinition.findMany({
        where,
        skip: paging.skip,
        take: paging.take,
        orderBy: [{ variableCode: 'asc' }, { id: 'asc' }],
        include: {
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            include: { sources: true, validationRules: true },
          },
        },
      }),
    ]);
    return pageResult(items, total, paging.page, paging.pageSize);
  }

  async get(tenantId: bigint, definitionId: bigint) {
    const definition = await this.prisma.decisionVariableDefinition.findFirst({
      where: { id: definitionId, tenantId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            sources: { orderBy: { precedence: 'asc' } },
            validationRules: true,
            artifactUses: {
              include: {
                artifactVersion: { include: { artifact: true } },
              },
            },
          },
        },
      },
    });
    if (!definition) {
      throw new DomainException('VARIABLE_NOT_FOUND', 'Variable definition not found', HttpStatus.NOT_FOUND);
    }
    return definition;
  }

  async createReasonCode(
    tenantId: bigint,
    dto: CreateReasonCodeDto,
    principal: AuthenticatedPrincipal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const reason = await tx.decisionReasonCode.create({
        data: {
          tenantId,
          reasonCode: dto.reasonCode,
          category: dto.category,
          publicMessage: dto.publicMessage,
          internalMessage: dto.internalMessage,
          severity: dto.severity,
          isAdverseAction: dto.isAdverseAction,
        },
      });
      await this.audit.append({
        tenantId,
        eventType: 'REASON_CODE_CREATED',
        aggregateType: 'ReasonCode',
        aggregateId: reason.id.toString(),
        actorId: principal.id,
        requestId: principal.requestId,
        payload: { reasonCode: reason.reasonCode, category: reason.category },
      }, tx);
      return reason;
    });
  }

  async listReasonCodes(tenantId: bigint, query: ReasonCodeListQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where: Prisma.DecisionReasonCodeWhereInput = {
      tenantId,
      isActive: true,
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { reasonCode: { contains: query.search, mode: 'insensitive' } },
              { publicMessage: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.decisionReasonCode.count({ where }),
      this.prisma.decisionReasonCode.findMany({
        where,
        skip: paging.skip,
        take: paging.take,
        orderBy: [{ category: 'asc' }, { reasonCode: 'asc' }],
      }),
    ]);
    return pageResult(items, total, paging.page, paging.pageSize);
  }

  private versionCreateData(versionNumber: number, dto: CreateVariableVersionDto) {
    return {
      versionNumber,
      dataType: dto.dataType.toUpperCase(),
      unitCode: dto.unitCode,
      nullable: dto.nullable,
      defaultValueJson: dto.defaultValue as Prisma.InputJsonValue | undefined,
      validationSchemaJson: dto.validationSchema as Prisma.InputJsonValue | undefined,
      derivationExpressionJson: dto.derivationExpression as Prisma.InputJsonValue | undefined,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      sources: {
        create: dto.sources.map((source) => ({
          sourceSystemCode: source.sourceSystemCode,
          sourcePath: source.sourcePath,
          sourceField: source.sourceField,
          freshnessSlaSeconds: source.freshnessSlaSeconds,
          precedence: source.precedence,
          isAuthoritative: source.isAuthoritative,
        })),
      },
      validationRules: {
        create: dto.validationRules.map((rule) => ({
          ruleType: rule.ruleType,
          ruleConfigJson: rule.config as Prisma.InputJsonValue,
          severity: rule.severity,
          errorCode: rule.errorCode,
        })),
      },
    };
  }
}
