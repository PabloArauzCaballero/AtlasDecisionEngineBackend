import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type {
  CategoryEmbeddingRepository,
  EntityAliasRepository,
  SemanticCategoryRepository,
  StoredCategoryEmbedding,
} from '../core/application/ports';
import type { EntityAlias, SemanticCategory } from '../core/domain/semantic-analysis.types';

/**
 * Catálogo semántico sobre Prisma.
 *
 * Sustituye a los repositorios Sequelize del paquete original **sin tocar el
 * núcleo**: la arquitectura hexagonal del worker ya dejaba estas tres
 * capacidades detrás de puertos, así que el cambio de ORM es un cambio de
 * adaptador y nada más. Es la razón por la que la lógica de análisis se pudo
 * absorber tal cual.
 *
 * `tenantId` llega como `string` porque así lo declara el contrato del worker,
 * y en el motor las claves son `BigInt`. La conversión ocurre aquí, en el
 * borde, y no se filtra al núcleo.
 */

/** Lee un array de texto guardado como JSON, sin confiar en su forma. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * `undefined` cuando no hay tenant: el proceso worker reclama trabajo de todos
 * los tenants, y en ese caso la consulta no debe filtrar por ninguno.
 */
function toTenantId(tenantId: string | undefined): bigint | undefined {
  if (tenantId === undefined || tenantId === '') return undefined;
  try {
    return BigInt(tenantId);
  } catch {
    // Un tenant que no es numérico no puede existir en esta base. Devolver
    // `undefined` haría leer el catálogo de TODOS los tenants, que es
    // exactamente el fallo que no se puede permitir: se propaga el error.
    throw new Error(`Identificador de tenant no numérico: ${tenantId}`);
  }
}

@Injectable()
export class PrismaSemanticCategoryRepository implements SemanticCategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveCategories(tenantId?: string): Promise<readonly SemanticCategory[]> {
    const rows = await this.prisma.semanticCategory.findMany({
      where: { isActive: true, ...tenantFilter(tenantId) },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id.toString(),
      code: row.code,
      name: row.name,
      description: row.description,
      positiveExamples: toStringArray(row.positiveExamples),
      counterExamples: toStringArray(row.counterExamples),
      restrictions: toStringArray(row.restrictions),
      relatedCategoryCodes: toStringArray(row.relatedCategoryCodes),
      acceptanceThreshold: Number(row.acceptanceThreshold),
      version: row.version,
    }));
  }
}

@Injectable()
export class PrismaEntityAliasRepository implements EntityAliasRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveAliases(tenantId?: string): Promise<readonly EntityAlias[]> {
    const rows = await this.prisma.semanticEntityAlias.findMany({
      where: { isActive: true, ...tenantFilter(tenantId) },
      // Del alias más largo al más corto: al resolver menciones, «Banco
      // Nacional de Bolivia» debe ganar a «Banco», o la mención más específica
      // quedaría absorbida por la más genérica.
      orderBy: [{ alias: 'desc' }],
    });
    return rows.map((row) => ({
      alias: row.alias,
      canonicalName: row.canonicalName,
      entityType: row.entityType,
    }));
  }
}

@Injectable()
export class PrismaCategoryEmbeddingRepository implements CategoryEmbeddingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCategoryIds(
    categoryIds: readonly string[],
    model: string,
  ): Promise<readonly StoredCategoryEmbedding[]> {
    if (categoryIds.length === 0) return [];
    const rows = await this.prisma.semanticCategoryEmbedding.findMany({
      where: { model, categoryId: { in: categoryIds.map((id) => BigInt(id)) } },
    });
    return (
      rows
        .map((row) => ({
          categoryId: row.categoryId.toString(),
          version: row.version,
          model: row.model,
          vector: toNumberArray(row.vector),
        }))
        // Un vector vacío no es un vector: entregarlo haría que la similitud
        // saliera 0 y la categoría desapareciera del ranking en silencio.
        .filter((embedding) => embedding.vector.length > 0)
    );
  }

  async save(embeddings: readonly StoredCategoryEmbedding[]): Promise<void> {
    if (embeddings.length === 0) return;
    // Secuencial y no en paralelo: son a lo sumo unas decenas de categorías, y
    // un `Promise.all` sobre el mismo pool solo adelanta el agotamiento de
    // conexiones sin ganar nada apreciable.
    for (const embedding of embeddings) {
      const categoryId = BigInt(embedding.categoryId);
      await this.prisma.semanticCategoryEmbedding.upsert({
        where: { categoryId_model: { categoryId, model: embedding.model } },
        create: {
          categoryId,
          model: embedding.model,
          version: embedding.version,
          vector: [...embedding.vector],
        },
        update: { version: embedding.version, vector: [...embedding.vector] },
      });
    }
  }
}

function tenantFilter(tenantId: string | undefined): { tenantId?: bigint } {
  const parsed = toTenantId(tenantId);
  return parsed === undefined ? {} : { tenantId: parsed };
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}
