import { Controller, Get, HttpStatus, Param, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DomainException } from '../../common/errors/domain-exception';
import { ApiArrayResponse } from '../../common/http/pagination.dto';
import { Roles, TenantId } from '../../common/security/security.decorators';
import { WorkerMetricsService } from './worker-metrics.service';
import {
  isWorkerCode,
  WorkerDescriptorDto,
  WorkerMetricsDto,
  WorkerMetricsQueryDto,
} from './workers.dto';

/**
 * Catálogo y salud de los workers adicionales.
 *
 * Existe para que la interfaz no lleve cableados los límites ni la
 * disponibilidad. Un portal que codifica «máximo 10 MiB» en su formulario
 * miente en cuanto alguien cambia la variable de entorno del motor, y el
 * usuario descubre el límite real al recibir un rechazo.
 *
 * Lo que **no** publica: `processingTimeoutMs`, la concurrencia y el número de
 * intentos. Son el presupuesto de recursos del servidor; no ayudan a quien
 * llama de buena fe y sí a quien busca dónde apretar.
 *
 * Aquí vive lo que los dos workers COMPARTEN —el catálogo y la forma de sus
 * ejecuciones—; lo que no comparten (entrada, resultado, descargas) vive en el
 * controlador de cada uno.
 */
@ApiTags('Workers')
@Controller('v1/workers')
export class WorkersController {
  constructor(
    private readonly config: ConfigService,
    private readonly metrics: WorkerMetricsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Workers disponibles, con sus límites y disponibilidad' })
  @ApiArrayResponse('Catálogo de workers adicionales.', WorkerDescriptorDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  list(): WorkerDescriptorDto[] {
    return this.catalog();
  }

  /**
   * Salud de un worker: reparto por estado, latencia, cola e incidencias.
   *
   * Los mismos roles que el catálogo y que el listado de ejecuciones: estas
   * cifras se derivan de filas que esos roles ya pueden leer una a una, así que
   * exigir más aquí sólo empujaría a reconstruirlas a mano desde el listado.
   *
   * No incluye ningún dato de la entrada procesada —ni texto, ni nombre de
   * archivo, ni resultado—: son contadores y tiempos. Es lo que permite que un
   * rol de auditoría vea la salud del worker sin ver lo que analizó.
   */
  @Get(':code/metrics')
  @ApiOperation({ summary: 'Salud, latencia, cola e incidencias de un worker' })
  @ApiOkResponse({ type: WorkerMetricsDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async workerMetrics(
    @TenantId() tenantId: bigint,
    @Param('code') code: string,
    @Query() query: WorkerMetricsQueryDto,
  ): Promise<WorkerMetricsDto> {
    if (!isWorkerCode(code)) {
      throw new DomainException(
        'WORKER_NOT_FOUND',
        'Este motor no publica ningún worker con ese código.',
        HttpStatus.NOT_FOUND,
        { code },
      );
    }
    const descriptor = this.catalog().find((worker) => worker.code === code)!;
    const collected = await this.metrics.collect(tenantId, code, query.windowHours);

    return {
      worker: descriptor.code,
      name: descriptor.name,
      available: descriptor.available,
      windowHours: query.windowHours,
      computedAt: new Date(),
      ...collected,
    };
  }

  /** Los descriptores, resueltos contra la configuración de este despliegue. */
  private catalog(): WorkerDescriptorDto[] {
    const fixturesEnabled = this.config.get<boolean>('WORKERS_FIXTURES_ENABLED') ?? false;

    return [
      {
        code: 'semantic-analysis',
        name: 'Análisis semántico',
        description:
          'Clasifica un texto libre contra el catálogo de categorías, resolviendo entidades, montos y fechas. Devuelve la categoría, su confianza y la evidencia que la sostiene.',
        acceptedInputs: ['Texto libre', 'Escenario de prueba'],
        limits: {
          maxTextLength: this.config.get<number>('SEMANTIC_ANALYSIS_MAX_TEXT_LENGTH') ?? 8_000,
        },
        // Un worker sin proveedor de modelo configurado no puede clasificar. Se
        // declara no disponible en vez de aceptar trabajo que fallará: es la
        // diferencia entre una pantalla que lo explica y una cola de errores.
        available:
          (this.config.get<boolean>('SEMANTIC_ANALYSIS_WORKER_ENABLED') ?? false) &&
          (this.config.get<string>('SEMANTIC_ANALYSIS_PROVIDER') ?? '') !== '',
        fixturesEnabled,
      },
      {
        code: 'bank-statement',
        name: 'Extractos bancarios',
        description:
          'Convierte un extracto bancario boliviano en PDF a movimientos normalizados, con su nivel de confianza. El número de cuenta se publica siempre enmascarado y el documento no se conserva.',
        acceptedInputs: ['Archivo PDF', 'Escenario de prueba'],
        limits: {
          maxUploadBytes: this.config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760,
          maxFiles: 1,
          acceptedMimeTypes: 'application/pdf',
        },
        available: this.config.get<boolean>('BANK_STATEMENT_WORKER_ENABLED') ?? false,
        fixturesEnabled,
      },
    ];
  }
}
