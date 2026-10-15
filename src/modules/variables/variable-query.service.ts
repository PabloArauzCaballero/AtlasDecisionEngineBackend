import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { VariableListQueryDto } from './variable.dto';

/** Techo de filas del listado de dependencias; ver la nota en `dependencies`. */
const MAX_DEPENDENCY_ROWS = 1_000;

/** Lectura del catálogo de variables: listado paginado, detalle y dónde se usa cada una. */
@Injectable()
export class VariableQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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
}
