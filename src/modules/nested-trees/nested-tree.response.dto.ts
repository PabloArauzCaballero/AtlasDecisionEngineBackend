import { ApiProperty } from '@nestjs/swagger';

/** Forma real de `decision_artifact_reference`, tal como la devuelve Prisma. */
export class ArtifactReferenceDto {
  @ApiProperty({ example: '9001' }) id!: string;
  @ApiProperty({ example: '1200' }) tenantId!: string;
  @ApiProperty({ example: '4001' }) parentArtifactVersionId!: string;
  @ApiProperty({ example: 'CHECK_BUREAU_SCORE' }) nodeKey!: string;
  @ApiProperty({ example: '4200' }) childArtifactId!: string;
  @ApiProperty({ example: '4201' }) childArtifactVersionId!: string;
  @ApiProperty({
    description: '`{ [childInputVariableCode]: { source: "VARIABLE"|"LITERAL", path?, value? } }`',
  })
  inputMappingJson!: Record<string, unknown>;
  @ApiProperty({ description: '`{ [parentContextKey]: childOutputCode }`' })
  outputMappingJson!: Record<string, unknown>;
  @ApiProperty({ example: 2000 }) timeoutMs!: number;
  @ApiProperty({ example: 'FAIL', enum: ['FAIL', 'DEFAULT', 'SKIP'] }) onErrorPolicy!: string;
  @ApiProperty({ nullable: true, description: 'Solo cuando `onErrorPolicy` es `DEFAULT`.' })
  fallbackOutputJson!: Record<string, unknown> | null;
  @ApiProperty({
    nullable: true,
    example: null,
    description: 'Ambiente del hijo; `null` = el del padre.',
  })
  environmentCode!: string | null;
  @ApiProperty({ example: 'EXACT', enum: ['EXACT', 'ACTIVE_IN_ENVIRONMENT'] })
  versionSelection!: string;
  @ApiProperty({ example: 0 }) maxRetries!: number;
  @ApiProperty({ example: 0 }) retryDelayMs!: number;
  @ApiProperty({ nullable: true }) executionConditionJson!: Record<string, unknown> | null;
  @ApiProperty({ example: true }) isRequired!: boolean;
  @ApiProperty({ example: 'FULL', enum: ['FULL', 'MASKED', 'REDACTED', 'EXCLUDED'] })
  tracePolicy!: string;
  @ApiProperty({ nullable: true, description: 'Rol exigido para modificar la referencia.' })
  requiredRole!: string | null;
  @ApiProperty({ example: 'analyst@atlas.local' }) createdBy!: string;
  @ApiProperty({ example: '2026-07-31T13:00:00.000Z' }) createdAt!: string;
}

class DependencyGraphNodeDto {
  @ApiProperty({ example: '4200' }) artifactId!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 'Credit limit assignment' }) name!: string;
}

class DependencyGraphEdgeDto {
  @ApiProperty({ example: '4001' }) parentArtifactVersionId!: string;
  @ApiProperty({ example: '4000' }) parentArtifactId!: string;
  @ApiProperty({ example: '4200' }) childArtifactId!: string;
  @ApiProperty({ example: '4201' }) childArtifactVersionId!: string;
  @ApiProperty({ example: 'CHECK_BUREAU_SCORE' }) nodeKey!: string;
}

/** Dependencias y dependientes de un artefacto, acotadas por `NESTED_TREE_MAX_DEPTH`. */
export class DependencyGraphResponseDto {
  @ApiProperty({ type: [DependencyGraphNodeDto] }) nodes!: DependencyGraphNodeDto[];
  @ApiProperty({ type: [DependencyGraphEdgeDto] }) edges!: DependencyGraphEdgeDto[];
  @ApiProperty({ example: 5, description: 'Profundidad máxima explorada en cada dirección.' })
  maxDepth!: number;
  @ApiProperty({ example: 2000, description: 'Cota de aristas antes de truncar la vista.' })
  maxEdges!: number;
  @ApiProperty({
    example: false,
    description:
      'Cierto si el grafo real tiene más aristas que `maxEdges` y esta vista está incompleta.',
  })
  truncated!: boolean;
}
