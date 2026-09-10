import type { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { AccessAuditInterceptor } from '../src/common/security/access-audit.interceptor';
import { requestOrigin } from '../src/common/security/request-origin';
import { AuditQueryService } from '../src/modules/audit-query/audit-query.service';
import { SCREEN_RUNS_LIMIT, agruparPantallas } from '../src/modules/audit-query/screen-runs';

/**
 * Las 55 pantallas del portal del Motor no tenían forma de verificarse: la única evidencia de este
 * bloque es `decision_access_audit`, y no guardaba desde dónde se llamaba. Lo que se protege es que
 * el cruce con el catálogo de AtlasBackend no dé cero en silencio.
 */
const cabeceras = (valores: Record<string, string>) => (nombre: string) =>
  valores[nombre.toLowerCase()];

describe('requestOrigin · mismas reglas que AtlasBackend y el ERP', () => {
  it('normaliza el cliente al código del catálogo', () => {
    expect(
      requestOrigin(
        cabeceras({ 'x-atlas-flow': '/approval-requests/42', 'x-atlas-product': 'motor-portal' }),
      ),
    ).toEqual({
      client: 'MOTOR_PORTAL',
      screen: '/approval-requests/42',
    });
  });

  it('sin cliente, o con valores que no encajan, no se atribuye nada', () => {
    expect(requestOrigin(cabeceras({ 'x-atlas-flow': '/' }))).toBeNull();
    expect(
      requestOrigin(cabeceras({ 'x-atlas-flow': '/a b', 'x-atlas-product': 'motor-portal' })),
    ).toBeNull();
  });
});

describe('AccessAuditInterceptor · guarda la pantalla declarada', () => {
  it('escribe origin_screen y origin_client con la fila del acceso', async () => {
    const filas: Array<Record<string, unknown>> = [];
    const prisma = {
      decisionAccessAudit: {
        create: ({ data }: { data: Record<string, unknown> }) => (
          filas.push(data),
          Promise.resolve(data)
        ),
      },
    } as never;
    const oyentes: Array<() => void> = [];
    const response = {
      statusCode: 200,
      once: (evento: string, fn: () => void) => evento === 'finish' && oyentes.push(fn),
    };
    const valores: Record<string, string> = {
      'x-atlas-flow': '/deployments',
      'x-atlas-product': 'motor-portal',
    };
    const request = {
      method: 'GET',
      principal: { requestId: 'r1', id: 'p1', tenantId: 1n },
      header: (nombre: string) => valores[nombre.toLowerCase()],
    };
    const contexto = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
      getClass: () => ({ name: 'DeploymentController' }),
      getHandler: () => ({ name: 'list' }),
    } as unknown as ExecutionContext;

    await lastValueFrom(
      new AccessAuditInterceptor(prisma, { get: () => true } as never).intercept(contexto, {
        handle: () => of([]),
      }),
    );
    oyentes.forEach((fn) => fn());
    await Promise.resolve();

    expect(filas[0]).toMatchObject({
      originScreen: '/deployments',
      originClient: 'MOTOR_PORTAL',
      status: 200,
    });
  });
});

describe('agruparPantallas · la forma que lee AtlasBackend', () => {
  it('funde recursos y códigos por pantalla, con sólo el 5xx como fallo y la fecha más reciente', () => {
    const [pantalla] = agruparPantallas([
      {
        client: 'MOTOR_PORTAL',
        screen: '/deployments',
        resource: 'GET DeploymentController.list',
        status: 200,
        count: 3,
        lastAt: new Date('2026-09-10T09:00:00Z'),
      },
      {
        client: 'MOTOR_PORTAL',
        screen: '/deployments',
        resource: 'GET DeploymentController.list',
        status: 500,
        count: 1,
        lastAt: new Date('2026-09-10T10:00:00Z'),
      },
      {
        client: 'MOTOR_PORTAL',
        screen: '/deployments',
        resource: 'POST DeploymentController.deploy',
        status: 400,
        count: 2,
        lastAt: null,
      },
    ]);
    expect(pantalla).toMatchObject({
      client: 'MOTOR_PORTAL',
      screen: '/deployments',
      calls: 6,
      failed: 1,
    });
    expect(pantalla?.lastAt?.toISOString()).toBe('2026-09-10T10:00:00.000Z');
    expect(pantalla?.routes).toEqual([
      { method: 'GET', path: 'DeploymentController.list', calls: 4, failed: 1 },
      { method: 'POST', path: 'DeploymentController.deploy', calls: 2, failed: 0 },
    ]);
  });
});

describe('AuditQueryService.summarizeAccessRuns · pantallas', () => {
  const servicio = (pantallas: unknown[]) =>
    // `reads` es privado: se construye sin el constructor y se le da sólo lo que este método usa.
    Object.assign(Object.create(AuditQueryService.prototype) as object, {
      reads: {
        summarizeAccessRuns: async () => [],
        summarizeScreenRuns: async (_dias: number, limite: number) => pantallas.slice(0, limite),
      },
    }) as unknown as AuditQueryService;

  it('publica las pantallas y dice si la lista vino cortada', async () => {
    const fila = (i: number) => ({
      client: 'MOTOR_PORTAL',
      screen: `/p/${i}`,
      resource: 'GET A.b',
      status: 200,
      count: 1,
      lastAt: null,
    });
    const completo = await servicio([fila(1)]).summarizeAccessRuns(30);
    expect(completo).toMatchObject({
      screensTruncated: false,
      screens: [expect.objectContaining({ screen: '/p/1' })],
    });

    const cortado = await servicio(
      Array.from({ length: SCREEN_RUNS_LIMIT + 1 }, (_, i) => fila(i)),
    ).summarizeAccessRuns(30);
    expect(cortado.screensTruncated).toBe(true);
    expect(cortado.screens).toHaveLength(SCREEN_RUNS_LIMIT);
  });
});
