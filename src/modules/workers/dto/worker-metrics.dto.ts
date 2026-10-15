import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkerRunStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Ventana de observación de las métricas.
 *
 * Una semana por omisión: es el periodo en el que un operador todavía reconoce
 * lo que pasó y a la vez hay suficientes ejecuciones para que un percentil
 * signifique algo. El techo son treinta días porque más allá la cifra deja de
 * describir el estado ACTUAL del worker y empieza a describir su historia, que
 * es lo que se consulta en el listado de ejecuciones.
 */
export class WorkerMetricsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  @ApiPropertyOptional({
    default: 168,
    minimum: 1,
    maximum: 720,
    description: 'Horas hacia atrás sobre las que se calcula todo. Por omisión, 7 días.',
  })
  windowHours = 168;
}

/**
 * Latencias del worker, en milisegundos.
 *
 * El **proceso** (de que un worker la toma a que termina) va separado de la
 * **espera** en cola a propósito: sumarlos escondería cuál de los dos crece, y
 * son dos problemas distintos —falta capacidad, o el trabajo se encareció—.
 *
 * Todo puede ser `null`, y eso NO es un cero: significa que en la ventana no
 * hubo ninguna ejecución de la que medirlo. Un cero afirmaría «tardó nada».
 */
export class WorkerLatencyDto {
  @ApiPropertyOptional({ type: Number, nullable: true }) p50Ms!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) p95Ms!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) p99Ms!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) maxMs!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) avgWaitMs!: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) maxWaitMs!: number | null;
  @ApiProperty({ description: 'Ejecuciones terminadas de las que salieron estas cifras.' })
  samples!: number;
}

/** Lo que el worker tiene delante ahora mismo, sin depender de la ventana. */
export class WorkerQueueDto {
  @ApiProperty({ description: 'Encoladas, esperando a que un worker las tome.' }) queued!: number;
  @ApiProperty({ description: 'En proceso ahora mismo.' }) running!: number;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Cuándo se encoló la más antigua que sigue esperando. Es la señal de que falta capacidad.',
  })
  oldestQueuedAt!: Date | null;
}

/**
 * Un fallo, agrupado por su código.
 *
 * Agrupado y no una lista cronológica: veinte filas con el mismo `TIMEOUT` son
 * UNA incidencia ocurrida veinte veces, y publicarlas sueltas esconde que hay
 * una sola cosa que arreglar. Se conserva el rastro de la más reciente, que es
 * por donde se sigue en los registros del motor.
 */
export class WorkerIncidentDto {
  @ApiProperty({ example: 'PDF_EXTRACTION_FAILED' }) code!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) message!: string | null;
  @ApiProperty() count!: number;
  @ApiProperty() lastOccurredAt!: Date;
  @ApiProperty() lastRequestId!: string;
  @ApiProperty() lastCorrelationId!: string;
  @ApiProperty({ description: 'Intentos que consumió la última antes de rendirse.' })
  lastAttemptCount!: number;
}

/** Reparto de la ventana por estado. Un elemento por estado presente. */
export class WorkerStatusCountDto {
  @ApiProperty({ enum: WorkerRunStatus }) status!: WorkerRunStatus;
  @ApiProperty() count!: number;
}

/**
 * Salud de un worker: lo que hace falta para decidir si se puede contar con él.
 *
 * Se calcula en el motor y no en el cliente. La interfaz lo derivaba de una
 * página de ejecuciones, así que sus percentiles describían las cincuenta filas
 * que le cupieron, no la ventana; y cada cliente que quisiera lo mismo tendría
 * que reimplementar la misma aritmética, con el riesgo de que dos pantallas
 * dieran cifras distintas del mismo worker.
 */
export class WorkerMetricsDto {
  @ApiProperty({ example: 'bank-statement' }) worker!: string;
  @ApiProperty({ description: 'Nombre legible, el mismo que publica el catálogo.' }) name!: string;
  @ApiProperty({ description: 'Si el worker está encendido en este despliegue.' })
  available!: boolean;

  @ApiProperty({ description: 'Inicio de la ventana observada.' }) windowFrom!: Date;
  @ApiProperty({ description: 'Instante en que se calculó.' }) computedAt!: Date;
  @ApiProperty() windowHours!: number;

  @ApiProperty({ description: 'Ejecuciones encoladas dentro de la ventana.' })
  totalRuns!: number;
  @ApiProperty({ description: 'De ésas, cuántas llegaron a un final (sin contar canceladas).' })
  finishedRuns!: number;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Porcentaje con resultado utilizable sobre las terminadas. `null` si no terminó ninguna: un 0 % afirmaría que todas fallaron.',
  })
  successRate!: number | null;

  @ApiProperty({ type: [WorkerStatusCountDto] }) statusMix!: WorkerStatusCountDto[];
  @ApiProperty({ type: WorkerLatencyDto }) latency!: WorkerLatencyDto;
  @ApiProperty({ type: WorkerQueueDto }) queue!: WorkerQueueDto;
  @ApiProperty({ type: [WorkerIncidentDto] }) incidents!: WorkerIncidentDto[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Última ejecución encolada dentro de la ventana.',
  })
  lastRunAt!: Date | null;
}
