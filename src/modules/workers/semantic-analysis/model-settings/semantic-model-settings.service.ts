import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SemanticModelSetting } from '@prisma/client';
import { runsBackgroundJobs } from '../../../../common/config/worker-role';
import { DomainException } from '../../../../common/errors/domain-exception';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { DEFAULT_DEEP_ALIAS, DEFAULT_FAST_ALIAS } from '../core/config/litellm-provider.config';
import {
  DEFAULT_OPENROUTER_DEEP_MODEL,
  DEFAULT_OPENROUTER_FAST_MODEL,
} from '../core/config/openrouter-provider.config';
import type { ModelGateway } from './semantic-model-settings.dto';
import {
  fromEnum,
  type ChangeListener,
  type EffectiveModelSettings,
} from './semantic-model-settings.shape';
export type { EffectiveModelSettings } from './semantic-model-settings.shape';

/** La fila es la tabla: una configuración por despliegue. */
export const SINGLETON_ID = 1;

/**
 * Cada cuánto un worker vuelve a mirar la versión de la fila. Diez segundos:
 * un cambio desde el portal tarda como mucho eso en surtir efecto en cada
 * réplica, y el precio es una consulta de una fila por réplica cada diez
 * segundos, que no se nota en ningún sitio.
 */
const DEFAULT_REFRESH_MS = 10_000;

/** Modos del despliegue en los que la elección de gateway tiene efecto. */
const MODES_WITH_REMOTE_GATEWAY: ReadonlySet<string> = new Set([
  'litellm',
  'openrouter',
  'cascade',
]);

/**
 * La configuración del proveedor de modelo del worker semántico, resuelta
 * contra la fila del portal y, en su defecto, contra el entorno.
 *
 * ## Dos procesos, una fila
 *
 * Quien escribe es la API, en la petición de quien pulsa «Guardar». Quien tiene
 * que enterarse es el WORKER, que es otro proceso —otra réplica, a veces otra
 * máquina— con su proveedor ya construido y su caché de clasificación llena.
 * No hay canal entre los dos salvo la base, así que el worker sondea la
 * versión de la fila cada pocos segundos y, cuando cambia, avisa a quien se
 * haya suscrito: el puente del proveedor la reconstruye y vacía la caché.
 *
 * Sondear y no escuchar (`pg_notify`, Redis) es una decisión de coste: una
 * consulta de una fila cada diez segundos por réplica frente a un mecanismo
 * más que puede fallar en silencio. La demora de hasta diez segundos es
 * aceptable para un cambio que antes exigía un redespliegue.
 *
 * ## Qué NO guarda
 *
 * Credenciales. Un gateway se puede elegir sólo si el proceso ya tiene su clave
 * en el entorno; el portal sabe si la tiene, nunca cuál es.
 */
