/** Converts a validated authoring snapshot into the compact immutable runtime representation. */
import { Injectable } from '@nestjs/common';
import { HashService } from '../../common/crypto/hash.service';
import type { ArtifactGraphSnapshot, CompiledDecisionArtifact } from './graph.types';

@Injectable()
export class CompilerService {
  static readonly VERSION = 'atlas-compiler-1.2.0';

  constructor(private readonly hashes: HashService) {}

  compile(
    snapshot: ArtifactGraphSnapshot,
    terminalPaths: number,
  ): {
    compiled: CompiledDecisionArtifact;
    checksum: string;
  } {
    const start = snapshot.nodes.find((node) => node.type === 'START');
    if (!start) throw new Error('Validated graph has no START node');
    const usesConfigurableOutputs =
      snapshot.nodes.some((node) => node.type === 'RESULT') ||
      snapshot.variables.some((variable) => String(variable.usageType ?? '').startsWith('OUTPUT'));
    // 1.2 solo cuando el grafo usa de verdad las capacidades nuevas: un artefacto
    // ya aprobado sin intermedias ni contrato explícito debe recompilar al mismo
    // esquema de runtime (y al mismo checksum) que antes.
    const usesContractExtensions =
      snapshot.intermediates.length > 0 || snapshot.outputContract.length > 0;
    const compiled: CompiledDecisionArtifact = {
      runtimeSchemaVersion: usesContractExtensions
        ? '1.2'
        : usesConfigurableOutputs
          ? '1.1'
          : '1.0',
      compilerVersion: CompilerService.VERSION,
      artifact: snapshot.artifact,
      version: snapshot.version,
      variables: snapshot.variables,
      intermediates: snapshot.intermediates,
      outputContract: snapshot.outputContract,
      startNodeKey: start.key,
      nodes: Object.fromEntries(snapshot.nodes.map((node) => [node.key, node])),
      edgesByNode: Object.fromEntries(
        snapshot.nodes.map((node) => [
          node.key,
          snapshot.edges
            .filter((edge) => edge.from === node.key)
            .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key)),
        ]),
      ),
      conditions: Object.fromEntries(
        snapshot.conditions.map((condition) => [condition.code, condition]),
      ),
      actions: Object.fromEntries(snapshot.actions.map((action) => [action.code, action])),
      totals: { nodes: snapshot.nodes.length, edges: snapshot.edges.length, terminalPaths },
    };
    return { compiled, checksum: this.hashes.sha256(compiled) };
  }
}
