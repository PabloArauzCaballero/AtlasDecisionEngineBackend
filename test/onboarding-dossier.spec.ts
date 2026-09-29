/**
 * El expediente del alta que AtlasBackend adjunta al caso de la ejecución de identidad.
 *
 * Con la revisión humana obligatoria, un alta que el Motor dio por VERIFICADA no tenía caso aquí y
 * el revisor no veía nada. Se fija que la ruta abre el caso cuando falta, adjunta sin tocar la
 * decisión del revisor cuando existe, no cruza tenants, y que el caso así abierto, al resolverse en
 * la cola IDENTIDAD, vuelve a AtlasBackend por el mismo callback que los demás.
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DomainException } from '../src/common/errors/domain-exception';
import { REQUIRED_AUDIENCE, REQUIRED_ROLES } from '../src/common/security/security.decorators';
import { RUNTIME_DECISION_ROLE } from '../src/common/security/platform-roles';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { AtlasCallbackService } from '../src/modules/atlas-callback/atlas-callback.service';
import { ManualReviewService } from '../src/modules/manual-review/manual-review.service';
import type { ResolveManualReviewDto } from '../src/modules/manual-review/manual-review.dto';
import { OnboardingDossierController } from '../src/modules/manual-review/onboarding-dossier.controller';
import type { AttachOnboardingDossierDto } from '../src/modules/manual-review/onboarding-dossier.dto';
import {
  MAX_DOSSIER_BYTES,
  OnboardingDossierService,
} from '../src/modules/manual-review/onboarding-dossier.service';

const TENANT = 7n;
const EXECUTION = 4321n;
const integracion = {
  id: 'atlas-backend',
  requestId: 'req-dossier',
  roles: [RUNTIME_DECISION_ROLE],
  authMethod: 'api_key',
} as unknown as AuthenticatedPrincipal;

const dossier = {
  version: 1,
  generadoEn: '2026-09-28T12:00:00.000Z',
  cronometro: { segundosTotal: 412, pegadoEnCarnet: true },
};

type Row = Record<string, unknown>;

function make(options: {
  execution?: Row | null;
  existing?: Row | null;
  failCreateOnce?: boolean;
}) {
  const audited: Array<{ eventType: string; payload: unknown }> = [];
  const created: Row[] = [];
  const updated: Row[] = [];
  let store: Row | null = options.existing ?? null;
  let createFailures = options.failCreateOnce ? 1 : 0;
  const executionLookups: unknown[] = [];
  const tx = {
    decisionExecution: {
      findFirst: (args: unknown) => {
        executionLookups.push(args);
        return Promise.resolve(
          options.execution === undefined ? { id: EXECUTION } : options.execution,
        );
      },
    },
    decisionManualReviewCase: {
      findFirst: () => Promise.resolve(store),
      create: (args: { data: Row }) => {
        if (createFailures > 0) {
          createFailures -= 1;
          // Otro envío ganó la carrera: el caso ya existe cuando se reintenta.
          store = { id: 99n, status: 'OPEN', caseCode: 'MR-X', evidenceJson: { motivo: 'otro' } };
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
          );
        }
        created.push(args.data);
        return Promise.resolve({ id: 501n, ...args.data });
      },
      update: (args: { where: Row; data: Row }) => {
        updated.push(args.data);
        return Promise.resolve({ ...store, ...args.data });
      },
    },
  };
  const prisma = {
    $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  const audit = {
    append: (input: { eventType: string; payload: unknown }) => {
      audited.push({ eventType: input.eventType, payload: input.payload });
      return Promise.resolve({});
    },
  } as unknown as AuditService;
  return {
    service: new OnboardingDossierService(prisma, audit),
    audited,
    created,
    updated,
    executionLookups,
  };
}

const conApertura = (extra: Row = {}) =>
  ({ dossier, openIfMissing: { ...extra } }) as unknown as AttachOnboardingDossierDto;

describe('OnboardingDossierService', () => {
  it('abre el caso en la cola IDENTIDAD cuando la ejecución no tiene ninguno', async () => {
    const { service, created, audited, executionLookups } = make({});
    const antes = Date.now();

    const result = await service.attach(TENANT, EXECUTION, conApertura(), integracion);

    expect(result.created).toBe(true);
    expect(executionLookups[0]).toMatchObject({ where: { id: EXECUTION, tenantId: TENANT } });
    expect(created[0]).toMatchObject({
      executionId: EXECUTION,
      tenantId: TENANT,
      caseCode: 'MR-0000004321',
      queueCode: 'IDENTIDAD',
      priority: 50,
      status: 'OPEN',
      evidenceJson: { motivo: 'REVISION_HUMANA_OBLIGATORIA', alta: dossier },
    });
    const due = (created[0].dueAt as Date).getTime();
    expect(due).toBeGreaterThanOrEqual(antes + 240 * 60_000);
    expect(due).toBeLessThan(antes + 241 * 60_000);
    expect(audited).toEqual([
      expect.objectContaining({
        eventType: 'MANUAL_REVIEW_OPENED',
        payload: expect.objectContaining({ queueCode: 'IDENTIDAD', source: 'ONBOARDING_DOSSIER' }),
      }),
    ]);
  });

  it('respeta cola, prioridad, plazo y motivo cuando vienen', async () => {
    const { service, created } = make({});
    await service.attach(
      TENANT,
      EXECUTION,
      conApertura({ queueCode: 'OTRA', priority: 5, slaMinutes: 60, motivo: 'POLITICA' }),
      integracion,
    );
    expect(created[0]).toMatchObject({
      queueCode: 'OTRA',
      priority: 5,
      evidenceJson: { motivo: 'POLITICA' },
    });
  });

  it('con caso existente fusiona `alta` sin tocar estado ni asignación', async () => {
    const existing = {
      id: 12n,
      status: 'ASSIGNED',
      assignedTo: 'ana',
      caseCode: 'MR-0000004321',
      evidenceJson: { segundosTotal: 400, botScore: 0.2, alta: { version: 0 } },
    };
    const { service, updated, created, audited } = make({ existing });

    const result = await service.attach(TENANT, EXECUTION, conApertura(), integracion);

    expect(result.created).toBe(false);
    expect(created).toEqual([]);
    expect(Object.keys(updated[0])).toEqual(['evidenceJson']);
    expect(updated[0].evidenceJson).toMatchObject({
      segundosTotal: 400,
      botScore: 0.2,
      alta: dossier,
    });
    expect(typeof (updated[0].evidenceJson as Row).altaActualizadaEn).toBe('string');
    expect(result).toMatchObject({ status: 'ASSIGNED', assignedTo: 'ana' });
    expect(audited.map((a) => a.eventType)).toEqual(['MANUAL_REVIEW_DOSSIER_ATTACHED']);
  });

  it('404 cuando la ejecución no es del tenant (o no existe)', async () => {
    const { service, created, updated, audited } = make({ execution: null });
    const error = await service
      .attach(TENANT, EXECUTION, conApertura(), integracion)
      .catch((caught: unknown) => caught);
    expect((error as DomainException).code).toBe('EXECUTION_NOT_FOUND');
    expect((error as DomainException).status).toBe(404);
    expect([created, updated, audited]).toEqual([[], [], []]);
  });

  it('404 claro cuando no hay caso y no se pidió abrirlo', async () => {
    const { service, created } = make({});
    const error = await service
      .attach(TENANT, EXECUTION, { dossier } as AttachOnboardingDossierDto, integracion)
      .catch((caught: unknown) => caught);
    expect((error as DomainException).code).toBe('MANUAL_REVIEW_NOT_FOUND');
    expect((error as DomainException).status).toBe(404);
    expect(created).toEqual([]);
  });

  it('409 sobre un caso ya resuelto: su evidencia no se reescribe', async () => {
    const { service, updated } = make({
      existing: { id: 12n, status: 'RESOLVED_APPROVED', caseCode: 'MR-1', evidenceJson: {} },
    });
    const error = await service
      .attach(TENANT, EXECUTION, conApertura(), integracion)
      .catch((caught: unknown) => caught);
    expect((error as DomainException).code).toBe('MANUAL_REVIEW_CLOSED');
    expect((error as DomainException).status).toBe(409);
    expect(updated).toEqual([]);
  });

  it('413 si el expediente supera el tope', async () => {
    const { service } = make({});
    const grande = { relleno: 'x'.repeat(MAX_DOSSIER_BYTES) };
    const error = await service
      .attach(TENANT, EXECUTION, { dossier: grande } as AttachOnboardingDossierDto, integracion)
      .catch((caught: unknown) => caught);
    expect((error as DomainException).code).toBe('ONBOARDING_DOSSIER_TOO_LARGE');
    expect((error as DomainException).status).toBe(413);
  });

  it('idempotente ante la carrera: si otro envío creó el caso, adjunta sobre él', async () => {
    const { service, updated } = make({ failCreateOnce: true });
    const result = await service.attach(TENANT, EXECUTION, conApertura(), integracion);
    expect(result.created).toBe(false);
    expect(updated[0].evidenceJson).toMatchObject({ motivo: 'otro', alta: dossier });
  });
});

describe('caso abierto por el expediente → resolución', () => {
  it('en la cola IDENTIDAD dispara el callback de identidad con su executionId', async () => {
    const { service, created } = make({});
    const abierto = await service.attach(TENANT, EXECUTION, conApertura(), integracion);
    expect(created).toHaveLength(1);

    // El caso tal como quedó, ya tomado por una analista.
    const review = { ...abierto, status: 'ASSIGNED', assignedTo: 'ana' };
    const avisos: Array<Record<string, unknown>> = [];
    const tx = {
      decisionManualReviewCase: {
        update: (args: { data: Row }) => Promise.resolve({ ...review, ...args.data }),
      },
    };
    const prisma = {
      decisionManualReviewCase: { findFirst: () => Promise.resolve(review) },
      $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaService;
    const callbacks = {
      solicitar: (_tx: unknown, aviso: Record<string, unknown>) => {
        avisos.push(aviso);
        return Promise.resolve();
      },
    } as unknown as AtlasCallbackService;
    const audit = { append: () => Promise.resolve({}) } as unknown as AuditService;
    const reviews = new ManualReviewService(prisma, audit, new ConfigService({}), callbacks);
    const ana = { id: 'ana', requestId: 'req-r', roles: [] } as unknown as AuthenticatedPrincipal;

    await reviews.resolve(
      TENANT,
      501n,
      { decision: 'APPROVE', reason: 'todo cuadra' } as ResolveManualReviewDto,
      ana,
    );

    expect(avisos).toEqual([
      expect.objectContaining({
        ruta: '/internal/identity/manual-review-callback',
        cuerpo: expect.objectContaining({ executionId: '4321', decision: 'APPROVE' }),
      }),
    ]);
  });
});

describe('OnboardingDossierController', () => {
  it('sólo la credencial de ejecución (audiencia runtime, rol DECISION_RUNTIME) puede llamarla', () => {
    expect(Reflect.getMetadata(REQUIRED_AUDIENCE, OnboardingDossierController)).toBe('runtime');
    expect(Reflect.getMetadata(REQUIRED_ROLES, OnboardingDossierController)).toEqual([
      RUNTIME_DECISION_ROLE,
    ]);
  });

  it('parsea el executionId y delega en el servicio con el tenant del principal', async () => {
    const attach = jest.fn().mockResolvedValue({ created: true });
    const controller = new OnboardingDossierController({ attach } as never);
    const dto = conApertura();
    await controller.attach(TENANT, integracion, '4321', dto);
    expect(attach).toHaveBeenCalledWith(TENANT, EXECUTION, dto, integracion);
  });

  it('un executionId que no es un número es 400 y no llega al servicio', () => {
    const attach = jest.fn();
    const controller = new OnboardingDossierController({ attach } as never);
    expect(() => controller.attach(TENANT, integracion, 'abc', conApertura())).toThrow(
      DomainException,
    );
    expect(attach).not.toHaveBeenCalled();
  });
});
