import { ConfigService } from '@nestjs/config';
import { DomainException } from '../src/common/errors/domain-exception';
import { HashService } from '../src/common/crypto/hash.service';
import { canonicalize } from '../src/common/crypto/canonical-json';
import { AuditQueryService } from '../src/modules/audit-query/audit-query.service';
import type { DecisionAuditReadPort } from '../src/modules/audit-query/ports/decision-audit-read.port';
import type {
  AuditEventKeysetQueryDto,
  AuditEventSearchQueryDto,
  ExecutionSearchQueryDto,
} from '../src/modules/audit-query/audit-query.dto';

/**
 * La verificación de la cadena de auditoría es la respuesta a «¿alguien tocó el registro?».
 * Solo sirve si dice que NO en los casos correctos, así que lo que se prueba aquí es cada
 * forma de romperla:
 *
 *  - un eslabón que apunta a un `previousHash` que no es el del evento anterior;
 *  - una carga alterada, que ya no produce el mismo HMAC;
 *  - una clave retirada que ya no está configurada — un evento que **no se puede** verificar
 *    jamás debe contarse como válido.
 *
 * Y el recorrido va por lotes con cursor a propósito: la cadena crece sin cota y cargarla
 * entera sería un DoS barato contra el propio servicio.
 */
describe('AuditQueryService — verificación de la cadena', () => {
  const TENANT = 3n;
  const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
  const hashes = new HashService(
    new ConfigService({ AUDIT_HASH_SECRET: SECRET, AUDIT_HASH_KEY_ID: 'v1' }),
  );

  /** Construye una cadena bien formada de `n` eventos, encadenada como la escribe el motor. */
  function chain(n: number) {
    const events: Array<Record<string, unknown>> = [];
    let previousHash: string | null = null;
    for (let i = 1; i <= n; i += 1) {
      const payload = {
        tenantId: TENANT.toString(),
        eventType: 'PROBE',
        aggregateType: 'Test',
        aggregateId: String(i),
        actorId: 'tester',
        requestId: null,
        payload: { i },
        previousHash,
      };
      const canonicalPayload = canonicalize(payload);
      const eventHash = hashes.hmacWithKey(canonicalPayload, 'v1');
      events.push({
        id: BigInt(i),
        tenantId: TENANT,
        eventType: 'PROBE',
        aggregateType: 'Test',
        aggregateId: String(i),
        actorId: 'tester',
        requestId: null,
        payloadJson: { i },
        previousHash,
        eventHash,
        hashKeyId: 'v1',
        canonicalPayload,
      });
      previousHash = eventHash;
    }
    return events;
  }

  function service(events: Array<Record<string, unknown>>, batchSize = 500) {
    const batches: Array<{ afterId: bigint; batchSize: number }> = [];
    const reads = {
      readAuditChainBatch: (criteria: { afterId: bigint; batchSize: number }) => {
        batches.push(criteria);
        const slice = events
          .filter((event) => (event.id as bigint) > criteria.afterId)
          .slice(0, criteria.batchSize);
        return Promise.resolve(slice);
      },
    } as unknown as DecisionAuditReadPort;
    return {
      sut: new AuditQueryService(
        reads,
        hashes,
        new ConfigService({ AUDIT_VERIFY_BATCH_SIZE: batchSize }),
      ),
      batches,
    };
  }

  it('una cadena intacta es válida y publica su cabeza', async () => {
    const events = chain(3);
    const { sut } = service(events);
    const result = await sut.verifyAuditChain(TENANT);

    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(3);
    expect(result.headHash).toBe(events[2].eventHash);
    expect(result.invalid).toEqual([]);
  });

  it('una cadena vacía es válida y sin cabeza', async () => {
    const { sut } = service([]);
    await expect(sut.verifyAuditChain(TENANT)).resolves.toMatchObject({
      valid: true,
      eventCount: 0,
      headHash: null,
    });
  });

  it('detecta un eslabón que no apunta al evento anterior', async () => {
    const events = chain(3);
    events[1].previousHash = 'sha256:inventado';
    const { sut } = service(events);
    const result = await sut.verifyAuditChain(TENANT);

    expect(result.valid).toBe(false);
    expect(result.invalid).toContainEqual({ id: '2', reason: 'PREVIOUS_HASH_MISMATCH' });
  });

  it('detecta una carga alterada aunque el encadenamiento cuadre', async () => {
    const events = chain(2);
    // Alguien edita el importe en la fila; el HMAC congelado ya no corresponde.
    events[0].canonicalPayload = canonicalize({ manipulado: true });
    const { sut } = service(events);
    const result = await sut.verifyAuditChain(TENANT);

    expect(result.valid).toBe(false);
    expect(result.invalid.map((entry) => entry.reason)).toContain('EVENT_HASH_MISMATCH');
  });

  it('un evento firmado con una clave que ya no existe NO se cuenta como válido', async () => {
    const events = chain(1);
    events[0].hashKeyId = 'clave-retirada-que-nadie-configuro';
    const { sut } = service(events);
    const result = await sut.verifyAuditChain(TENANT);

    // Es la diferencia entre «verificado» y «no se pudo verificar». Tratarlas igual haría
    // que borrar un secreto retirado blanqueara toda la historia firmada con él.
    expect(result.valid).toBe(false);
    expect(result.invalid).toContainEqual({ id: '1', reason: 'HASH_KEY_UNAVAILABLE' });
  });

  it('los eventos antiguos sin carga canónica se verifican reconstruyéndola', async () => {
    // Escritos antes de que existiera la columna: el material se rearma desde las columnas.
    const payload = {
      tenantId: TENANT.toString(),
      eventType: 'VIEJO',
      aggregateType: 'Test',
      aggregateId: '1',
      actorId: 'tester',
      requestId: null,
      payload: { a: 1 },
      previousHash: null,
    };
    const events = [
      {
        id: 1n,
        tenantId: TENANT,
        eventType: 'VIEJO',
        aggregateType: 'Test',
        aggregateId: '1',
        actorId: 'tester',
        requestId: null,
        payloadJson: { a: 1 },
        previousHash: null,
        eventHash: hashes.hmacWithKey(payload, 'v1'),
        hashKeyId: 'v1',
        canonicalPayload: null,
      },
    ];
    const { sut } = service(events);
    await expect(sut.verifyAuditChain(TENANT)).resolves.toMatchObject({ valid: true });
  });

  it('recorre por lotes con cursor en vez de cargar la cadena entera', async () => {
    const { sut, batches } = service(chain(7), 3);
    const result = await sut.verifyAuditChain(TENANT);

    expect(result.eventCount).toBe(7);
    // 3 + 3 + 1: el último lote llega incompleto y corta el bucle sin una consulta de más.
    expect(batches.map((batch) => batch.afterId)).toEqual([0n, 3n, 6n]);
  });

  it('un lote exactamente lleno al final pide una vez más y para al no haber nada', async () => {
    const { sut, batches } = service(chain(6), 3);
    await sut.verifyAuditChain(TENANT);
    expect(batches).toHaveLength(3);
  });
});

