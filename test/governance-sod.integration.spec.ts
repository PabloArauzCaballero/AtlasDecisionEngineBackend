import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ApprovalRequestStatus,
  ApprovalStepStatus,
  PrismaClient,
  VersionStatus,
} from '@prisma/client';
import { AuditService } from '../src/common/audit/audit.service';
import { HashService } from '../src/common/crypto/hash.service';
import { OutboxPublisherService } from '../src/common/events/outbox-publisher.service';
import type { JobSignalService } from '../src/common/jobs/job-signal.service';
import { PlatformRole } from '../src/common/security/platform-roles';
import { GovernanceService } from '../src/modules/governance/governance.service';
import { VersionStateService } from '../src/modules/artifacts/version-state.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { TestExecutionService } from '../src/modules/testing/test-execution.service';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * Governance / separation-of-duties guard rails on `recordDecision`.
 *
 * These are the checks that stand between a draft policy and one that can decide money, so
 * every rejection path is provoked explicitly: wrong tenant, out-of-order steps, missing role,
 * the author approving their own version, and double-voting. The happy paths assert the
 * request *and* the version both reach their terminal state.
 *
 * Needs a database: the ordering/duplicate rules are enforced against persisted rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('GovernanceService separation of duties (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const config = new ConfigService({ AUDIT_HASH_SECRET: 'test-secret-that-is-long-enough' });
  // Only submitForReview consults the test runner; its verdict is the gate under test there,
  // so it is stubbed rather than running a real suite.
  const verifyBlockingTests = jest.fn();
  const service = new GovernanceService(
    prisma as unknown as PrismaService,
    { verifyBlockingTests } as unknown as TestExecutionService,
    new VersionStateService(prisma as unknown as PrismaService),
    new AuditService(prisma as unknown as PrismaService, new HashService(config)),
    new OutboxPublisherService({
      notify: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobSignalService),
    config,
  );

  beforeEach(() => {
    verifyBlockingTests.mockReset();
    verifyBlockingTests.mockResolvedValue({ passed: true, evidence: { coverage: 100 } });
  });

  // Unique per process so concurrent runs against one database cannot delete each other's rows.
  const tenantId = uniqueTenantId(6);
  const AUTHOR = 'author@atlas.test';

  const principal = (id: string, roles: string[]): AuthenticatedPrincipal =>
    ({ id, roles, tenantId, requestId: 'req-test' }) as unknown as AuthenticatedPrincipal;

  const evidence = [{ evidenceType: 'TEST_REPORT', uri: 'https://ci/run/1', checksum: 'abc123' }];
  const approve = { decision: 'APPROVE' as const, evidence };

  /** A version IN_REVIEW with a two-step (QA then RISK) approval request. */
  async function fixture() {
    const artifact = await prisma.decisionArtifact.create({
      data: {
        tenantId,
        artifactCode: `SOD_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        artifactType: 'CREDIT_POLICY',
        name: 'SoD fixture',
        description: 'Governance guard-rail fixture',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Exercise the approval workflow',
        riskDomain: 'CREDIT_ORIGINATION',
      },
    });
    const version = await prisma.decisionArtifactVersion.create({
      data: {
        artifactId: artifact.id,
        versionNumber: 1,
        semanticVersion: '1.0.0',
        status: VersionStatus.IN_REVIEW,
        changeSummary: 'fixture',
        createdBy: AUTHOR,
      },
    });
    const request = await prisma.decisionApprovalRequest.create({
      data: {
        artifactVersionId: version.id,
        workflowCode: 'STANDARD',
        requestedBy: AUTHOR,
        status: ApprovalRequestStatus.IN_REVIEW,
        steps: {
          create: [
            {
              stepOrder: 1,
              requiredRole: PlatformRole.QA_ANALYST,
              minApprovals: 1,
              separationOfDuties: true,
            },
            {
              stepOrder: 2,
              requiredRole: PlatformRole.RISK_APPROVER,
              minApprovals: 1,
              separationOfDuties: true,
            },
          ],
        },
      },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    return { artifact, version, request, qaStep: request.steps[0], riskStep: request.steps[1] };
  }

  afterEach(async () => {
    // Cascades clear versions, requests, steps and decisions. Audit events are deliberately
    // NOT cleaned: `decision_audit_event` is append-only (the RLS migration revokes DELETE
    // from atlas_app), which is the property under test elsewhere. Each assertion scopes to
    // its own request id, so leftover events from earlier runs cannot affect it.
    await prisma.decisionArtifact.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects a step that belongs to another tenant', async () => {
    const { qaStep } = await fixture();
    await expect(
      service.recordDecision(
        tenantId + 1n,
        qaStep.id,
        approve,
        principal('qa@atlas.test', [PlatformRole.QA_ANALYST]),
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_STEP_NOT_FOUND' });
  });

  it('refuses a later step while an earlier one is still pending', async () => {
    const { riskStep } = await fixture();
    await expect(
      service.recordDecision(
        tenantId,
        riskStep.id,
        approve,
        principal('risk@atlas.test', [PlatformRole.RISK_APPROVER]),
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_STEP_OUT_OF_ORDER' });
  });

  it('refuses a principal that lacks the step role', async () => {
    const { qaStep } = await fixture();
    await expect(
      service.recordDecision(
        tenantId,
        qaStep.id,
        approve,
        principal('risk@atlas.test', [PlatformRole.RISK_APPROVER]),
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_ROLE_REQUIRED' });
  });

  it('lets a platform admin stand in for the required role', async () => {
    const { qaStep } = await fixture();
    const decision = await service.recordDecision(
      tenantId,
      qaStep.id,
      approve,
      principal('admin@atlas.test', [PlatformRole.PLATFORM_ADMIN]),
    );
    expect(decision.decision).toBe('APPROVE');
  });

  it('refuses the version author approving their own version', async () => {
    const { qaStep } = await fixture();
    // Author holds the required role — only separation of duties stops them.
    await expect(
      service.recordDecision(
        tenantId,
        qaStep.id,
        approve,
        principal(AUTHOR, [PlatformRole.QA_ANALYST]),
      ),
    ).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES_VIOLATION' });
  });

  it('refuses the same principal deciding one step twice', async () => {
    const { qaStep } = await fixture();
    const qa = principal('qa@atlas.test', [PlatformRole.QA_ANALYST]);
    await service.recordDecision(tenantId, qaStep.id, approve, qa);
    // The step closes on the first approval, so a repeat is refused as closed.
    await expect(service.recordDecision(tenantId, qaStep.id, approve, qa)).rejects.toMatchObject({
      code: 'APPROVAL_STEP_CLOSED',
    });
  });

  it('approves the request and the version only once every step is approved', async () => {
    const { version, request, qaStep, riskStep } = await fixture();

    await service.recordDecision(
      tenantId,
      qaStep.id,
      approve,
      principal('qa@atlas.test', [PlatformRole.QA_ANALYST]),
    );

    // One step approved is not enough: the request and version must still be under review.
    const midRequest = await prisma.decisionApprovalRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    const midVersion = await prisma.decisionArtifactVersion.findUniqueOrThrow({
      where: { id: version.id },
    });
    expect(midRequest.status).toBe(ApprovalRequestStatus.IN_REVIEW);
    expect(midVersion.status).toBe(VersionStatus.IN_REVIEW);

    await service.recordDecision(
      tenantId,
      riskStep.id,
      approve,
      principal('risk@atlas.test', [PlatformRole.RISK_APPROVER]),
    );

    const finalRequest = await prisma.decisionApprovalRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    const finalVersion = await prisma.decisionArtifactVersion.findUniqueOrThrow({
      where: { id: version.id },
    });
    expect(finalRequest.status).toBe(ApprovalRequestStatus.APPROVED);
    expect(finalVersion.status).toBe(VersionStatus.APPROVED);
  });

  it('rejects the whole request when any step is rejected', async () => {
    const { version, request, qaStep } = await fixture();
    await service.recordDecision(
      tenantId,
      qaStep.id,
      { decision: 'REJECT', evidence, comments: 'Coverage gap' },
      principal('qa@atlas.test', [PlatformRole.QA_ANALYST]),
    );

    const finalRequest = await prisma.decisionApprovalRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    const finalVersion = await prisma.decisionArtifactVersion.findUniqueOrThrow({
      where: { id: version.id },
    });
    const step = await prisma.decisionApprovalStep.findUniqueOrThrow({ where: { id: qaStep.id } });
    expect(finalRequest.status).toBe(ApprovalRequestStatus.REJECTED);
    expect(finalVersion.status).toBe(VersionStatus.REJECTED);
    expect(step.status).toBe(ApprovalStepStatus.REJECTED);
  });

  it('sends the version back on REQUEST_CHANGES', async () => {
    const { version, request, qaStep } = await fixture();
    await service.recordDecision(
      tenantId,
      qaStep.id,
      { decision: 'REQUEST_CHANGES', evidence, comments: 'Tighten the threshold' },
      principal('qa@atlas.test', [PlatformRole.QA_ANALYST]),
    );

    const finalRequest = await prisma.decisionApprovalRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    const finalVersion = await prisma.decisionArtifactVersion.findUniqueOrThrow({
      where: { id: version.id },
    });
    expect(finalRequest.status).toBe(ApprovalRequestStatus.CHANGES_REQUESTED);
    expect(finalVersion.status).toBe(VersionStatus.CHANGES_REQUESTED);
  });

  it('keeps a step open until it reaches minApprovals, and refuses a repeat voter', async () => {
    const { qaStep } = await fixture();
    // Two approvals required, so the step stays PENDING after the first vote — which is the
    // only way to reach the duplicate-voter guard rather than the closed-step one.
    await prisma.decisionApprovalStep.update({
      where: { id: qaStep.id },
      data: { minApprovals: 2 },
    });
    const qa = principal('qa@atlas.test', [PlatformRole.QA_ANALYST]);

    await service.recordDecision(tenantId, qaStep.id, approve, qa);
    expect(
      (await prisma.decisionApprovalStep.findUniqueOrThrow({ where: { id: qaStep.id } })).status,
    ).toBe(ApprovalStepStatus.PENDING);

    await expect(service.recordDecision(tenantId, qaStep.id, approve, qa)).rejects.toMatchObject({
      code: 'DUPLICATE_APPROVAL_DECISION',
    });

    // A different QA analyst completes the step.
    await service.recordDecision(
      tenantId,
      qaStep.id,
      approve,
      principal('qa2@atlas.test', [PlatformRole.QA_ANALYST]),
    );
    expect(
      (await prisma.decisionApprovalStep.findUniqueOrThrow({ where: { id: qaStep.id } })).status,
    ).toBe(ApprovalStepStatus.APPROVED);
  });

  it('writes an audit event in the same transaction as the decision', async () => {
    const { request, qaStep } = await fixture();
    await service.recordDecision(
      tenantId,
      qaStep.id,
      approve,
      principal('qa@atlas.test', [PlatformRole.QA_ANALYST]),
    );

    const events = await prisma.decisionAuditEvent.findMany({
      where: { tenantId, aggregateId: request.id.toString() },
    });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('APPROVAL_APPROVE');
  });

  describe('submitForReview', () => {
    /** A COMPILED version with a successful compiled artifact — the only reviewable shape. */
    async function compiledFixture(status: VersionStatus = VersionStatus.COMPILED) {
      const artifact = await prisma.decisionArtifact.create({
        data: {
          tenantId,
          artifactCode: `SUBMIT_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
          artifactType: 'CREDIT_POLICY',
          name: 'Submit fixture',
          description: 'Governance submit fixture',
          ownerTeam: 'RISK_DECISIONING',
          businessPurpose: 'Exercise submitForReview',
          riskDomain: 'CREDIT_ORIGINATION',
        },
      });
      const version = await prisma.decisionArtifactVersion.create({
        data: {
          artifactId: artifact.id,
          versionNumber: 1,
          semanticVersion: '1.0.0',
          status,
          changeSummary: 'fixture',
          createdBy: AUTHOR,
          compiledArtifacts: {
            create: {
              compilerVersion: 'atlas-compiler-1.0.0',
              runtimeSchemaVersion: '1.0',
              compiledPayloadJson: {},
              compiledChecksum: `chk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
              compileStatus: 'SUCCESS',
            },
          },
        },
      });
      return { version };
    }

    const author = principal(AUTHOR, [PlatformRole.RISK_ANALYST]);

    it('refuses a version that is not COMPILED', async () => {
      const { version } = await compiledFixture(VersionStatus.DRAFT);
      await expect(
        service.submitForReview(tenantId, version.id, { requireCompliance: false }, author),
      ).rejects.toMatchObject({
        code: 'VERSION_NOT_REVIEWABLE',
      });
    });

    it('refuses a version whose blocking tests have not passed', async () => {
      const { version } = await compiledFixture();
      verifyBlockingTests.mockResolvedValue({ passed: false, evidence: { coverage: 12 } });
      await expect(
        service.submitForReview(tenantId, version.id, { requireCompliance: false }, author),
      ).rejects.toMatchObject({
        code: 'BLOCKING_TESTS_NOT_PASSED',
      });
    });

    it('refuses a second active approval request for the same version', async () => {
      const { version } = await compiledFixture();
      // A plain double-submit cannot reach this guard: the first call moves the version to
      // IN_REVIEW, so the second is stopped earlier by VERSION_NOT_REVIEWABLE. The guard exists
      // for the inconsistent state where a request is already open on a still-COMPILED version,
      // so that is what is built here.
      await prisma.decisionApprovalRequest.create({
        data: {
          artifactVersionId: version.id,
          workflowCode: 'STANDARD',
          requestedBy: AUTHOR,
          status: ApprovalRequestStatus.IN_REVIEW,
        },
      });

      await expect(
        service.submitForReview(tenantId, version.id, { requireCompliance: false }, author),
      ).rejects.toMatchObject({ code: 'APPROVAL_REQUEST_EXISTS' });
    });

    it('creates the QA and RISK steps and moves the version to IN_REVIEW', async () => {
      const { version } = await compiledFixture();
      const request = await service.submitForReview(
        tenantId,
        version.id,
        { requireCompliance: false },
        author,
      );

      expect(request.steps.map((step) => step.requiredRole)).toEqual([
        PlatformRole.QA_ANALYST,
        PlatformRole.RISK_APPROVER,
      ]);
      expect(
        (await prisma.decisionArtifactVersion.findUniqueOrThrow({ where: { id: version.id } }))
          .status,
      ).toBe(VersionStatus.IN_REVIEW);
    });

    it('adds a compliance step when the workflow requires it', async () => {
      const { version } = await compiledFixture();
      const request = await service.submitForReview(
        tenantId,
        version.id,
        { requireCompliance: true },
        author,
      );

      expect(request.steps.map((step) => step.requiredRole)).toEqual([
        PlatformRole.QA_ANALYST,
        PlatformRole.RISK_APPROVER,
        PlatformRole.COMPLIANCE,
      ]);
      expect(request.workflowCode).toBe('STANDARD_WITH_COMPLIANCE');
    });
  });

  describe('queries', () => {
    it('refuses to submit a version that does not exist', async () => {
      await expect(
        service.submitForReview(
          tenantId,
          2n ** 40n,
          { requireCompliance: false },
          principal(AUTHOR, []),
        ),
      ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
    });

    it('returns a request by id and hides other tenants', async () => {
      const { request } = await fixture();

      const found = await service.getRequest(tenantId, request.id);
      expect(found.id).toBe(request.id);
      expect(found.steps).toHaveLength(2);

      await expect(service.getRequest(tenantId + 1n, request.id)).rejects.toMatchObject({
        code: 'APPROVAL_REQUEST_NOT_FOUND',
      });
    });

    it('lists the tenant requests with their current step and SLA status', async () => {
      const { request } = await fixture();

      const page = await service.listRequests(tenantId, { page: 1, pageSize: 20 } as never);
      const listed = page.items.find((item) => item.id === request.id);
      expect(listed).toBeDefined();
      // The first pending step drives "currentStep"; nothing is overdue without a dueAt.
      expect(listed?.currentStep).toBe(PlatformRole.QA_ANALYST);
      expect(listed?.slaStatus).toBe('ON_TRACK');

      // Another tenant sees none of it.
      const otherPage = await service.listRequests(tenantId + 1n, {
        page: 1,
        pageSize: 20,
      } as never);
      expect(otherPage.items.some((item) => item.id === request.id)).toBe(false);
    });
  });

  describe('assertApproved', () => {
    it('passes for an APPROVED version and refuses anything else', async () => {
      const { version } = await fixture();
      // The fixture version is still IN_REVIEW.
      await expect(service.assertApproved(tenantId, version.id)).rejects.toBeDefined();

      await prisma.decisionArtifactVersion.update({
        where: { id: version.id },
        data: { status: VersionStatus.APPROVED },
      });
      await expect(service.assertApproved(tenantId, version.id)).resolves.toBeUndefined();
    });
  });
});
