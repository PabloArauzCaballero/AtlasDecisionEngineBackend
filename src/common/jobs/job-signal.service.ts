import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Client } from 'pg';
import { PrismaService } from '../prisma/prisma.service';
import { booleanoDeConfig, numeroDeConfig } from '../config/config-coercion.util';

/**
 * Un canal es a la vez identificador SQL (va sin comillas ni parámetros en `LISTEN`),
 * etiqueta de métrica y nombre de trabajo: se acota a minúsculas, dígitos, guion y guion
 * bajo, sin excepciones. Lo que no encaje se descarta en vez de interpretarse.
 */
const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Nombre del canal de Postgres. Uno solo para todos los trabajos: ver la nota de clase. */
const DEFAULT_NOTIFY_CHANNEL = 'atlas_jobs';

export type WakeListener = (channel: string) => void;

/**
 * Señal de despertar entre el proceso que produce trabajo y el que lo consume.
 *
 * El problema que resuelve: la API escribe una fila de outbox o encola una corrida de
 * prueba, y el worker —que es otro proceso, posiblemente en otra máquina— no tiene forma
 * de enterarse salvo volviendo a preguntar. Sondear cada segundo daba latencia de hasta un
 * segundo Y un coste fijo de consultas que no se amortiza nunca: al ralentí, el sistema
 * gastaba exactamente lo mismo que bajo carga.
 *
 * `LISTEN`/`NOTIFY` de Postgres invierte las dos cosas a la vez: la latencia baja a la del
 * commit y el coste al ralentí baja a cero, sin añadir un broker al stack. El `NOTIFY` se
 * emite DENTRO de la transacción del productor, así que Postgres lo entrega solo si esa
 * transacción hace commit — un aviso no puede adelantar a la fila que anuncia, ni sobrevivir
 * a un rollback.
 *
 * Se usa UN canal (`atlas_jobs`) con el nombre del trabajo como carga útil, en vez de un
 * canal por trabajo: la conexión dedicada emite un `LISTEN` y no uno por trabajo registrado,
 * y añadir un trabajo nuevo no exige tocar la conexión.
 *
 * El sondeo NO desaparece: sigue siendo la red de seguridad con un intervalo largo. Un aviso
 * perdido (reconexión, `pgbouncer` en modo transacción, réplica que arranca tarde) solo
 * retrasa el trabajo hasta el siguiente sondeo, nunca lo pierde. Por eso desactivar
 * `JOB_WAKE_ENABLED` degrada la latencia pero jamás la corrección.
 */
@Injectable()
export class JobSignalService implements OnModuleDestroy {
  private readonly logger = new Logger(JobSignalService.name);
  private readonly channel: string;
  private readonly listeners = new Set<WakeListener>();

