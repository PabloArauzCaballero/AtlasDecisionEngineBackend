import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * Las garantías de la cola de los workers, contra PostgreSQL de verdad.
 *
 * Lo que se comprueba aquí no se puede comprobar con dobles: el reclamo atómico
 * es `FOR UPDATE SKIP LOCKED`, la idempotencia es un índice único y el
 * aislamiento por tenant es una política de RLS. Un doble los daría todos por
 * buenos porque los implementaría en JavaScript, que es justo donde NO están.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('cola de los workers adicionales (integración)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  let tenantId: bigint;
  let nextTenant = uniqueTenantId(9);

  beforeEach(() => {
    // Un tenant propio por prueba: es más barato que limpiar, y además hace que
    // los filtros por tenant se ejerciten de verdad en cada caso.
    nextTenant += 1n;
    tenantId = nextTenant;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Crea una ejecución de extracto encolada, con contenido único. */
  async function queueStatement(overrides: Partial<{ fileHash: string }> = {}) {
    return prisma.bankStatementRun.create({
      data: {
        tenantId,
        requestId: randomUUID(),
        status: WorkerRunStatus.QUEUED,
        inputSource: WorkerInputSource.UPLOAD,
        fileName: 'extracto.pdf',
        fileHash: overrides.fileHash ?? randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
        fileSizeBytes: 1_024,
        fileBytes: Buffer.from('%PDF-1.4 contenido de prueba'),
        requestedBy: 'prueba@atlas',
        correlationId: randomUUID(),
      },
    });
  }

  /** El MISMO SQL de reclamo que usa `BankStatementRunWorkerService`. */
  function claim(maxAttempts = 3) {
    return prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      UPDATE decision_bank_statement_run
      SET status = 'RUNNING',
          started_at = now(),
          lease_expires_at = ${new Date(Date.now() + 300_000)},
          attempt_count = attempt_count + 1
      WHERE id = (
        SELECT id FROM decision_bank_statement_run
        WHERE status = 'QUEUED' AND attempt_count < ${maxAttempts} AND tenant_id = ${tenantId}
        ORDER BY queued_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id
    `);
  }

  it('reclama una ejecución y la deja en RUNNING con su lease', async () => {
    const run = await queueStatement();

    const claimed = await claim();

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(run.id);

    const after = await prisma.bankStatementRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe(WorkerRunStatus.RUNNING);
    expect(after.attemptCount).toBe(1);
    expect(after.leaseExpiresAt).not.toBeNull();
    expect(after.startedAt).not.toBeNull();
  });

  it('nunca entrega la misma ejecución a dos reclamos', async () => {
    // Es LA garantía de la cola. Si fallara, dos réplicas convertirían el mismo
    // PDF dos veces y el usuario vería dos resultados para una sola subida.
    await queueStatement();

    const first = await claim();
    const second = await claim();

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('respeta el orden de llegada', async () => {
    const older = await queueStatement();
    // `queued_at` tiene precisión de microsegundos, pero dos inserciones muy
    // seguidas pueden compartir marca. El desempate por `id` del ORDER BY es lo
    // que hace determinista el orden, y esto lo comprueba.
    const newer = await queueStatement();

    const firstClaim = await claim();
    const secondClaim = await claim();

    expect(firstClaim[0]?.id).toBe(older.id);
    expect(secondClaim[0]?.id).toBe(newer.id);
  });

  it('deja de reclamar una ejecución que agotó sus intentos', async () => {
    const run = await queueStatement();
    await prisma.bankStatementRun.update({
      where: { id: run.id },
      data: { attemptCount: 3 },
    });

    // Sin la cota `attempt_count < maxAttempts` en el WHERE, una ejecución que
    // falla siempre giraría en la cola indefinidamente gastando el worker.
    expect(await claim(3)).toHaveLength(0);
  });

  it('rechaza en la BASE una segunda ejecución con el mismo archivo', async () => {
    const fileHash = randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64);
    await queueStatement({ fileHash });

    // La idempotencia NO está en el servicio: está en el índice único. Dos
    // peticiones simultáneas con el mismo archivo pasan las dos por cualquier
    // comprobación previa en JavaScript; aquí la segunda choca contra Postgres.
    await expect(queueStatement({ fileHash })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('permite el mismo archivo en tenants distintos', async () => {
    const fileHash = randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64);
    await queueStatement({ fileHash });

    // La clave única es (tenant, huella). Si fuera sólo la huella, el extracto
    // de un cliente impediría procesar el de otro.
    //
    // `+ 500n` y no `+ 1n`: los tenants de estas pruebas avanzan de uno en uno,
    // así que `tenantId + 1n` es el tenant de la prueba SIGUIENTE. Escribir ahí
    // le dejaba una fila encolada que su reclamo tomaba por delante de la suya,
    // y la prueba de recuperación de leases fallaba por contaminación, no por
    // un defecto del producto.
    const otherTenant = tenantId + 500n;
    await expect(
      prisma.bankStatementRun.create({
        data: {
          tenantId: otherTenant,
          requestId: randomUUID(),
          status: WorkerRunStatus.QUEUED,
          inputSource: WorkerInputSource.UPLOAD,
          fileName: 'extracto.pdf',
          fileHash,
          fileSizeBytes: 1_024,
          requestedBy: 'prueba@atlas',
          correlationId: randomUUID(),
        },
      }),
    ).resolves.toMatchObject({ tenantId: otherTenant });
  });

  it('devuelve a la cola lo que perdió su lease', async () => {
    const run = await queueStatement();
    await claim();
    // Simula el proceso que murió con el job en la mano.
    await prisma.bankStatementRun.update({
      where: { id: run.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });

    const recovered = await prisma.bankStatementRun.updateMany({
      where: {
        tenantId,
        status: WorkerRunStatus.RUNNING,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
      },
      data: { status: WorkerRunStatus.QUEUED, startedAt: null, leaseExpiresAt: null, progress: 0 },
    });

    expect(recovered.count).toBe(1);
    // Y vuelve a ser reclamable: sin esto, un reinicio del worker dejaría el
    // trabajo atascado en RUNNING para siempre.
    expect(await claim()).toHaveLength(1);
  });

  it('no acepta un progreso fuera de 0–100', async () => {
    const run = await queueStatement();

    // La restricción está en la base y no en el código: un processor con un
    // cálculo mal hecho pintaría una barra al 340 % y nadie se enteraría.
    await expect(
      prisma.bankStatementRun.update({ where: { id: run.id }, data: { progress: 340 } }),
    ).rejects.toThrow();
  });

  it('borra el documento al cerrar la ejecución', async () => {
    const run = await queueStatement();
    expect(run.fileBytes).not.toBeNull();

    await prisma.bankStatementRun.update({
      where: { id: run.id },
      data: {
        status: WorkerRunStatus.SUCCEEDED,
        finishedAt: new Date(),
        resultJson: { transactions: [] },
        fileBytes: null,
      },
    });

    const after = await prisma.bankStatementRun.findUniqueOrThrow({ where: { id: run.id } });
    // Es la garantía de privacidad del ADR-0026: se conserva el resultado
    // normalizado, no el extracto bancario.
    expect(after.fileBytes).toBeNull();
    expect(after.resultJson).not.toBeNull();
  });

  it('deduplica el análisis semántico por clave de idempotencia y tenant', async () => {
    const idempotencyKey = randomUUID();
    const base = {
      tenantId,
      status: WorkerRunStatus.QUEUED,
      inputSource: WorkerInputSource.INLINE,
      inputText: 'Hay un cargo que no reconozco.',
      requestedBy: 'prueba@atlas',
      correlationId: randomUUID(),
    };

    await prisma.semanticAnalysisRun.create({
      data: { ...base, requestId: randomUUID(), idempotencyKey },
    });

    await expect(
      prisma.semanticAnalysisRun.create({
        data: { ...base, requestId: randomUUID(), idempotencyKey },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