@Injectable()
export class SemanticModelSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SemanticModelSettingsService.name);
  private readonly listeners = new Set<ChangeListener>();
  private cached: { readonly value: EffectiveModelSettings; readonly readAt: number } | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * El sondeo sólo corre donde corre el worker: una réplica de API se entera
   * porque es ella quien escribe, y una con el worker apagado no clasifica.
   */
  onModuleInit(): void {
    if (!runsBackgroundJobs(this.config)) return;
    if (!(this.config.get<boolean>('SEMANTIC_ANALYSIS_WORKER_ENABLED') ?? false)) return;
    if (!this.applies()) return;
    const refreshMs =
      this.config.get<number>('SEMANTIC_MODEL_SETTINGS_REFRESH_MS') ?? DEFAULT_REFRESH_MS;
    this.timer = setInterval(() => {
      void this.refreshIfChanged();
    }, refreshMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Modo del despliegue: `SEMANTIC_ANALYSIS_PROVIDER`. */
  mode(): string {
    return this.config.get<string>('SEMANTIC_ANALYSIS_PROVIDER') ?? '';
  }

  /** Si la elección de gateway tiene algún efecto en este despliegue. */
  applies(): boolean {
    return MODES_WITH_REMOTE_GATEWAY.has(this.mode());
  }

  /** Si el proceso tiene la credencial del gateway. Nunca dice cuál. */
  available(gateway: ModelGateway): boolean {
    const variable = gateway === 'openrouter' ? 'OPENROUTER_API_KEY' : 'LITELLM_API_KEY';
    return (this.config.get<string>(variable) ?? '').trim().length > 0;
  }

  /** Lo que dicta el entorno para un gateway, con o sin fila del portal. */
  environmentDefaults(gateway: ModelGateway): { fastModel: string; deepModel: string } {
    if (gateway === 'openrouter') {
      return {
        fastModel:
          this.config.get<string>('OPENROUTER_FAST_MODEL') ?? DEFAULT_OPENROUTER_FAST_MODEL,
        deepModel:
          this.config.get<string>('OPENROUTER_DEEP_MODEL') ?? DEFAULT_OPENROUTER_DEEP_MODEL,
      };
    }
    return {
      fastModel: this.config.get<string>('LITELLM_FAST_MODEL') ?? DEFAULT_FAST_ALIAS,
      deepModel: this.config.get<string>('LITELLM_DEEP_MODEL') ?? DEFAULT_DEEP_ALIAS,
    };
  }

  /** El gateway que el entorno elegiría sin fila del portal. */
  environmentGateway(): ModelGateway {
    const mode = this.mode();
    if (mode === 'openrouter') return 'openrouter';
    if (mode === 'cascade') {
      return this.config.get<string>('SEMANTIC_CASCADE_REMOTE_PROVIDER') === 'openrouter'
        ? 'openrouter'
        : 'litellm';
    }
    return 'litellm';
  }

  /**
   * La configuración efectiva, con una memoria corta para no consultar la base
   * en cada clasificación. El sondeo del worker la refresca al cambiar la
   * versión; la escritura desde la API la invalida en el acto.
   */
  async current(): Promise<EffectiveModelSettings> {
    const refreshMs =
      this.config.get<number>('SEMANTIC_MODEL_SETTINGS_REFRESH_MS') ?? DEFAULT_REFRESH_MS;
    if (this.cached !== undefined && Date.now() - this.cached.readAt < refreshMs) {
      return this.cached.value;
    }
    const row = await this.prisma.semanticModelSetting.findUnique({ where: { id: SINGLETON_ID } });
    const value = this.effectiveOf(row);
    this.cached = { value, readAt: Date.now() };
    return value;
  }

  /** Lo último resuelto, sin consultar. Para quien necesita un nombre en un camino síncrono. */
  peek(): EffectiveModelSettings | undefined {
    return this.cached?.value;
  }

  /** Avisa cuando la configuración cambia, en este proceso o —vía sondeo— en otro. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  assertAvailable(gateway: ModelGateway): void {
    if (this.available(gateway)) return;
    const variable = gateway === 'openrouter' ? 'OPENROUTER_API_KEY' : 'LITELLM_API_KEY';
    throw new DomainException(
      'SEMANTIC_MODEL_GATEWAY_UNAVAILABLE',
      `Este despliegue no tiene credencial para ${gateway}: falta ${variable} en el entorno del motor. ` +
        'La credencial no se configura desde el portal.',
      HttpStatus.CONFLICT,
      { gateway, variable },
    );
  }

  assertApplies(): void {
    if (this.applies()) return;
    throw new DomainException(
      'SEMANTIC_MODEL_SETTINGS_NOT_APPLICABLE',
      `Este despliegue clasifica con SEMANTIC_ANALYSIS_PROVIDER=${this.mode() || '(vacío)'}, que no usa ` +
        'ningún gateway remoto: la elección de gateway no tendría efecto. El modo se cambia en el entorno.',
      HttpStatus.CONFLICT,
      { mode: this.mode() },
    );
  }

  private effectiveOf(row: SemanticModelSetting | null): EffectiveModelSettings {
    if (row === null) {
      const gateway = this.environmentGateway();
      return {
        gateway,
        ...this.environmentDefaults(gateway),
        source: 'environment',
        version: 0,
        updatedBy: null,
        updatedAt: null,
      };
    }
    return {
      gateway: fromEnum(row.gateway),
      fastModel: row.fastModel,
      deepModel: row.deepModel,
      source: 'portal',
      version: row.version,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  private async refreshIfChanged(): Promise<void> {
    try {
      const row = await this.prisma.semanticModelSetting.findUnique({
        where: { id: SINGLETON_ID },
        select: { version: true },
      });
      const seen = this.cached?.value.version ?? -1;
      const now = row?.version ?? 0;
      if (seen === now) return;
      await this.invalidateAndNotify();
    } catch (error) {
      // Un sondeo fallido no es un incidente: el siguiente lo vuelve a intentar
      // y mientras tanto el worker clasifica con lo último que resolvió.
      this.logger.warn(
        `No se pudo consultar la configuración del proveedor semántico: ${String(
          error instanceof Error ? error.message : error,
        )}`,
      );
    }
  }

  async invalidateAndNotify(): Promise<void> {
    this.cached = undefined;
    const value = await this.current();
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch (error) {
        this.logger.error(
          `Un suscriptor falló al aplicar la configuración del proveedor semántico: ${String(
            error instanceof Error ? error.message : error,
          )}`,
        );
      }
    }
  }
}
