/** Captures security-relevant denials without retaining request bodies or credentials. */
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Observable, catchError, throwError } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { requestOrigin } from './request-origin';

@Injectable()
export class AccessAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AccessAuditInterceptor.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('ACCESS_AUDIT_ENABLED') ?? true;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;
    if (!this.enabled || !principal) return next.handle();

    const response = context.switchToHttp().getResponse<{
      statusCode?: number;
      once?: (evento: string, oyente: () => void) => void;
    }>();
    const resource = `${request.method} ${context.getClass().name}.${context.getHandler().name}`;
    // Desde qué pantalla se llamó, si el cliente lo declara. Flujos lo usa para verificar pantallas.
    const origen =
      typeof request.header === 'function'
        ? requestOrigin((nombre) => request.header(nombre))
        : null;
    const record = (decision: 'ALLOW' | 'DENY', status: number | null, reason?: string) =>
      this.prisma.decisionAccessAudit
        .create({
          data: {
            requestId: principal.requestId,
            principalId: principal.id,
            tenantId: principal.tenantId,
            resource: resource.slice(0, 160),
            action: request.method,
            decision,
            status,
            reason: reason?.slice(0, 200),
            originScreen: origen?.screen ?? null,
            originClient: origen?.client ?? null,
          },
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Failed to persist access audit: ${error instanceof Error ? error.message : String(error)}`,
          );
        });

    /**
     * La fila se escribe UNA vez, y con el código HTTP definitivo.
     *
     * DENY significa «el handler lanzó», y lanzar cubre desde un 400 de validación hasta un 500 de
     * verdad. Sin el código, quien lea esta auditoría no puede distinguir «el flujo rechazó una
     * entrada inválida, que es su trabajo» de «el flujo reventó», y acaba llamando roto a lo
     * primero. El código sólo es el definitivo cuando la respuesta ha salido: dentro del `tap`
     * todavía es el 200 por defecto de Express, y en el `catchError` el filtro de excepciones aún
     * no ha corrido.
     *
     * Por eso se espera a `finish`. Y por eso hay red de seguridad: si la conexión se corta antes,
     * `close` escribe igualmente la fila —con el código en nulo, que es la verdad— porque esto es
     * un control de seguridad y un intento denegado tiene que quedar registrado aunque quien lo
     * hizo cuelgue la conexión. La guarda `escrita` evita el duplicado, ya que `close` llega
     * siempre después de `finish`.
     */
    let escrita = false;
    let decision: 'ALLOW' | 'DENY' = 'ALLOW';
    let reason: string | undefined;
    const escribir = (status: number | null) => {
      if (escrita) return;
      escrita = true;
      void record(decision, status, reason);
    };
    response.once?.('finish', () => escribir(response.statusCode ?? null));
    response.once?.('close', () => {
      reason ??= 'connection closed before response';
      escribir(null);
    });

    return next.handle().pipe(
      catchError((error: unknown) => {
        decision = 'DENY';
        reason = error instanceof Error ? error.message : 'unknown';
        return throwError(() => error);
      }),
    );
  }
}