  private client?: Client;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectDelayMs = 1_000;
  private stopped = false;
  private listening = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const configured = (config.get<string>('JOB_WAKE_CHANNEL') ?? DEFAULT_NOTIFY_CHANNEL).trim();
    // Un identificador de canal no se puede parametrizar en `LISTEN`, así que se valida
    // aquí y se rechaza cualquier cosa que no sea un nombre simple: es la única defensa
    // posible contra una inyección por configuración en esa sentencia.
    this.channel = CHANNEL_PATTERN.test(configured) ? configured : DEFAULT_NOTIFY_CHANNEL;
  }

  /**
   * ¿Está habilitado el despertar por señal? Fuera de eso, todo cae al sondeo.
   *
   * El valor se normaliza porque `config.get<boolean>(...)` no convierte nada: el genérico es un
   * cast de TypeScript y, cuando el ajuste sale de `process.env`, lo que llega es la cadena
   * `'false'`. Y `'false'` es verdadero en JavaScript, así que apagar el despertar por variable de
   * entorno lo dejaba encendido — un interruptor que no apaga es peor que no tener interruptor.
   */
  get enabled(): boolean {
    return booleanoDeConfig(this.config, 'JOB_WAKE_ENABLED', true);
  }

  /** ¿Hay una conexión de escucha viva ahora mismo? Lo consulta la sonda de disponibilidad. */
  get connected(): boolean {
    return this.listening;
  }

  /**
   * Anuncia trabajo nuevo dentro de la transacción del productor. Requiere la transacción
   * —y no la acepta opcional— por la misma razón que {@link OutboxPublisherService.publish}:
   * un aviso que se entrega mientras el cambio de negocio hace rollback despierta al worker
   * para nada, y uno emitido antes del commit lo despierta demasiado pronto.
   */
  async notify(tx: Prisma.TransactionClient, jobName: string): Promise<void> {
    if (!CHANNEL_PATTERN.test(jobName)) return;
    await tx.$executeRaw(Prisma.sql`SELECT pg_notify(${this.channel}, ${jobName})`);
  }

  /**
   * Anuncia trabajo fuera de una transacción, sin esperar ni propagar el fallo. Es para
   * los productores que ya han hecho commit por otra vía; un aviso perdido solo cuesta un
   * sondeo de retraso, así que nunca debe convertirse en un error del llamante.
   */
  notifyDetached(jobName: string): void {
    if (!CHANNEL_PATTERN.test(jobName)) return;
    void this.prisma
      .$executeRaw(Prisma.sql`SELECT pg_notify(${this.channel}, ${jobName})`)
      .catch((error: unknown) =>
        this.logger.debug(
          `No se pudo anunciar el trabajo ${jobName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
  }

  /** Registra un oyente de despertares. Devuelve la función para darse de baja. */
  onWake(listener: WakeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Abre la conexión dedicada de escucha. Es una conexión propia y no una del pool de
   * Prisma a propósito: `LISTEN` es estado de sesión, y una conexión del pool se devuelve
   * (o se recicla por `idleTimeout`) llevándose la suscripción sin avisar a nadie.
   */
  startListening(): void {
    if (!this.enabled || this.stopped || this.client) return;
    const connectionString = this.config.get<string>('DATABASE_URL');
    if (!connectionString) return;

    const client = new Client({
      connectionString,
      application_name: 'atlas-decision-jobs-listener',
      // `pg` espera un número: una cadena convierte su aritmética de timeouts en concatenación.
      connectionTimeoutMillis: numeroDeConfig(this.config, 'DATABASE_CONNECTION_TIMEOUT_MS', 5_000),
      // Detecta un corte silencioso (NAT, balanceador) sin sondear: si el keepalive del
      // socket falla, el evento `error` dispara la reconexión en vez de dejar una escucha
      // muda que parece sana. Es el único modo de fallo del que el sondeo no protege bien,
      // porque el proceso se cree despertable y alarga su retroceso.
      keepAlive: true,
    });
    this.client = client;

    client.on('notification', (message) => {
      const payload = (message.payload ?? '').trim();
      if (!CHANNEL_PATTERN.test(payload)) return;
      for (const listener of this.listeners) listener(payload);
    });
    client.on('error', (error: Error) => {
      this.listening = false;
      this.logger.warn(`Conexión de escucha de trabajos caída: ${error.message}`);
      this.scheduleReconnect();
    });
    client.on('end', () => {
      this.listening = false;
      this.scheduleReconnect();
    });

    void client
      .connect()
      .then(() => client.query(`LISTEN ${this.channel}`))
      .then(() => {
        this.listening = true;
        this.reconnectDelayMs = 1_000;
        this.logger.log(`Escuchando despertares de trabajos en el canal ${this.channel}`);
      })
      .catch((error: unknown) => {
        this.listening = false;
        this.logger.warn(
          `No se pudo abrir la escucha de trabajos: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        this.scheduleReconnect();
      });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.listening = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const client = this.client;
    this.client = undefined;
    // `end()` sobre un cliente que nunca conectó rechaza; cerrar es best-effort porque el
    // proceso se está apagando de todos modos.
    if (client) await client.end().catch(() => undefined);
  }

  /** Reconexión con retroceso exponencial acotado; el sondeo cubre el hueco mientras tanto. */
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const client = this.client;
    this.client = undefined;
    if (client) void client.end().catch(() => undefined);

    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.startListening();
    }, delay);
    this.reconnectTimer.unref?.();
  }
}
