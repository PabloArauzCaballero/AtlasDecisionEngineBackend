import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { DataSubjectService } from '../src/modules/data-subject/data-subject.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { CreateDataSubjectRequestDto } from '../src/modules/data-subject/data-subject.dto';

/**
 * Derechos del titular sobre las decisiones tomadas acerca de él.
 *
 * El sistema ya escribía `subject_reference_hash` en cada ejecución y no lo leía nadie: el
 * dato para responder existía y la capacidad no. Lo que estas pruebas fijan es lo que hace
 * que la respuesta sea correcta y no solo posible:
 *
 *  - la referencia del titular NUNCA se persiste en claro, ni en la fila ni en la auditoría;
 *  - se busca por el MISMO HMAC que escribió la ejecución, o no encontraría nada;
 *  - una eliminación se RECHAZA con su motivo cuando hay evidencia que la ley obliga a
 *    conservar, en vez de afirmar un borrado que la cadena append-only impide;
 *  - al titular se le entrega el mensaje público de cada motivo, nunca el interno.
 */
describe('DataSubjectService — derechos del titular', () => {
  const TENANT = 4n;
  const REFERENCE = 'CPF-12345678901';
  const principal = { id: 'atencion', requestId: 'req-1' } as AuthenticatedPrincipal;
  const hashes = new HashService(
    new ConfigService({ AUDIT_HASH_SECRET: 'x'.repeat(40), AUDIT_HASH_KEY_ID: 'v1' }),
  );
  const expectedHash = hashes.hmac(REFERENCE);

  function execution(overrides: Record<string, unknown> = {}) {
    return {
      id: 10n,
      requestId: 'req-abc',
      decisionStatus: 'SUCCEEDED',
      businessOutcome: 'DECLINED',
      executedAt: new Date('2026-03-01T00:00:00.000Z'),
      artifactVersion: {
        versionNumber: 3,
        artifact: { artifactCode: 'CREDIT', name: 'Crédito al consumo' },
      },
      reasons: [
        {
          reasonCode: {
            reasonCode: 'INSUFFICIENT_INCOME',
            publicMessage: 'Ingresos insuficientes para el importe solicitado',
            isAdverseAction: true,
          },
        },
      ],
      ...overrides,
    };
  }

  function make(executions: unknown[] = []) {
    // Los argumentos capturados se inspeccionan con `toMatchObject`, así que basta con
    // `unknown` y un aserto en el punto de uso.
    const calls: Record<string, unknown> = {};
    const audited: Array<Record<string, unknown>> = [];
    const audit = {
      append: (input: Record<string, unknown>) => {
        audited.push(input);
        return Promise.resolve({});
      },
    } as unknown as AuditService;
    const prisma = {
      decisionExecution: {
        findMany: (args: { where: unknown; take: number }) => {
          calls.executionWhere = args.where;
          calls.executionTake = args.take;
          return Promise.resolve(executions);
        },
      },
      decisionDataSubjectRequest: {
        create: (args: { data: Record<string, unknown> }) => {
          calls.created = args.data;
          return Promise.resolve({ id: 1n, createdAt: new Date(), ...args.data });
        },
        findMany: (args: { where: unknown }) => {
          calls.historyWhere = args.where;
          return Promise.resolve([]);
        },
      },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          decisionDataSubjectRequest: {
            create: (args: { data: Record<string, unknown> }) => {
              calls.created = args.data;
              return Promise.resolve({ id: 1n, createdAt: new Date(), ...args.data });
            },
          },
        }),
    } as unknown as PrismaService;
    return { service: new DataSubjectService(prisma, hashes, audit), calls, audited };
  }

  const dto = (requestType: string): CreateDataSubjectRequestDto =>
    ({ subjectReference: REFERENCE, requestType }) as CreateDataSubjectRequestDto;

  describe('identificación del titular', () => {
    it('busca por el MISMO HMAC que escribió la ejecución', async () => {
      const { service, calls } = make([execution()]);
      await service.submit(TENANT, dto('ACCESS'), principal);
      expect(calls.executionWhere).toEqual({
        tenantId: TENANT,
        subjectReferenceHash: expectedHash,
      });
    });

    it('la referencia en claro no llega a la fila ni a la auditoría', async () => {
      const { service, calls, audited } = make([execution()]);
      await service.submit(TENANT, dto('ACCESS'), principal);
      // `bigint` no es serializable en JSON; se aplana antes para poder inspeccionar el
      // objeto entero y no solo los campos que uno se acuerde de mirar.
      const flatten = (value: unknown) =>
        JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
      expect(flatten(calls.created)).not.toContain(REFERENCE);
      expect(flatten(audited)).not.toContain(REFERENCE);
      // El registro de auditoría es el sitio donde MENOS conviene el identificador en claro:
      // es append-only, así que un error ahí no se puede deshacer.
      expect(audited[0].payload).toMatchObject({ subjectReferenceHash: expectedHash });
    });

    it('el historial se consulta por el mismo hash', async () => {
      const { service, calls } = make();
      await service.history(TENANT, REFERENCE);
      expect(calls.historyWhere).toEqual({ tenantId: TENANT, subjectReferenceHash: expectedHash });
    });
  });

  describe('acceso y portabilidad (LGPD art. 18 I, II y V)', () => {
    it('devuelve las decisiones con su resultado y sus motivos', async () => {
      const { service } = make([execution()]);
      const result = await service.submit(TENANT, dto('ACCESS'), principal);
      expect(result.status).toBe('FULFILLED');
      expect(result.matchedDecisions).toBe(1);
      expect(result.decisions?.[0]).toMatchObject({
        artifactCode: 'CREDIT',
        outcome: 'DECLINED',
        reasons: [{ code: 'INSUFFICIENT_INCOME', adverseAction: true }],
      });
    });

    it('entrega el mensaje público, nunca el interno', async () => {
      const { service } = make([execution()]);
      const result = await service.submit(TENANT, dto('ACCESS'), principal);
      // El mensaje interno existe precisamente para lo que no se le cuenta al solicitante.
      expect(result.decisions?.[0].reasons[0].message).toBe(
        'Ingresos insuficientes para el importe solicitado',
      );
      expect(JSON.stringify(result)).not.toContain('internalMessage');
    });

    it('acota el número de decisiones y lo dice cuando trunca', async () => {
      const many = Array.from({ length: 500 }, (_, i) => execution({ id: BigInt(i) }));
      const { service, calls } = make(many);
      const result = await service.submit(TENANT, dto('PORTABILITY'), principal);
      expect(calls.executionTake).toBe(500);
      // Truncar en silencio se leería como «esto es todo lo que hay sobre usted».
      expect(result.resolution).toMatchObject({ truncated: true });
    });

    it('un titular sin decisiones recibe una respuesta cumplida y vacía', async () => {
      const { service } = make([]);
      const result = await service.submit(TENANT, dto('ACCESS'), principal);
      expect(result.status).toBe('FULFILLED');
      expect(result.matchedDecisions).toBe(0);
      expect(result.decisions).toEqual([]);
    });
  });

  describe('eliminación (LGPD art. 18 VI)', () => {
    it('se RECHAZA con su motivo cuando hay evidencia de retención obligatoria', async () => {
      const { service } = make([execution()]);
      const result = await service.submit(TENANT, dto('ERASURE'), principal);
      // Afirmar el borrado sería falso: la cadena de auditoría es append-only y la evidencia
      // de una decisión crediticia se conserva por obligación legal.
      expect(result.status).toBe('REJECTED');
      expect(result.resolution).toMatchObject({ reason: 'LEGAL_RETENTION_OBLIGATION' });
    });

    it('se cumple cuando no hay nada que conservar', async () => {
      const { service } = make([]);
      const result = await service.submit(TENANT, dto('ERASURE'), principal);
      expect(result.status).toBe('FULFILLED');
    });

    it('no devuelve las decisiones: una eliminación no es una entrega de datos', async () => {
      const { service } = make([execution()]);
      const result = await service.submit(TENANT, dto('ERASURE'), principal);
      expect(result.decisions).toBeUndefined();
    });
  });

  describe('revisión humana (LGPD art. 20)', () => {
    it('queda RECIBIDA: la atiende una persona, no este endpoint', async () => {
      const { service } = make([execution()]);
      const result = await service.submit(TENANT, dto('REVIEW'), principal);
      expect(result.status).toBe('RECEIVED');
      expect(result.resolution).toMatchObject({ matchedDecisions: 1 });
    });
  });

  describe('constancia', () => {
    it('toda solicitud deja fila y evento de auditoría en la misma transacción', async () => {
      const { service, calls, audited } = make([execution()]);
      await service.submit(TENANT, dto('ACCESS'), principal);
      expect(calls.created).toMatchObject({
        tenantId: TENANT,
        requestType: 'ACCESS',
        receivedBy: 'atencion',
      });
      expect(audited).toHaveLength(1);
      expect(audited[0].eventType).toBe('DATA_SUBJECT_REQUEST_RECEIVED');
    });

    it('también deja constancia la que se rechaza', async () => {
      // El art. 18 §1 obliga a responder; la prueba de que se respondió —también que no— es
      // parte de la respuesta.
      const { service, audited } = make([execution()]);
      await service.submit(TENANT, dto('ERASURE'), principal);
      expect(audited).toHaveLength(1);
      expect(audited[0].payload).toMatchObject({ status: 'REJECTED' });
    });

    it('guarda el expediente del canal, que no es un dato del titular', async () => {
      const { service, calls } = make([]);
      await service.submit(
        TENANT,
        { ...dto('ACCESS'), reference: 'TICKET-9912' } as CreateDataSubjectRequestDto,
        principal,
      );
      expect(calls.created).toMatchObject({ reference: 'TICKET-9912' });
    });
  });
});
