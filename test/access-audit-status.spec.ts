import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { of, throwError, lastValueFrom, catchError } from 'rxjs';
import { AccessAuditInterceptor } from '../src/common/security/access-audit.interceptor';

/**
 * `decision_access_audit` es la única evidencia de ejecución real que tiene este bloque, y Flujos la
 * consume para decidir si un flujo está verificado o roto. DENY significa «el handler lanzó», y
 * lanzar cubre desde un 400 de validación hasta un 500 de verdad: sin el código HTTP, quien lea la
 * auditoría no puede distinguir «el flujo rechazó una entrada inválida, que es su trabajo» de «el
 * flujo reventó». Medido el 2026-09-10: un DENY con motivo «Version is not fully approved» —una
 * regla de negocio haciendo lo suyo— marcaba BROKEN el despliegue de versiones de artefacto.
 *
 * La fila se escribe cuando la respuesta ya salió, que es cuando el código es el definitivo. La
 * prueba emite `finish` igual que Express, y la de la conexión cortada emite sólo `close`.
 */
function escenario() {
  const filas: Array<Record<string, unknown>> = [];
  const prisma = {
    decisionAccessAudit: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        filas.push(data);
        return Promise.resolve(data);
      },
    },
  } as never;
  const oyentes = new Map<string, Array<() => void>>();
  const response = {
    statusCode: 200,
    once: (evento: string, oyente: () => void) => {
      oyentes.set(evento, [...(oyentes.get(evento) ?? []), oyente]);
    },
  };
  const emitir = (evento: string) => {
    for (const oyente of oyentes.get(evento) ?? []) oyente();
  };
  const request = { method: 'POST', principal: { requestId: 'r1', id: 'p1', tenantId: 1n } };
  const contexto = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getClass: () => ({ name: 'DeploymentController' }),
    getHandler: () => ({ name: 'deploy' }),
  } as unknown as ExecutionContext;
  const config = { get: () => true } as never;
  return {
    filas,
    contexto,
    interceptor: new AccessAuditInterceptor(prisma, config),
    /** Lo que hace Express al enviar: fija el código definitivo y avisa; luego cierra. */
    responder: (codigo: number) => {
      response.statusCode = codigo;
      emitir('finish');
      emitir('close');
    },
    cortar: () => emitir('close'),
  };
}

const correr = (
  interceptor: AccessAuditInterceptor,
  contexto: ExecutionContext,
  next: CallHandler,
) => lastValueFrom(interceptor.intercept(contexto, next).pipe(catchError(() => of(null))));

describe('AccessAuditInterceptor · el código HTTP de la decisión', () => {
  it('un ALLOW guarda el estado definitivo, no el 200 por defecto', async () => {
    const { interceptor, contexto, responder, filas } = escenario();

    await correr(interceptor, contexto, { handle: () => of({ ok: true }) });
    responder(201);

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      decision: 'ALLOW',
      status: 201,
      resource: 'POST DeploymentController.deploy',
    });
  });

  it.each([
    [new BadRequestException('Version is not fully approved'), 400],
    [new ForbiddenException(), 403],
  ])('un %s guarda SU código, no un 500 de oficio', async (error, esperado) => {
    const { interceptor, contexto, responder, filas } = escenario();

    await correr(interceptor, contexto, { handle: () => throwError(() => error) });
    responder(esperado);

    expect(filas[0]).toMatchObject({ decision: 'DENY', status: esperado, reason: error.message });
  });

  it('un fallo no previsto queda como 500', async () => {
    const { interceptor, contexto, responder, filas } = escenario();

    await correr(interceptor, contexto, {
      handle: () => throwError(() => new Error('la conexión se cayó')),
    });
    responder(500);

    expect(filas[0]).toMatchObject({ decision: 'DENY', status: 500 });
  });

  it('si la conexión se corta antes de responder, el intento se registra igual y sin código', async () => {
    // Es un control de seguridad: un intento denegado tiene que quedar registrado aunque quien lo
    // hizo cuelgue la conexión. Sin código, porque no lo hubo, y no se inventa ninguno.
    const { interceptor, contexto, cortar, filas } = escenario();

    await correr(interceptor, contexto, {
      handle: () => throwError(() => new ForbiddenException()),
    });
    cortar();

    expect(filas[0]).toMatchObject({ decision: 'DENY', status: null });
  });
});
