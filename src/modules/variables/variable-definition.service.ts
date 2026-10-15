import { HttpStatus, Injectable } from '@nestjs/common';
import { DecisionUseRestriction, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { VariableContractService } from './variable-contract.service';
import { CreateVariableDefinitionDto, CreateVariableVersionDto } from './variable.dto';

/** Alta de definiciones de variable y de sus versiones, validando el contrato antes de escribir. */
@Injectable()
export class VariableDefinitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contracts: VariableContractService,
  ) {}

  async createDefinition(
    tenantId: bigint,
    dto: CreateVariableDefinitionDto,
    principal: AuthenticatedPrincipal,
  ) {
    const contract = this.contracts.validateContract(dto.initialVersion);
    if (!contract.valid) {
      throw new DomainException(
        'VARIABLE_CONTRACT_INVALID',
        `El contrato de ${dto.variableCode} no es válido: ${contract.issues[0].message}`,
        HttpStatus.BAD_REQUEST,
        { issues: contract.issues },
      );
    }
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
          // Eje de licitud de uso, independiente de `isSensitive`/`dataClassification`.
          ...(dto.decisionUseRestriction
            ? { decisionUseRestriction: dto.decisionUseRestriction as DecisionUseRestriction }
            : {}),
          versions: {
            create: this.versionCreateData(1, dto.initialVersion),
          },
        },
        include: {
          versions: { include: { sources: true, validationRules: true } },
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'VARIABLE_DEFINITION_CREATED',
          aggregateType: 'VariableDefinition',
          aggregateId: definition.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { variableCode: definition.variableCode, sensitive: definition.isSensitive },
        },
        tx,
      );
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
      throw new DomainException(
        'VARIABLE_NOT_FOUND',
        'Variable definition not found',
        HttpStatus.NOT_FOUND,
      );
    }
    // §1.2 — el backend rechaza configuraciones inválidas y verifica compatibilidad
    // ANTES de crear la versión: una vez creada es inmutable y ya alimenta artefactos.
    const contract = this.contracts.validateContract(dto);
    if (!contract.valid) {
      throw new DomainException(
        'VARIABLE_CONTRACT_INVALID',
        `El contrato de ${definition.variableCode} no es válido: ${contract.issues[0].message}`,
        HttpStatus.BAD_REQUEST,
        { issues: contract.issues },
      );
    }
    const compatibility = await this.contracts.assertSafeToVersion(tenantId, definitionId, dto);

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
      await this.audit.append(
        {
          tenantId,
          eventType: 'VARIABLE_VERSION_CREATED',
          aggregateType: 'VariableDefinition',
          aggregateId: definitionId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            variableCode: definition.variableCode,
            versionNumber,
            compatibility: compatibility.level,
            changes: compatibility.changes.map((change) => change.code),
          },
        },
        tx,
      );
      return version;
    });
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
      // §1.1 — el resto del contrato: cómo se llama, qué significa, qué restringe, qué
      // decir cuando falla, con qué ejemplos se documenta y de dónde debería venir.
      displayName: dto.displayName,
      description: dto.description,
      constraintsJson: (dto.constraints ?? dto.validationSchema) as
        Prisma.InputJsonValue | undefined,
      validationMessage: dto.validationMessage,
      exampleValidJson: dto.exampleValid as Prisma.InputJsonValue | undefined,
      exampleInvalidJson: dto.exampleInvalid as Prisma.InputJsonValue | undefined,
      expectedOrigin: dto.expectedOrigin ?? 'REQUEST',
      contractVersion: dto.contractVersion ?? '1',
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
