import { ApiProperty } from '@nestjs/swagger';

class QaCounterexampleDto {
  @ApiProperty({ example: '11001' }) id!: string;
  @ApiProperty({
    example: 'OUTPUT_CONTRACT_RESPECTED',
    enum: [
      'INPUT_CONTRACT_ENFORCED',
      'OUTPUT_CONTRACT_RESPECTED',
      'OUTPUT_TYPES_MATCH_CONTRACT',
      'NO_INTERMEDIATE_LEAK',
      'NO_SENSITIVE_LEAK',
      'DETERMINISM',
    ],
  })
  property!: string;
  @ApiProperty({ example: 'UNEXPECTED_ENGINE_ERROR' }) failureCode!: string;
  @ApiProperty({ example: 'Output "approved_limit" missing when status is APPROVED' })
  failureMessage!: string;
  @ApiProperty({ description: 'Entrada mínima reducida que sigue reproduciendo el fallo.' })
  shrunkInput!: Record<string, unknown>;
  @ApiProperty({
    required: false,
    description: 'Entrada aleatoria original, antes de reducir. Solo en `getRun`.',
  })
  originalInput?: Record<string, unknown>;
  @ApiProperty({ required: false, nullable: true, description: 'Solo en `getRun`.' })
  observed?: unknown;
  @ApiProperty({ example: 'qa-4f8c...' }) replaySeed!: string;
  @ApiProperty({ example: '42/BOUNDARY' }) replayPath!: string;
  @ApiProperty({ required: false, nullable: true, description: 'Solo en `getRun`.' })
  resolvedAt?: string | null;
}

/** `QaLabService.listRuns`: fila resumida, con el conteo de contraejemplos en vez del detalle. */
export class QaRunListItemDto {
  @ApiProperty({ example: '10001' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 'UAT' }) environmentCode!: string;
  @ApiProperty({ example: 'COMPLETED', enum: ['RUNNING', 'COMPLETED', 'FAILED'] }) status!: string;
  @ApiProperty({ example: 'qa-4f8c...' }) seed!: string;
  @ApiProperty({ example: '1.0' }) generatorVersion!: string;
  @ApiProperty({ example: 500 }) totalCases!: number;
  @ApiProperty({ example: 495 }) passedCases!: number;
  @ApiProperty({ example: 5 }) failedCases!: number;
  @ApiProperty({ example: 0 }) erroredCases!: number;
  @ApiProperty({ example: 8420 }) durationMs!: number;
  @ApiProperty({
    example: 5,
    description: 'Conteo de contraejemplos; ver `getRun` para el detalle.',
  })
  counterexamples!: number;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) startedAt!: string;
  @ApiProperty({ nullable: true }) finishedAt!: string | null;
}

/** `QaLabService.presentRun`: forma común de `run` (201) y `getRun` (200). */
export class QaRunDto {
  @ApiProperty({ example: '10001' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 'UAT' }) environmentCode!: string;
  @ApiProperty({ example: 'COMPLETED', enum: ['RUNNING', 'COMPLETED', 'FAILED'] }) status!: string;
  @ApiProperty({ example: 'qa-4f8c...' }) seed!: string;
  @ApiProperty({ example: '1.0' }) generatorVersion!: string;
  @ApiProperty({
    example: { generator: '1.0', node: 'v20.11.0', faker: '9.0.0', fastCheck: '3.0.0' },
  })
  tooling!: Record<string, unknown>;
  @ApiProperty({ example: 500 }) totalCases!: number;
  @ApiProperty({ example: 495 }) passedCases!: number;
  @ApiProperty({ example: 5 }) failedCases!: number;
  @ApiProperty({ example: 0 }) erroredCases!: number;
  @ApiProperty({ example: 8420 }) durationMs!: number;
  @ApiProperty({
    example: 512,
    description:
      'Casos que la corrida va a ejecutar en total. Mientras está `RUNNING`, `totalCases` sólo cuenta los ya ejecutados: el avance es `totalCases` sobre esto. Vale 0 en corridas anteriores a este campo.',
  })
  plannedCases!: number;
  @ApiProperty({
    example: { OUTPUT_CONTRACT_RESPECTED: 5 },
    description:
      'Conteo por propiedad violada. En una corrida `FAILED` trae en su lugar `{ failureCode, failureMessage }`: el motivo por el que se abortó.',
  })
  summary!: Record<string, unknown>;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) startedAt!: string;
  @ApiProperty({ nullable: true }) finishedAt!: string | null;
  @ApiProperty({ type: [QaCounterexampleDto] }) counterexamples!: QaCounterexampleDto[];
}

class ExecutionObservationDto {
  @ApiProperty({ example: true }) inputAccepted!: boolean;
  @ApiProperty() output!: Record<string, unknown>;
  @ApiProperty({ example: 'SUCCEEDED' }) status!: string;
  @ApiProperty({ example: 'SUCCEEDED:{"approved_limit":1500}' }) signature!: string;
  @ApiProperty({ required: false, example: 'UNEXPECTED_ENGINE_ERROR' }) errorCode?: string;
}

class PropertyViolationDto {
  @ApiProperty({
    example: 'OUTPUT_CONTRACT_RESPECTED',
    enum: [
      'INPUT_CONTRACT_ENFORCED',
      'OUTPUT_CONTRACT_RESPECTED',
      'OUTPUT_TYPES_MATCH_CONTRACT',
      'NO_INTERMEDIATE_LEAK',
      'NO_SENSITIVE_LEAK',
      'DETERMINISM',
    ],
  })
  property!: string;
  @ApiProperty({ example: 'UNEXPECTED_ENGINE_ERROR' }) failureCode!: string;
  @ApiProperty() failureMessage!: string;
  @ApiProperty({ required: false, nullable: true }) observed?: unknown;
}

/** `QaLabService.replay`. */
export class QaReplayResultDto {
  @ApiProperty({ example: '11001' }) id!: string;
  @ApiProperty({
    example: true,
    description: 'Si la entrada reducida sigue reproduciendo el mismo fallo.',
  })
  reproduced!: boolean;
  @ApiProperty() input!: Record<string, unknown>;
  @ApiProperty({ type: ExecutionObservationDto }) observation!: ExecutionObservationDto;
  @ApiProperty({ type: [PropertyViolationDto] }) violations!: PropertyViolationDto[];
}
