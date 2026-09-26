import { ConfigService } from '@nestjs/config';
import { GovernanceService } from '../src/modules/governance/governance.service';
import { TestSuiteService } from '../src/modules/testing/test-suite.service';
import { TraceabilityService } from '../src/modules/traceability/traceability.service';

const config = new ConfigService({ MAX_PAGE_SIZE: 100 });

describe('frontend read endpoints', () => {
  it('returns a tenant-scoped, flattened approval inbox row', async () => {
    const requestedAt = new Date('2026-07-13T10:00:00.000Z');
    const findMany = jest.fn();
    const count = jest.fn();
    const prisma = {
      decisionApprovalRequest: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([
        [
          {
            id: 10n,
            requestedAt,
            dueAt: new Date('2099-01-01T00:00:00.000Z'),
            status: 'IN_REVIEW',
            artifactVersion: {
              versionNumber: 4,
              artifact: { artifactCode: 'CREDIT-RISK' },
            },
            steps: [{ stepOrder: 1, requiredRole: 'QA_ANALYST', status: 'PENDING' }],
          },
        ],
        1,
      ]),
    };
    const service = new GovernanceService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      config,
    );

    const result = await service.listRequests(7n, { page: 1, pageSize: 25 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { artifactVersion: { artifact: { tenantId: 7n } } },
        orderBy: { requestedAt: 'desc' },
      }),
    );
    expect(result.items[0]).toMatchObject({
      artifactCode: 'CREDIT-RISK',
      versionNumber: 4,
      currentStep: 'QA_ANALYST',
      slaStatus: 'ON_TRACK',
      createdAt: requestedAt,
    });
  });

  it('checks the suite tenant before returning test cases', async () => {
    const findSuite = jest.fn().mockResolvedValue({ id: 12n });
    const findCases = jest.fn().mockResolvedValue([{ id: 3n, caseCode: 'CASE-001' }]);
    const service = new TestSuiteService(
      {
        decisionTestSuite: { findFirst: findSuite },
        decisionTestCase: { findMany: findCases },
      } as never,
      {} as never,
      config,
    );

    await expect(service.listCases(7n, 12n)).resolves.toEqual([{ id: 3n, caseCode: 'CASE-001' }]);
    expect(findSuite).toHaveBeenCalledWith({
      where: { id: 12n, artifactVersion: { artifact: { tenantId: 7n } } },
      select: { id: true },
    });
    expect(findCases).toHaveBeenCalledWith({
      where: { testSuiteId: 12n },
      orderBy: { caseCode: 'asc' },
    });
  });

  it('builds COMPLETE, PARTIAL and GAP traceability cells', async () => {
    const service = new TraceabilityService(
      {
        businessObjective: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 1n,
              objectiveCode: 'OBJ-001',
              name: 'Reduce fraud',
              policyRequirements: [
                {
                  id: 11n,
                  policyCode: 'POL-A',
                  artifactLinks: [{}],
                  testLinks: [{}],
                },
                {
                  id: 12n,
                  policyCode: 'POL-B',
                  artifactLinks: [{}],
                  testLinks: [],
                },
                {
                  id: 13n,
                  policyCode: 'POL-C',
                  artifactLinks: [],
                  testLinks: [],
                },
              ],
            },
          ]),
        },
      } as never,
      {} as never,
      config,
    );

    const result = await service.coverageMatrix(7n);

    expect(result.total).toBe(3);
    expect(result.covered).toBe(1);
    expect(result.objectives[0].coverage).toEqual({
      'POL-A': 'COMPLETE',
      'POL-B': 'PARTIAL',
      'POL-C': 'GAP',
    });
  });
});
