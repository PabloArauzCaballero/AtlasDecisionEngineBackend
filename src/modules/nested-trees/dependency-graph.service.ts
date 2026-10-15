import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';

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
export class DependencyGraphService {
  private readonly logger = new Logger(DependencyGraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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
}
