/**
 * Contratos HTTP de los workers adicionales (ADR-0026).
 *
 * Comparten archivo porque comparten el ciclo de vida —estado, progreso,
 * intentos, correlación— y el frontend pinta todas las vistas con el mismo
 * código. Lo que NO comparten (la entrada y el resultado) vive en clases
 * separadas: mezclarlo habría producido un DTO con la mitad de los campos
 * opcionales, que no valida nada.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AudioTemplateStrategy, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/http/pagination';

/**
 * Los workers que este motor publica.
 *
 * Una sola lista y no una por sitio: el catálogo, las métricas y cualquier ruta
 * que reciba un `:code` se validan contra ella, de modo que añadir un worker
 * tercero no deje una superficie contestando por un código que ya no existe.
 */
export const WORKER_CODES = [
  'semantic-analysis',
  'bank-statement',
  'identity-verification',
  'audio-tts',
] as const;
export type WorkerCode = (typeof WORKER_CODES)[number];

export function isWorkerCode(value: string): value is WorkerCode {
  return (WORKER_CODES as readonly string[]).includes(value);
}

/** Escenario de prueba servido al frontend. */
export class WorkerFixtureDto {
  @ApiProperty({ example: 'gasto-claro' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Qué demuestra este escenario.' }) description!: string;
  @ApiProperty({ description: 'Vista previa segura de la entrada.' }) preview!: string;
  @ApiProperty({
    description: 'Si se espera que el escenario termine en error controlado.',
  })
  expectsFailure!: boolean;
}

/** Disponibilidad y límites de un worker. Alimenta el encabezado de la vista. */
export class WorkerDescriptorDto {
  @ApiProperty({ example: 'semantic-analysis' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ description: 'Tipos de entrada que acepta.' }) acceptedInputs!: string[];
  @ApiProperty({ description: 'Restricciones publicadas al cliente.' })
  limits!: Record<string, number | string>;
  @ApiProperty({
    description:
      'Si el worker está habilitado en este despliegue. Un worker apagado acepta consultas pero no ejecuciones.',
  })
  available!: boolean;
  @ApiProperty({ description: 'Si los escenarios de prueba están habilitados.' })
  fixturesEnabled!: boolean;
}

/** Vista de una ejecución. Idéntica para los dos workers salvo el resultado. */
export class WorkerRunDto {
  @ApiProperty() requestId!: string;
  @ApiProperty({ enum: WorkerRunStatus }) status!: WorkerRunStatus;
  @ApiProperty({ minimum: 0, maximum: 100 }) progress!: number;
  @ApiProperty({ enum: WorkerInputSource }) inputSource!: WorkerInputSource;
  @ApiPropertyOptional() fixtureCode?: string | null;
  @ApiProperty() attemptCount!: number;
  @ApiProperty() queuedAt!: Date;
  @ApiPropertyOptional() startedAt?: Date | null;
  @ApiPropertyOptional() finishedAt?: Date | null;
  @ApiProperty() requestedBy!: string;
  @ApiProperty({ description: 'Para correlacionar con los registros del motor.' })
  correlationId!: string;
  @ApiPropertyOptional({ description: 'Resultado, cuando la ejecución terminó bien.' })
  result?: unknown;
  @ApiPropertyOptional({ description: 'Advertencias de un resultado utilizable pero revisable.' })
  warnings?: unknown;
  @ApiPropertyOptional() errorCode?: string | null;
  @ApiPropertyOptional() errorMessage?: string | null;
}

export class WorkerRunQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(WorkerRunStatus)
  @ApiPropertyOptional({ enum: WorkerRunStatus })
  status?: WorkerRunStatus;
}

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

/**
 * Alta de una ejecución de análisis semántico.
 *
 * O `text` o `fixtureCode`, nunca los dos: aceptar ambos obligaría a decidir
 * cuál gana, y esa decisión siempre sorprende a alguien. La exclusión se valida
 * en el servicio, donde se puede dar un mensaje que explique la regla.
 */
export class CreateSemanticAnalysisRunDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  @ApiPropertyOptional({ description: 'Texto a analizar. Excluyente con `fixtureCode`.' })
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @ApiPropertyOptional({ description: 'Escenario de prueba. Excluyente con `text`.' })
  fixtureCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({
    description:
      'Clave de deduplicación. Si se omite se deriva del contenido, de modo que reenviar el mismo texto no crea una segunda ejecución.',
  })
  idempotencyKey?: string;
}

