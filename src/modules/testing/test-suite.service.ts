import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CreateTestSuiteDto, TestCaseDto, TestSuiteListQueryDto } from './testing.dto';

@Injectable()
export class TestSuiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async createSuite(
    tenantId: bigint,
    versionId: bigint,
    dto: CreateTestSuiteDto,
    principal: AuthenticatedPrincipal,
  ) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      select: { id: true },
    });
    if (!version)
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
<<<<<<< Updated upstream
    const suite = await this.prisma.decisionTestSuite.create({
      data: {
        artifactVersionId: versionId,
        suiteCode: dto.suiteCode,
        name: dto.name,
        suiteType: dto.suiteType,
        isBlocking: dto.isBlocking,
        cases: {
          create: dto.cases.map((testCase) => ({
            caseCode: testCase.caseCode,
            testName: testCase.testName,
            inputJson: testCase.input as Prisma.InputJsonValue,
            expectedResultJson:
              testCase.expectedResult as Prisma.InputJsonValue,
            tagsJson: testCase.tags as Prisma.InputJsonValue | undefined,
            isActive: testCase.isActive ?? true,
          })),
        },
      },
      include: { cases: true },
=======
    return this.prisma.$transaction(async (tx) => {
      const suite = await tx.decisionTestSuite.create({
        data: {
          artifactVersionId: versionId,
          suiteCode: dto.suiteCode,
          name: dto.name,
          suiteType: dto.suiteType,
          isBlocking: dto.isBlocking,
          cases: {
            create: dto.cases.map((testCase) => ({
              caseCode: testCase.caseCode,
              testName: testCase.testName,
              inputJson: testCase.input as Prisma.InputJsonValue,
              expectedResultJson: testCase.expectedResult as Prisma.InputJsonValue,
              tagsJson: testCase.tags as Prisma.InputJsonValue | undefined,
              isActive: testCase.isActive ?? true,
            })),
          },
        },
        include: { cases: true },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'TEST_SUITE_CREATED',
          aggregateType: 'TestSuite',
          aggregateId: suite.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            suiteCode: suite.suiteCode,
            cases: suite.cases.length,
            blocking: suite.isBlocking,
          },
        },
        tx,
      );
      return suite;
>>>>>>> Stashed changes
    });
    await this.audit.append({
      tenantId,
      eventType: "TEST_SUITE_CREATED",
      aggregateType: "TestSuite",
      aggregateId: suite.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: {
        suiteCode: suite.suiteCode,
        cases: suite.cases.length,
        blocking: suite.isBlocking,
      },
    });
    return suite;
  }

  async listSuites(tenantId: bigint, versionId: bigint, query: TestSuiteListQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(
      query,
      this.config.get<number>('MAX_PAGE_SIZE') ?? 100,
    );
    const where = {
      artifactVersionId: versionId,
      artifactVersion: { artifact: { tenantId } },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.decisionTestSuite.findMany({
        where,
        include: {
          cases: true,
          runs: {
            orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
            take: 5,
            include: { coverage: true },
          },
        },
        orderBy: { suiteCode: 'asc' },
        skip,
        take,
      }),
      this.prisma.decisionTestSuite.count({ where }),
    ]);
    return pageResult(items, total, page, pageSize);
  }

  async listCases(tenantId: bigint, suiteId: bigint) {
    const suite = await this.prisma.decisionTestSuite.findFirst({
      where: { id: suiteId, artifactVersion: { artifact: { tenantId } } },
      select: { id: true },
    });
    if (!suite)
      throw new DomainException(
        'TEST_SUITE_NOT_FOUND',
        'Test suite not found',
        HttpStatus.NOT_FOUND,
      );
    return this.prisma.decisionTestCase.findMany({
      where: { testSuiteId: suiteId },
      orderBy: { caseCode: 'asc' },
    });
  }

  async addCases(
    tenantId: bigint,
    suiteId: bigint,
    cases: TestCaseDto[],
    principal: AuthenticatedPrincipal,
  ) {
    const suite = await this.prisma.decisionTestSuite.findFirst({
      where: { id: suiteId, artifactVersion: { artifact: { tenantId } } },
      select: { id: true },
    });
    if (!suite)
      throw new DomainException(
        'TEST_SUITE_NOT_FOUND',
        'Test suite not found',
        HttpStatus.NOT_FOUND,
      );

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.decisionTestCase.createManyAndReturn({
        data: cases.map((testCase) => ({
          testSuiteId: suiteId,
          caseCode: testCase.caseCode,
          testName: testCase.testName,
          inputJson: testCase.input as Prisma.InputJsonValue,
          expectedResultJson: testCase.expectedResult as Prisma.InputJsonValue,
          tagsJson: testCase.tags as Prisma.InputJsonValue | undefined,
          isActive: testCase.isActive ?? true,
        })),
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'TEST_CASES_ADDED',
          aggregateType: 'TestSuite',
          aggregateId: suiteId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            caseCodes: created.map((testCase) => testCase.caseCode),
            count: created.length,
          },
        },
        tx,
      );
      return created;
    });
  }
}
