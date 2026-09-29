import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AtlasCallbackService } from '../src/modules/atlas-callback/atlas-callback.service';
import type { ManualReviewListQueryDto } from '../src/modules/manual-review/manual-review.dto';
import { ManualReviewService } from '../src/modules/manual-review/manual-review.service';
import { createDecisionFixture, createExecution } from './support/decision-fixture';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * «Buscar caso» de la cola de revisión manual, contra Postgres.
 *
 * El portal mandaba `queueCode`, que el motor compara por IGUALDAD con la cola: escribir el código
 * de un caso o un request ID devolvía siempre cero filas. Ahora manda `search`, que recorre el
 * código del caso y el request ID de su ejecución. Los datos distinguen: cada término acierta en
 * una columna y en un caso distinto, y `%` y `_` se buscan como texto, no como comodines.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('ManualReviewService.list · search (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const service = new ManualReviewService(
    prisma as unknown as PrismaService,
    {} as AuditService,
    new ConfigService({ MAX_PAGE_SIZE: 100 }),
    {} as AtlasCallbackService,
  );
  const tenantId = uniqueTenantId(61);
  const otherTenantId = uniqueTenantId(62);
  const suffix = tenantId.toString(36).slice(-6).toUpperCase();
  const CODE_A = `MR-${suffix}-0042`;
  const CODE_B = `MR-${suffix}-0043`;
  const CODE_C = `MR-${suffix}-0044`;

  const list = (query: Partial<ManualReviewListQueryDto>) =>
    service.list(tenantId, { page: 1, pageSize: 25, ...query } as ManualReviewListQueryDto);
  const codes = async (query: Partial<ManualReviewListQueryDto>) =>
    (await list(query)).items.map((item) => item.caseCode).sort();

  beforeAll(async () => {
    const fixture = await createDecisionFixture(prisma, tenantId);
    const foreign = await createDecisionFixture(prisma, otherTenantId);
    const seed = async (
      owner: bigint,
      fix: typeof fixture,
      caseCode: string,
      requestId: string,
      status: 'OPEN' | 'RESOLVED_DECLINED',
    ) => {
      const execution = await createExecution(prisma, owner, fix, { requestId });
      await prisma.decisionManualReviewCase.create({
        data: {
          executionId: execution.id,
          tenantId: owner,
          caseCode,
          queueCode: 'IDENTIDAD',
          status,
          dueAt: new Date('2026-10-01T00:00:00.000Z'),
          evidenceJson: {},
        },
      });
    };
    await seed(tenantId, fixture, CODE_A, `req-alfa-${suffix}`, 'OPEN');
    await seed(tenantId, fixture, CODE_B, `req_beta_${suffix}`, 'RESOLVED_DECLINED');
    await seed(tenantId, fixture, CODE_C, `100%-${suffix}`, 'OPEN');
    await seed(otherTenantId, foreign, `MR-${suffix}-9999`, `req-ajeno-${suffix}`, 'OPEN');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('encuentra un caso por su código completo y por una parte, sin distinguir mayúsculas', async () => {
    expect(await codes({ search: CODE_A })).toEqual([CODE_A]);
    expect(await codes({ search: `mr-${suffix.toLowerCase()}-0043` })).toEqual([CODE_B]);
    expect(await codes({ search: `-0044` })).toEqual([CODE_C]);
    expect(await codes({ search: `MR-${suffix}` })).toEqual([CODE_A, CODE_B, CODE_C]);
  });

  it('encuentra un caso por el request ID de su ejecución', async () => {
    expect(await codes({ search: `req-alfa` })).toEqual([CODE_A]);
    expect(await codes({ search: `ALFA-${suffix}` })).toEqual([CODE_A]);
  });

  it('con el arreglo anterior fallaba: el código de un caso NO es una cola (`queueCode` es igualdad)', async () => {
    expect(await codes({ queueCode: CODE_A })).toEqual([]);
    expect(await codes({ queueCode: 'IDENT' })).toEqual([]);
    expect((await codes({ queueCode: 'IDENTIDAD' })).length).toBe(3);
  });

  it('busca `%` y `_` como texto, no como comodines', async () => {
    // Como comodín, `%` devolvería los tres casos y `_` los que tengan cualquier carácter.
    expect(await codes({ search: '%' })).toEqual([CODE_C]);
    expect(await codes({ search: `100%-${suffix}` })).toEqual([CODE_C]);
    expect(await codes({ search: 'req_beta' })).toEqual([CODE_B]);
    expect(await codes({ search: 'req_alfa' })).toEqual([]);
    expect(await codes({ search: 'r_q-alfa' })).toEqual([]);
  });

  it('se combina con Y con el estado y no cruza de tenant', async () => {
    expect(await codes({ search: `MR-${suffix}`, status: 'RESOLVED_DECLINED' })).toEqual([CODE_B]);
    expect(await codes({ search: 'req-ajeno' })).toEqual([]);
    expect(await codes({ search: `MR-${suffix}-9999` })).toEqual([]);
  });

  it('un texto vacío o de espacios no filtra: es la caja recién vaciada', async () => {
    expect((await codes({ search: '   ' })).length).toBe(3);
    expect(await codes({ search: 'no-existe-en-ningun-lado' })).toEqual([]);
  });

  it('devuelve la ejecución resumida que pinta la cola', async () => {
    const { items, total } = await list({ search: CODE_A });
    expect(total).toBe(1);
    expect(items[0]?.execution.requestId).toBe(`req-alfa-${suffix}`);
    expect(items[0]?.status).toBe('OPEN');
  });
});