/**
 * Alta de una conversión de extracto.
 *
 * El archivo viaja como `multipart/form-data`, así que aquí sólo van los campos
 * de texto que lo acompañan.
 */
export class CreateBankStatementRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @ApiPropertyOptional({
    description: 'Escenario de prueba. Excluyente con el archivo subido.',
  })
  fixtureCode?: string;
}

/**
 * Alta de una verificación de identidad.
 *
 * Las dos imágenes viajan como `multipart/form-data`, así que aquí sólo van los
 * campos de texto que las acompañan.
 */
export class CreateIdentityVerificationRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @ApiPropertyOptional({
    description: 'Escenario de prueba. Excluyente con las imágenes subidas.',
  })
  fixtureCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'documentCountry debe ser un código ISO 3166-1 alfa-2.' })
  @ApiPropertyOptional({
    description:
      'País emisor del documento, ISO 3166-1 alfa-2. Decide qué analizador se usa; si se omite se toma el del despliegue.',
    example: 'BO',
  })
  documentCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({
    description:
      'Clave de deduplicación. Sin ella se deriva del contenido de las imágenes, de modo que reenviar las mismas fotos no crea una segunda verificación.',
  })
  idempotencyKey?: string;
}

/**
 * Alta de una locución.
 *
 * O `templateCode` o `fixtureCode`, nunca los dos. **No hay campo de texto
 * libre**, y su ausencia es la decisión de diseño del worker, no una carencia:
 * lo que se puede decir con la voz de una organización lo fija su catálogo de
 * plantillas. Un cuadro de texto abierto convertiría cada usuario con permiso
 * en alguien capaz de poner cualquier frase en boca de la marca, y de gastar el
 * presupuesto del mes escribiendo.
 */
export class CreateAudioTtsRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @ApiPropertyOptional({
    description: 'Plantilla del catálogo a locutar. Excluyente con `fixtureCode`.',
    example: 'onboarding.welcome.named',
  })
  templateCode?: string;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({
    description:
      'Valores de las variables que declara la plantilla. El motor rechaza las que falten y las que no cumplan el formato permitido.',
    example: { name: 'Ana' },
  })
  variables?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @ApiPropertyOptional({
    description:
      'Idioma de la locución (etiqueta BCP-47). Si se omite se toma el de la plantilla y, en su defecto, el del despliegue. Forma parte de la identidad del audio: cambiarlo produce una locución distinta.',
    example: 'es-419',
  })
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @ApiPropertyOptional({ description: 'Escenario de prueba. Excluyente con `templateCode`.' })
  fixtureCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({
    description:
      'Clave de deduplicación. Sin ella se deriva de la plantilla, sus variables, el idioma y la voz vigente, de modo que repetir la misma locución no crea una segunda ejecución ni una segunda factura.',
  })
  idempotencyKey?: string;
}

/** Una plantilla de locución, tal como la ve quien va a usarla. */
export class AudioTemplateDto {
  @ApiProperty({ example: 'onboarding.welcome.named' }) code!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: AudioTemplateStrategy }) strategy!: AudioTemplateStrategy;
  @ApiProperty({ description: 'El texto, con sus variables entre llaves dobles.' })
  templateText!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) language!: string | null;
  @ApiProperty({
    type: [String],
    description: 'Variables que hay que rellenar. Se deducen del texto, no de una columna aparte.',
  })
  variables!: string[];
  @ApiProperty() isActive!: boolean;
}

/** Formatos de descarga del resultado del worker de extractos. */
export const STATEMENT_DOWNLOAD_FORMATS = ['csv', 'json', 'normalized'] as const;
export type StatementDownloadFormat = (typeof STATEMENT_DOWNLOAD_FORMATS)[number];

export class StatementDownloadQueryDto {
  @IsIn(STATEMENT_DOWNLOAD_FORMATS)
  @ApiProperty({
    enum: STATEMENT_DOWNLOAD_FORMATS,
    default: 'csv',
    description:
      'Formato del archivo. `csv`: los movimientos en tabla, con BOM para que Excel respete las tildes. `json`: solo los movimientos. `normalized`: el contrato normalizado completo, con la cuenta y los metadatos del extracto. En los tres casos la cuenta va enmascarada.',
  })
  format: StatementDownloadFormat = 'csv';
}
