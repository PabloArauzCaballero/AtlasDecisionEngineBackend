import { ApiProperty } from '@nestjs/swagger';

/** De dónde salieron los valores con significado del lote (`QaFakersService`). */
export class QaFakerReportDto {
  @ApiProperty({
    example: 'mock',
    enum: ['mock', 'local-fallback', 'none'],
    description:
      '`mock`: nombre, carnet, celular, ingreso… salieron de los fakers del servidor mock. `local-fallback`: el mock no respondió y todo salió del generador local del contrato (ver `reason`). `none`: ninguna variable del contrato tiene un nombre que diga qué dato es.',
  })
  source!: string;
  @ApiProperty({ required: false, example: 'El servidor de fakers no respondió en 4000 ms.' })
  reason?: string;
  @ApiProperty({
    example: { ci: 'persona.documentNumber', celular: 'persona.phone' },
    description: 'Variable del contrato → dato del faker que le corresponde.',
  })
  mappedVariables!: Record<string, string>;
  @ApiProperty({
    example: 812,
    description: 'Valores sustituidos de verdad: el contrato puede rechazar alguno.',
  })
  replacedValues!: number;
  @ApiProperty({ example: ['caso'], type: [String] }) types!: string[];
  @ApiProperty({ required: false, example: '2.0.0' }) schemaVersion?: string;
}

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
  @ApiProperty({
    example: 'EN_PROCESO',
    description:
      'Histórico. El QA Lab no ejecuta contra ningún ambiente: corre dentro del proceso de la API sin persistir ejecuciones. Las corridas nuevas archivan `EN_PROCESO`; las antiguas conservan el valor que se eligió entonces, que no cambiaba nada.',
  })
  environmentCode!: string;
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
  @ApiProperty({
    example: 512,
    description:
      'Casos que la corrida iba a ejecutar. Mientras está `RUNNING`, `totalCases` sólo cuenta los ya ejecutados. Vale 0 en corridas anteriores al campo.',
  })
  plannedCases!: number;
  @ApiProperty({
    // `type` explícito: de `number | null` Swagger infiere `object`, y entonces el
    // ejemplo contradice el esquema que él mismo publicó. Lo detecta `redocly lint`.
    type: Number,
    example: 1,
    nullable: true,
    description:
      'Casos ejecutados a la vez. `null` en corridas que no la archivaron. Sin este dato, `durationMs / totalCases` NO es comparable entre corridas.',
  })
  concurrency!: number | null;
  @ApiProperty({
    type: Boolean,
    example: true,
    nullable: true,
    description:
      'Si cada caso se ejecutó DOS veces para comprobar determinismo. Duplica el trabajo real de la corrida, así que condiciona cualquier lectura de rendimiento.',
  })
  checkDeterminism!: boolean | null;
  @ApiProperty({
    type: String,
    enum: ['TIMEOUT', 'FIRST_FAILURE'],
    nullable: true,
    example: null,
    description:
      'Por qué una corrida terminada NO ejecutó todos los casos planificados: `TIMEOUT` (tiempo máximo agotado) o `FIRST_FAILURE` (se pidió parar en el primer contraejemplo). `null` si los recorrió todos.',
  })
  stoppedReason!: string | null;
  @ApiProperty({
    type: String,
    enum: ['mock', 'local-fallback', 'none'],
    nullable: true,
    example: 'mock',
    description: 'Origen de los datos realistas del lote. `null` en corridas anteriores al campo.',
  })
  fakerSource!: string | null;
}

/** `QaLabService.presentRun`: forma común de `run` (201) y `getRun` (200). */
export class QaRunDto {
  @ApiProperty({ example: '10001' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({
    example: 'EN_PROCESO',
    description:
      'Histórico. El QA Lab no ejecuta contra ningún ambiente: corre dentro del proceso de la API sin persistir ejecuciones. Las corridas nuevas archivan `EN_PROCESO`; las antiguas conservan el valor que se eligió entonces, que no cambiaba nada.',
  })
  environmentCode!: string;
  @ApiProperty({ example: 'COMPLETED', enum: ['RUNNING', 'COMPLETED', 'FAILED'] }) status!: string;
  @ApiProperty({ example: 'qa-4f8c...' }) seed!: string;
  @ApiProperty({ example: '1.0' }) generatorVersion!: string;
  @ApiProperty({
    example: {
      generator: 'atlas-qa-generator-1.3.0',
      node: 'v22.11.0',
      fakers: 'atlas-external-providers-mock/fakers@2.0.0',
    },
    description:
      'Versiones de lo que produjo el lote. `fakers` es `null` cuando el lote salió del generador local.',
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
  @ApiProperty({
    type: String,
    enum: ['TIMEOUT', 'FIRST_FAILURE'],
    nullable: true,
    example: null,
    description:
      'Por qué una corrida `COMPLETED` no ejecutó todos los casos: `TIMEOUT` o `FIRST_FAILURE`. `null` si los recorrió todos.',
  })
  stoppedReason!: string | null;
  @ApiProperty({
    example: 512,
    description: 'Casos ejecutados de verdad. Con `stoppedReason` es menor que `plannedCases`.',
  })
  executedCases!: number;
  @ApiProperty({
    type: QaFakerReportDto,
    nullable: true,
    description: 'Origen de los datos realistas del lote. `null` en corridas anteriores al campo.',
  })
  fakers!: QaFakerReportDto | null;
  @ApiProperty({
    description:
      'Configuración archivada con la que se lanzó: número de casos, mezcla, pesos por desenlace, distribuciones, concurrencia, tiempo máximo… Reenviarla con la misma semilla contra la misma versión reproduce el lote.',
  })
  config!: Record<string, unknown>;
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
  @ApiProperty({
    example: 'INVALID',
    enum: ['VALID', 'BOUNDARY', 'INVALID'],
    description: 'Clase con la que se reejecutó: la del caso original, no siempre VÁLIDO.',
  })
  kind!: string;
  @ApiProperty({ example: 'INPUT_CONTRACT_ENFORCED' }) property!: string;
  @ApiProperty({
    example: 1,
    description:
      'Ejecuciones hechas. Un fallo de DETERMINISMO se repite varias veces y se comparan.',
  })
  executions!: number;
  @ApiProperty() input!: Record<string, unknown>;
  @ApiProperty({ type: ExecutionObservationDto }) observation!: ExecutionObservationDto;
  @ApiProperty({ type: [PropertyViolationDto] }) violations!: PropertyViolationDto[];
}
