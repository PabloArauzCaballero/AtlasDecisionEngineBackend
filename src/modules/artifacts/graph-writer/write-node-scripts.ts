import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { ReplaceGraphDto } from '../artifact.dto';
import type { GraphWriteContext } from './graph-write-context';

/** Copia de registro de los scripts de nodo: consultable y auditable con su checksum. */
export async function writeNodeScripts(
  tx: Prisma.TransactionClient,
  { tenantId, versionId }: GraphWriteContext,
  dto: ReplaceGraphDto,
  principalId: string,
): Promise<void> {
  // Registry copy of node scripts: the engine keeps executing config_json,
  // but every script becomes queryable/auditable with a checksum and the
  // variable contract it was written against.
  const scriptRows = dto.nodes
    .map((node) => {
      const script = (node.config as { script?: { language?: unknown; source?: unknown } })?.script;
      const source = typeof script?.source === 'string' ? script.source : '';
      if (
        String((node.config as { mode?: unknown })?.mode ?? '').toUpperCase() !== 'SCRIPT' ||
        !source.trim()
      ) {
        return null;
      }
      return {
        tenantId,
        artifactVersionId: versionId,
        nodeKey: node.key,
        language: String(script?.language ?? 'JAVASCRIPT').toUpperCase(),
        sourceCode: source,
        sourceChecksum: createHash('sha256').update(source).digest('hex'),
        inputVariablesJson: dto.dependencies
          .filter((dependency) => !dependency.usageType.startsWith('OUTPUT'))
          .map((dependency) => dependency.dependencyPath),
        outputVariablesJson: dto.dependencies
          .filter((dependency) => dependency.usageType.startsWith('OUTPUT'))
          .map((dependency) => dependency.dependencyPath),
        createdBy: principalId,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (scriptRows.length) {
    await tx.decisionNodeScript.createMany({ data: scriptRows });
  }
}
