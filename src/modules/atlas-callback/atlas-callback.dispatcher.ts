/** Entrega a AtlasBackend los avisos encolados en el outbox, con reintento por el relay. */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service';
import { runsBackgroundJobs, workerRoleOf } from '../../common/config/worker-role';
import type { DispatchedEvent } from '../../common/events/event-envelope';
import { EventBus } from '../../common/events/event-bus';
import {
  type AtlasCallbackRequestedPayload,
  DecisionEventType,
} from '../../common/events/event-types';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Plazo de cada intento. Un intento colgado no puede retener la reclamación del relay. */
const PLAZO_MS = 10_000;

/**
 * Respuestas 4xx que SÍ merecen otro intento: tiempo agotado, «demasiado pronto» y cuota.
 * El resto de 4xx dice que la petición está mal o que no hay nada que aplicar, y repetirla sólo
 * llenaría la auditoría del mismo fallo.
 */
const CUATROCIENTOS_TRANSITORIOS = new Set([408, 425, 429]);

type Desenlace =
  | { tipo: 'entregado' }
  | { tipo: 'permanente'; motivo: string }
  | { tipo: 'transitorio'; motivo: string };

/**
 * El consumidor del aviso de vuelta a AtlasBackend.
 *
 * Qué hace con cada desenlace, y por qué:
 *
 * - **Entregado** (2xx): anota el evento como procesado. Si otro consumidor del mismo evento falla
 *   después y el relay lo vuelve a repartir, la anotación impide llamar dos veces a AtlasBackend.
 * - **Transitorio** (red, plazo, 5xx, 408/425/429): lo audita y LANZA. El relay deja la fila
 *   pendiente con retroceso exponencial y la vuelve a repartir; agotados los intentos, `DEAD`.
 * - **Permanente** (el resto de 4xx): lo audita y NO lanza. Un 404 «ninguna solicitud nació de
 *   esa ejecución» no se arregla repitiéndolo.
 * - **Sin configurar** (`ATLAS_BACKEND_BASE_URL` o `ENGINE_CALLBACK_API_KEY` ausentes): lo dice en
 *   el registro y no reintenta. Es un despliegue sin el circuito, no una avería pasajera.
 *
 * Sólo se suscribe donde corre el relay (`runsBackgroundJobs`), igual que el proyector de
 * notificaciones: en una réplica de API el bus no emite nunca.
 */
@Injectable()
export class AtlasCallbackDispatcher implements OnModuleInit, OnModuleDestroy {
  static readonly CONSUMER_NAME = 'atlas-callback';

  private readonly logger = new Logger(AtlasCallbackDispatcher.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!runsBackgroundJobs(this.config)) {
      this.logger.log(`Aviso a AtlasBackend no suscrito: WORKER_ROLE=${workerRoleOf(this.config)}`);
      return;
    }
    this.unsubscribe = this.bus.subscribe(DecisionEventType.ATLAS_CALLBACK_REQUESTED, (event) =>
      this.handle(event),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  async handle(event: DispatchedEvent): Promise<void> {
    const aviso = leerAviso(event.payload);
    if (!aviso) {
      // Un evento mal formado no mejora reintentándolo: se dice y se descarta.
      this.logger.error(
        `Aviso ${event.outboxEventId.toString()} sin ruta o sin cuerpo: se descarta.`,
      );
      return;
    }
    if (await this.yaEntregado(event.outboxEventId)) return;

    const base = this.config.get<string>('ATLAS_BACKEND_BASE_URL');
    const clave = this.config.get<string>('ENGINE_CALLBACK_API_KEY');
    if (!base || !clave) {
      this.logger.warn(
        `${event.aggregateType} ${event.aggregateId} resuelto sin avisar a AtlasBackend (${aviso.route}): falta ATLAS_BACKEND_BASE_URL o ENGINE_CALLBACK_API_KEY`,
      );
      await this.marcarEntregado(event.outboxEventId);
      return;
    }

    const desenlace = await this.enviar(`${base.replace(/\/+$/, '')}${aviso.route}`, {
      tenantId: event.tenantId,
      clave,
      cuerpo: aviso.body,
    });

    if (desenlace.tipo === 'entregado') {
      await this.marcarEntregado(event.outboxEventId);
      this.logger.log(
        `Aviso devuelto a AtlasBackend (${aviso.route}) por ${event.aggregateType} ${event.aggregateId}`,
      );
      return;
    }

    const permanente = desenlace.tipo === 'permanente';
    this.logger.error(
      `No se pudo avisar a AtlasBackend (${aviso.route}) de ${event.aggregateType} ${event.aggregateId}` +
        `${permanente ? '' : ', se reintentará'}: ${desenlace.motivo}`,
    );
    await this.audit.append({
      tenantId: event.tenantId,
      eventType: 'MANUAL_REVIEW_CALLBACK_FAILED',
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      actorId: event.actorId,
      requestId: event.correlationId ?? undefined,
      payload: {
        ...aviso.body,
        ruta: aviso.route,
        motivo: desenlace.motivo,
        permanente,
        outboxEventId: event.outboxEventId.toString(),
      },
    });
    if (permanente) {
      await this.marcarEntregado(event.outboxEventId);
      return;
    }
    // Lanzar es lo que hace real el reintento: el relay deja la fila pendiente con retroceso.
    throw new Error(`Aviso a AtlasBackend ${aviso.route} pendiente: ${desenlace.motivo}`);
  }

  private async enviar(
    url: string,
    peticion: { tenantId: bigint; clave: string; cuerpo: Record<string, string | null> },
  ): Promise<Desenlace> {
    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': peticion.tenantId.toString(),
          'x-engine-callback-key': peticion.clave,
        },
        body: JSON.stringify(peticion.cuerpo),
        signal: AbortSignal.timeout(PLAZO_MS),
      });
    } catch (error) {
      return {
        tipo: 'transitorio',
        motivo: error instanceof Error ? error.message : String(error),
      };
    }
    if (respuesta.ok) return { tipo: 'entregado' };
    const motivo = `HTTP ${respuesta.status}: ${(await respuesta.text().catch(() => '')).slice(0, 300)}`;
    const transitorio = respuesta.status >= 500 || CUATROCIENTOS_TRANSITORIOS.has(respuesta.status);
    return transitorio ? { tipo: 'transitorio', motivo } : { tipo: 'permanente', motivo };
  }

  private async yaEntregado(outboxEventId: bigint): Promise<boolean> {
    const marca = await this.prisma.processedEvent.findUnique({
      where: {
        consumerName_outboxEventId: {
          consumerName: AtlasCallbackDispatcher.CONSUMER_NAME,
          outboxEventId,
        },
      },
      select: { id: true },
    });
    return marca !== null;
  }

  private async marcarEntregado(outboxEventId: bigint): Promise<void> {
    await this.prisma.processedEvent.createMany({
      data: [{ consumerName: AtlasCallbackDispatcher.CONSUMER_NAME, outboxEventId }],
      skipDuplicates: true,
    });
  }
}

/** El payload del evento, o `null` si no tiene la forma v1. */
function leerAviso(payload: unknown): AtlasCallbackRequestedPayload | null {
  const valor = payload as Partial<AtlasCallbackRequestedPayload> | null | undefined;
  if (!valor || typeof valor.route !== 'string' || !valor.route.startsWith('/')) return null;
  if (!valor.body || typeof valor.body !== 'object' || Array.isArray(valor.body)) return null;
  return { route: valor.route, body: valor.body };
}