describe('AuditQueryService — consultas', () => {
  const TENANT = 3n;
  const hashes = new HashService(new ConfigService({ AUDIT_HASH_SECRET: 'x'.repeat(40) }));

  function service(overrides: Record<string, unknown>) {
    const calls: Record<string, unknown> = {};
    const reads = {
      findExecutionById: () => Promise.resolve(null),
      searchExecutions: (criteria: unknown) => {
        calls.search = criteria;
        return Promise.resolve({ items: [], total: 0 });
      },
      listAuditEvents: (criteria: unknown) => {
        calls.events = criteria;
        return Promise.resolve({ items: [], total: 0 });
      },
      listAuditEventsByCursor: (criteria: unknown) => {
        calls.cursor = criteria;
        return Promise.resolve([]);
      },
      executionMetrics: (tenant: bigint, code?: string) => {
        calls.metrics = { tenant, code };
        return Promise.resolve({ total: 0 });
      },
      ...overrides,
    } as unknown as DecisionAuditReadPort;
    return {
      sut: new AuditQueryService(reads, hashes, new ConfigService({ MAX_PAGE_SIZE: 100 })),
      calls,
    };
  }

  it('una ejecución que no es del tenant es 404, no null', async () => {
    const { sut } = service({});
    const error = await sut.getExecution(TENANT, 1n).catch((caught: unknown) => caught);
    expect((error as DomainException).code).toBe('EXECUTION_NOT_FOUND');
    expect((error as DomainException).status).toBe(404);
  });

  it('el rango de fechas del filtro se traduce a Date, y lo ausente no se envía', async () => {
    const { sut, calls } = service({});
    await sut.searchExecutions(TENANT, {
      from: '2026-01-01T00:00:00.000Z',
    } as ExecutionSearchQueryDto);
    const criteria = calls.search as { from?: Date; to?: Date; tenantId: bigint };
    expect(criteria.tenantId).toBe(TENANT);
    expect(criteria.from).toBeInstanceOf(Date);
    // `to: undefined` en el criterio haría que el adaptador construyera un rango abierto
    // distinto del que se pidió; se omite la clave entera.
    expect('to' in criteria).toBe(false);
  });

  it('la vista por cursor pide una fila de más, que es como sabe si hay página siguiente', async () => {
    const { sut, calls } = service({});
    await sut.listAuditEventsByCursor(TENANT, { pageSize: 10 } as AuditEventKeysetQueryDto);
    expect((calls.cursor as { take: number }).take).toBe(11);
  });

  it('el tamaño de página por cursor se acota a MAX_PAGE_SIZE', async () => {
    const { sut, calls } = service({});
    await sut.listAuditEventsByCursor(TENANT, { pageSize: 5_000 } as AuditEventKeysetQueryDto);
    expect((calls.cursor as { take: number }).take).toBe(101);
  });

  it('el filtro del listado y el del cursor son el mismo, para que no divergan', async () => {
    const { sut, calls } = service({});
    const filtros = { eventType: 'DECISION_EXECUTED', actorId: 'ana' };
    await sut.listAuditEvents(TENANT, filtros as AuditEventSearchQueryDto);
    await sut.listAuditEventsByCursor(TENANT, filtros as AuditEventKeysetQueryDto);
    const listado = calls.events as Record<string, unknown>;
    const cursor = calls.cursor as Record<string, unknown>;
    for (const key of ['tenantId', 'eventType', 'actorId']) {
      expect(cursor[key]).toEqual(listado[key]);
    }
  });

  it('las métricas se piden acotadas al tenant', async () => {
    const { sut, calls } = service({});
    await sut.metrics(TENANT, 'CREDIT');
    expect(calls.metrics).toEqual({ tenant: TENANT, code: 'CREDIT' });
  });
});
