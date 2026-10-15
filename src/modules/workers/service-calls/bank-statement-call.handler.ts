import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateStatementUpload } from '../bank-statement/bank-statement-input';
import { InstitutionCatalogService } from '../bank-statement/institutions/institution-catalog.service';
import { statementEngineOptions } from '../bank-statement/statement-engine-options';
import {
  createStatementEngine,
  type StatementEngine,
} from '../bank-statement/core/statement-engine';
import type { WorkerServiceOutcome } from '../../graph/graph.types';
import {
  assertAvailable,
  decodeBase64,
  stringArgument,
  timeoutFor,
  toDomainException,
  withTimeout,
  type WorkerServiceCall,
  type WorkerServiceHandler,
} from './worker-call';

/**
 * Convierte un extracto en PDF al contrato normalizado.
 *
 * El documento llega en base64 dentro de una variable de la decisión, y no como una
 * referencia a una subida previa, porque el nodo es una LLAMADA: pide el análisis del
 * documento que la petición trae, no el resultado de un trabajo que alguien encoló antes.
 */
@Injectable()
export class BankStatementCallHandler implements WorkerServiceHandler {
  readonly key = 'bank-statement.normalize';

  /**
   * Perezoso y memorizado, igual que en el worker de fondo: construir el motor arrastra
   * `pdfjs-dist` y registra los siete analizadores, y eso no puede pagarse por decisión.
   */
  private readonly statementEngines = new Map<string, StatementEngine>();

  constructor(
    private readonly config: ConfigService,
    private readonly institutions: InstitutionCatalogService,
  ) {}

  async handle({ tenantId, request, started }: WorkerServiceCall): Promise<WorkerServiceOutcome> {
    assertAvailable(
      'bank-statement',
      this.config.get<boolean>('BANK_STATEMENT_WORKER_ENABLED') ?? false,
      request.nodeKey,
    );

    // La MISMA validación que aplica la subida por HTTP: tamaño, firma real del contenido
    // y nombre seguro. Que un documento entre por un nodo en vez de por un formulario no
    // puede relajar lo que se acepta.
    const validated = validateStatementUpload(
      {
        originalname: stringArgument(request, 'fileName') ?? 'extracto.pdf',
        buffer: decodeBase64(request, 'documentBase64', 'bank-statement.normalize'),
      },
      this.config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760,
    );

    /*
     * Se ESPERA la primera carga del padrón, igual que hace el worker de fondo, y DESPUÉS de
     * validar el documento: un base64 inválido no tiene por qué pagar una consulta.
     *
     * En frío no hay instantánea, el padrón cae a la nómina compilada y `isAuthoritative()`
     * responde `false`. La compuerta de emisor se lo toma en serio —con razón: «licencia
     * vigente» sería entonces una afirmación que nadie comprobó— y manda el documento a
     * revisión con `padron-no-vigente`. Sin esta línea el PRIMER extracto que analiza un nodo
     * `WORKER` tras cada arranque acaba en la cola con un motivo que apunta a la entidad
     * cuando lo que pasó fue que el proceso acababa de empezar; y como se cura solo en el
     * documento siguiente, es de los defectos que nadie llega a diagnosticar.
     *
     * `bank-statement-run-worker.service.ts` ya lo hacía para la cola asíncrona; este camino
     * —el del grafo— se había quedado fuera. No reintroduce una espera por documento: con
     * instantánea, aunque esté vencida, devuelve al instante y refresca por detrás. Lo que se
     * espera es la carga inicial, una vez por tenant y por proceso.
     */
    await this.institutions.ensureLoaded(tenantId);

    try {
      const normalized = await withTimeout(
        this.statementEngineInstance(tenantId).normalize(validated.bytes, {
          fileName: validated.fileName,
        }),
        timeoutFor(request, this.config.get<number>('BANK_STATEMENT_TIMEOUT_MS') ?? 60_000),
        request,
      );
      const warnings = [...normalized.quality.warnings];
      return {
        status: warnings.length ? 'SUCCEEDED_WITH_WARNINGS' : 'SUCCEEDED',
        // Se entrega el contrato normalizado tal cual, que ya viene con la cuenta
        // enmascarada por el propio motor. La decisión solo verá los trozos que el nodo
        // proyecte, y cada uno pasa por la política de traza de su intermedia.
        result: normalized as unknown as Record<string, unknown>,
        warnings,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      throw toDomainException(error, request);
    }
  }

  /**
   * Un motor por tenant, por lo mismo que en el worker asíncrono: el padrón de
   * entidades es tenant-scoped, y uno compartido atribuiría los documentos de un
   * cliente contra las entidades que administró otro.
   */
  private statementEngineInstance(tenantId: bigint): StatementEngine {
    const key = tenantId.toString();
    let engine = this.statementEngines.get(key);
    if (engine) return engine;
    engine = createStatementEngine(
      statementEngineOptions(this.config, this.institutions, tenantId),
    );
    this.statementEngines.set(key, engine);
    return engine;
  }
}
