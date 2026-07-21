import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DomainException } from '../../common/errors/domain-exception';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import { ExpressionEvaluator } from '../graph/expression-evaluator';
import type {
  ArtifactReferenceResolution,
  ArtifactReferenceResolver,
  CompiledDecisionArtifact,
  NestedExecutionTraceEntry,
  NestedReferenceCursor,
} from '../graph/graph.types';

interface InputMappingEntry {
  childVariableCode: string;
  source: 'VARIABLE' | 'LITERAL' | 'EXPRESSION';
  path?: string;
  value?: unknown;
  expression?: unknown;
}

interface OutputMappingEntry {
  childOutputCode: string;
}

/**
 * Runtime side of nested decision trees (Fase 7): recursively invokes a referenced
 * artifact's compiled graph and maps its output back to the parent's context.
 *
 * Implements ArtifactReferenceResolver but is never constructor-injected into
 * ExecutionEngineService (see graph.types.ts) — callers obtain a resolver bound to
 * their tenant/principal via `bind()` and pass it explicitly to `engine.execute()`.
 * This keeps GraphModule free of any dependency on this module, so there is no
 * circular module/provider dependency between them.
 */
@Injectable()
export class NestedTreeExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly engine: ExecutionEngineService,
    private readonly expressions: ExpressionEvaluator,
  ) {}

  /** Binds a resolver to one request's tenant/principal for use with engine.execute(). */
  bind(tenantId: bigint, principal: AuthenticatedPrincipal): ArtifactReferenceResolver {
    return {
      resolve: (parentArtifactVersionId, nodeKey, context, cursor) =>
        this.resolveInternal(tenantId, principal, parentArtifactVersionId, nodeKey, context, cursor),
    };
  }

  private async resolveInternal(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    parentArtifactVersionId: string,
    nodeKey: string,
    context: Record<string, unknown>,
    cursor: NestedReferenceCursor,
  ): Promise<ArtifactReferenceResolution> {
    const maxDepth = this.config.get<number>('NESTED_TREE_MAX_DEPTH') ?? 5;
    if (cursor.depth > maxDepth) {
      throw new DomainException(
        'NESTED_TREE_MAX_DEPTH_EXCEEDED',
        `Nested execution depth ${cursor.depth} exceeds the configured maximum of ${maxDepth}`,
        HttpStatus.CONFLICT,
      );
    }
    const mySequence = ++cursor.sequence.value;
    const started = performance.now();

    const reference = await this.prisma.decisionArtifactReference.findFirst({
      where: { tenantId, parentArtifactVersionId: BigInt(parentArtifactVersionId), nodeKey },
    });
    if (!reference) {
      throw new DomainException(
        'REFERENCE_NOT_FOUND',
        `No artifact reference configured for node ${nodeKey}`,
        HttpStatus.CONFLICT,
      );
    }

    try {
      const compiledArtifact = await this.prisma.decisionCompiledArtifact.findFirst({
        where: { artifactVersionId: reference.childArtifactVersionId, compileStatus: 'SUCCESS' },
        orderBy: { compiledAt: 'desc' },
      });
      if (!compiledArtifact) {
        throw new DomainException(
          'CHILD_VERSION_NOT_COMPILED',
          'The referenced child version has no successful compiled artifact',
          HttpStatus.CONFLICT,
        );
      }
      const compiled = compiledArtifact.compiledPayloadJson as unknown as CompiledDecisionArtifact;
      const childVariables = this.buildInputVariables(
        reference.inputMappingJson as unknown as InputMappingEntry[],
        context,
      );
      const childCursor: NestedReferenceCursor = {
        sequence: cursor.sequence,
        parentSequence: mySequence,
        depth: cursor.depth + 1,
      };
      const result = await this.withTimeout(
        this.engine.execute(compiled, childVariables, this.bind(tenantId, principal), childCursor),
        reference.timeoutMs,
      );
      const durationMs = Math.round(performance.now() - started);
      const output = this.mapOutputs(reference.outputMappingJson as unknown as OutputMappingEntry[], result.output);
      const ownEntry: NestedExecutionTraceEntry = {
        sequence: mySequence,
        parentSequence: cursor.parentSequence,
        depth: cursor.depth,
        nodeKey,
        childArtifactVersionId: reference.childArtifactVersionId.toString(),
        status: 'SUCCEEDED',
        durationMs,
        output,
      };
      return { output, trace: [ownEntry, ...result.nestedExecutions] };
    } catch (error) {
      return this.handleError(reference, nodeKey, cursor, mySequence, Math.round(performance.now() - started), error);
    }
  }

  private handleError(
    reference: { onErrorPolicy: string; fallbackOutputJson: unknown; outputMappingJson: unknown },
    nodeKey: string,
    cursor: NestedReferenceCursor,
    sequence: number,
    durationMs: number,
    error: unknown,
  ): ArtifactReferenceResolution {
    const errorInfo = {
      code: error instanceof DomainException ? error.code : 'NESTED_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
    if (reference.onErrorPolicy === 'FALLBACK') {
      const output = (reference.fallbackOutputJson as Record<string, unknown> | null) ?? {};
      return {
        output,
        trace: [
          {
            sequence,
            parentSequence: cursor.parentSequence,
            depth: cursor.depth,
            nodeKey,
            childArtifactVersionId: null,
            status: 'FALLBACK',
            durationMs,
            output,
            error: errorInfo,
          },
        ],
      };
    }
    if (reference.onErrorPolicy === 'SKIP') {
      return {
        output: {},
        trace: [
          {
            sequence,
            parentSequence: cursor.parentSequence,
            depth: cursor.depth,
            nodeKey,
            childArtifactVersionId: null,
            status: 'SKIPPED',
            durationMs,
            error: errorInfo,
          },
        ],
      };
    }
    // FAIL (default): propagate so the parent execution fails closed.
    throw error instanceof DomainException
      ? error
      : new DomainException('NESTED_EXECUTION_FAILED', errorInfo.message, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private buildInputVariables(
    mapping: InputMappingEntry[],
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    const variables: Record<string, unknown> = {};
    for (const entry of mapping ?? []) {
      if (entry.source === 'LITERAL') {
        variables[entry.childVariableCode] = entry.value;
      } else if (entry.source === 'VARIABLE') {
        variables[entry.childVariableCode] = this.expressions.evaluate({ var: entry.path ?? '' }, context);
      } else if (entry.source === 'EXPRESSION') {
        variables[entry.childVariableCode] = this.expressions.evaluate(entry.expression, context);
      }
    }
    return variables;
  }

  /** Copies only the allowlisted child output codes through, unchanged. */
  private mapOutputs(
    mapping: OutputMappingEntry[],
    childOutput: Record<string, unknown>,
  ): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const entry of mapping ?? []) {
      output[entry.childOutputCode] = childOutput[entry.childOutputCode];
    }
    return output;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new DomainException(
            'NESTED_EXECUTION_TIMEOUT',
            `Nested artifact execution exceeded ${timeoutMs}ms`,
            HttpStatus.GATEWAY_TIMEOUT,
          ),
        );
      }, timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
