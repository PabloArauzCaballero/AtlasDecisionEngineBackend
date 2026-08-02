import { ConfigService } from '@nestjs/config';
import type { AuditService } from '../src/common/audit/audit.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { NestedTreeService } from '../src/modules/nested-trees/nested-tree.service';

/**
 * The dependency-graph view used to read `decision_artifact_reference` with nothing but
 * `where: { tenantId }` — every reference the tenant owns, pulled into memory only to throw
 * almost all of it away after a depth-bounded walk. The cost scaled with the tenant's whole
 * catalog even for an artifact with no dependencies at all, which is a cheap OOM for anyone
 * who can open the screen. It now walks level by level, querying only the frontier.
 */
describe('NestedTreeService.getDependencyGraph acotado', () => {
  interface Reference {
    id: bigint;
    nodeKey: string;
    parentArtifactVersionId: bigint;
    childArtifactId: bigint;
    childArtifactVersionId: bigint;
  }

  /** Cadena A(1) -> B(2) -> C(3) -> D(4): un artefacto por versión, versión N = artefacto N. */
  const CHAIN: Reference[] = [1, 2, 3].map((n) => ({
    id: BigInt(n),
    nodeKey: `N${n}`,
    parentArtifactVersionId: BigInt(n),
    childArtifactId: BigInt(n + 1),
    childArtifactVersionId: BigInt(n + 1),
  }));

  function makeService(references: Reference[], config: Record<string, unknown> = {}) {
    const referenceQueries: unknown[] = [];
    const prisma = {
      decisionArtifactVersion: {
        findMany: ({
          where,
        }: {
          where: { artifactId?: { in: bigint[] }; id?: { in: bigint[] } };
        }) =>
          Promise.resolve(
            (where.artifactId?.in ?? where.id?.in ?? []).map((id) => ({ id, artifactId: id })),
          ),
      },
      decisionArtifactReference: {
        findMany: (args: {
          where: { OR: Array<Record<string, { in: bigint[] }>> };
          take: number;
        }) => {
          referenceQueries.push(args.where);
          const parents = new Set((args.where.OR[0].parentArtifactVersionId?.in ?? []).map(String));
          const children = new Set((args.where.OR[1].childArtifactId?.in ?? []).map(String));
          const matched = references.filter(
            (reference) =>
              parents.has(reference.parentArtifactVersionId.toString()) ||
              children.has(reference.childArtifactId.toString()),
          );
          return Promise.resolve(matched.slice(0, args.take));
        },
      },
      decisionArtifact: {
        findMany: ({ where }: { where: { id: { in: bigint[] } } }) =>
          Promise.resolve(
            where.id.in.map((id) => ({
              id,
              artifactCode: `ART-${id.toString()}`,
              name: `Artifact ${id.toString()}`,
            })),
          ),
      },
    } as unknown as PrismaService;

    const service = new NestedTreeService(
      prisma,
      {} as AuditService,
      new ConfigService(config),
      new MetricsService(),
    );
    return { service, referenceQueries };
  }

  it('nunca consulta las referencias sin acotar por la frontera', async () => {
    const { service, referenceQueries } = makeService(CHAIN, { NESTED_TREE_MAX_DEPTH: 5 });
    await service.getDependencyGraph(7n, 1n);

    expect(referenceQueries.length).toBeGreaterThan(0);
    for (const where of referenceQueries as Array<Record<string, unknown>>) {
      expect(where.tenantId).toBe(7n);
      // Toda consulta lleva la frontera: ni una sola pide "todas las del tenant".
      expect(Array.isArray(where.OR)).toBe(true);
    }
  });

  it('recorre la cadena completa cuando cabe en la profundidad configurada', async () => {
    const { service } = makeService(CHAIN, { NESTED_TREE_MAX_DEPTH: 5 });
    const graph = await service.getDependencyGraph(7n, 1n);

    expect(graph.edges).toHaveLength(3);
    expect(graph.nodes.map((node) => node.artifactId).sort()).toEqual(['1', '2', '3', '4']);
    expect(graph.truncated).toBe(false);
  });

  it('se detiene en la profundidad máxima', async () => {
    const { service } = makeService(CHAIN, { NESTED_TREE_MAX_DEPTH: 2 });
    const graph = await service.getDependencyGraph(7n, 1n);

    // Dos niveles: A->B y B->C. La arista C->D queda fuera.
    expect(graph.edges.map((edge) => edge.nodeKey)).toEqual(['N1', 'N2']);
    expect(graph.nodes).toHaveLength(3);
  });

  it('declara el recorte en vez de presentarlo como el grafo completo', async () => {
    const { service } = makeService(CHAIN, {
      NESTED_TREE_MAX_DEPTH: 5,
      NESTED_TREE_GRAPH_MAX_EDGES: 2,
    });
    const graph = await service.getDependencyGraph(7n, 1n);

    expect(graph.edges).toHaveLength(2);
    expect(graph.truncated).toBe(true);
    expect(graph.maxEdges).toBe(2);
  });

  it('devuelve solo el artefacto raíz cuando no tiene dependencias', async () => {
    const { service } = makeService([], { NESTED_TREE_MAX_DEPTH: 5 });
    const graph = await service.getDependencyGraph(7n, 99n);

    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toEqual([
      { artifactId: '99', artifactCode: 'ART-99', name: 'Artifact 99' },
    ]);
  });
});
