import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DecisionUseRestriction, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { VariableContractService } from './variable-contract.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  CreateReasonCodeDto,
  CreateVariableDefinitionDto,
  CreateVariableVersionDto,
  ReasonCodeListQueryDto,
  VariableListQueryDto,
} from './variable.dto';
import { pageResult, paginationArgs } from '../../common/http/pagination';

/** Techo de filas del listado de dependencias; ver la nota en `dependencies`. */
const MAX_DEPENDENCY_ROWS = 1_000;

@Injectable()
export class VariableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
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
      // Filtro por sentido: `OUTPUT` cubre también `OUTPUT_PRIMARY`.
      ...(query.usage
        ? {
            versions: {
              some: {
                artifactUses: {
                  some:
                    query.usage === 'OUTPUT'
                      ? { usageType: { startsWith: 'OUTPUT' } }
                      : { usageType: 'INPUT' },
                },
              },
            },
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
    // La tabla del catálogo consume campos planos (name, dataType, source,
    // latestVersion, …). Sin este proyectado, el frontend recibía la entidad
    // cruda con `canonicalName` y la versión anidada, y todas las columnas menos
    // el código salían vacías. El detalle (`get`) sigue devolviendo el grafo
    // completo; solo el listado se aplana.
    const usageByDefinition = await this.usageDirections(items.map((item) => item.id));
    const mapped = items.map((definition) => {
      const latest = definition.versions[0];
      const authoritativeSource = latest
        ? [...latest.sources].sort(
            (a, b) =>
              Number(b.isAuthoritative) - Number(a.isAuthoritative) || a.precedence - b.precedence,
          )[0]
        : undefined;
      return {
        id: definition.id,
        variableCode: definition.variableCode,
        name: definition.canonicalName,
        category: definition.dataClassification,
        dataType: latest?.dataType ?? null,
        source: authoritativeSource?.sourceSystemCode ?? null,
        latestVersion: latest?.versionNumber ?? null,
        // La clasificación real del catálogo (§1.1), no una etiqueta inventada:
        // antes se devolvía «SENSIBLE»/«ESTÁNDAR», dos valores en castellano que no
        // existen en `SensitivityClass` y que ningún consumidor podía interpretar
        // ni traducir. El detalle ya devolvía el enum; el listado mentía.
        sensitivity: definition.sensitivityClass,
        sensitive: definition.isSensitive,
        // Sentido en el que la usan los algoritmos: sin esto, el catálogo mostraba
        // por igual un dato que hay que aportar y un resultado que el motor produce.
        usage: usageByDefinition.get(definition.id.toString()) ?? 'SIN USO',
        status: definition.isActive ? 'ACTIVE' : 'INACTIVE',
        updatedAt: latest?.effectiveFrom ?? null,
        businessDescription: definition.businessDescription,
      };
    });
    return pageResult(mapped, total, paging.page, paging.pageSize);
  }

  /**
   * Sentido (entrada/salida) en el que cada definición es usada por algún
   * artefacto. Una sola consulta agrupada para toda la página del listado.
   */
  private async usageDirections(definitionIds: bigint[]): Promise<Map<string, string>> {
    const directions = new Map<string, string>();
    if (!definitionIds.length) return directions;
    const uses = await this.prisma.decisionArtifactVariableDependency.findMany({
      where: { variableVersion: { variableDefinitionId: { in: definitionIds } } },
      select: { usageType: true, variableVersion: { select: { variableDefinitionId: true } } },
    });
    for (const use of uses) {
      const key = use.variableVersion.variableDefinitionId.toString();
      const direction = use.usageType.startsWith('OUTPUT') ? 'SALIDA' : 'ENTRADA';
      const current = directions.get(key);
      directions.set(key, !current || current === direction ? direction : 'ENTRADA Y SALIDA');
    }
    return directions;
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
      throw new DomainException(
        'VARIABLE_NOT_FOUND',
        'Variable definition not found',
        HttpStatus.NOT_FOUND,
      );
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
      await this.audit.append(
        {
          tenantId,
          eventType: 'REASON_CODE_CREATED',
          aggregateType: 'ReasonCode',
          aggregateId: reason.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { reasonCode: reason.reasonCode, category: reason.category },
        },
        tx,
      );
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

  /**
   * Dónde se usa la variable (§1.2 «visualizar dependencias»). Sin esto, cambiar un
   * contrato es a ciegas: no hay forma de saber a quién afecta.
   */
  async dependencies(tenantId: bigint, definitionId: bigint) {
    const uses = await this.prisma.decisionArtifactVariableDependency.findMany({
      where: {
        variableVersion: { variableDefinitionId: definitionId, definition: { tenantId } },
      },
      include: {
        variableVersion: { select: { versionNumber: true } },
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
      orderBy: { id: 'asc' },
      // Una variable muy reutilizada la referencian todas las versiones de todos los
      // artefactos que la usan, y aquí se materializa la lista entera. La cota convierte el
      // peor caso en una respuesta truncada en vez de una respuesta que no termina.
      take: MAX_DEPENDENCY_ROWS,
    });
    const items = uses.map((use) => ({
      artifactCode: use.artifactVersion.artifact.artifactCode,
      artifactName: use.artifactVersion.artifact.name,
      artifactVersionId: use.artifactVersion.id.toString(),
      artifactVersionNumber: use.artifactVersion.versionNumber,
      semanticVersion: use.artifactVersion.semanticVersion,
      status: use.artifactVersion.status,
      usageType: use.usageType,
      isRequired: use.isRequired,
      variableVersionNumber: use.variableVersion.versionNumber,
    }));
    return {
      total: items.length,
      // Cambiar el contrato con estas versiones vivas es lo que rompe producción.
      deployed: items.filter((item) => item.status.startsWith('DEPLOYED')).length,
      items,
    };
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
