import { Injectable } from '@nestjs/common';
import { HashService } from '../../common/crypto/hash.service';
import type { ArtifactGraphSnapshot, CompiledDecisionArtifact } from './graph.types';

@Injectable()
export class CompilerService {
  static readonly VERSION = 'atlas-compiler-1.1.0';

  constructor(private readonly hashes: HashService) {}

  compile(snapshot: ArtifactGraphSnapshot, terminalPaths: number): {
    compiled: CompiledDecisionArtifact;
    checksum: string;
  } {
    const start = snapshot.nodes.find((node) => node.type === 'START');
    if (!start) throw new Error('Validated graph has no START node');
    const usesConfigurableOutputs =
      snapshot.nodes.some((node) => node.type === 'RESULT') ||
      snapshot.variables.some((variable) => String(variable.usageType ?? '').startsWith('OUTPUT'));
    const compiled: CompiledDecisionArtifact = {
      runtimeSchemaVersion: usesConfigurableOutputs ? '1.1' : '1.0',
      compilerVersion: CompilerService.VERSION,
      artifact: snapshot.artifact,
      version: snapshot.version,
      variables: snapshot.variables,
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
      conditions: Object.fromEntries(snapshot.conditions.map((condition) => [condition.code, condition])),
      actions: Object.fromEntries(snapshot.actions.map((action) => [action.code, action])),
      totals: { nodes: snapshot.nodes.length, edges: snapshot.edges.length, terminalPaths },
    };
    return { compiled, checksum: this.hashes.sha256(compiled) };
  }
}
