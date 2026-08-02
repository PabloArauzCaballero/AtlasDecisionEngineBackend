import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';
import { seededVariableVersionId } from './support/seeded-variables';

/**
 * Exercises the event backbone (Fase 11) and the notification inbox (Fase 12) end to end
 * against a real Postgres: submitting a version for review writes an outbox event inside
 * the governance transaction, the relay dispatches it, the projector turns it into
 * role-addressed notifications, and the reviewer reads them through the API.
 *
 * Nothing here pokes the outbox directly — the point is that a plain business call
 * produces an inbox entry with no extra wiring.
 */
describe('Notifications inbox (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const artifactCode = `E2E_NOTIFICATIONS_${runId}`;
  // The author holds RISK_ANALYST + QA_ANALYST; the reviewer credentials hold exactly one
  // role each, which is what makes the "only my role's notifications" assertions real.
  const author = managementHeaders('e2e.author');
  const qaAnalyst = managementHeaders('e2e.qa-approver');
  const auditor = managementHeaders('e2e.notifications-auditor', ['AUDITOR']);

  let versionId: string;
  let ageVariableVersionId: string;

  beforeAll(async () => {
    app = await createTestApp({ OUTBOX_RELAY_ENABLED: true });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Polls the inbox until the expected notification lands (the relay dispatches on a timer). */
  async function waitForNotification(
    headers: Record<string, string>,
    predicate: (item: { eventType: string; entityId: string }) => boolean,
    timeoutMs = 20_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await request(server())
        .get('/v1/notifications')
        .query({ pageSize: 50 })
        .set(headers)
        .expect(200);
      const match = response.body.items.find(predicate);
      if (match) return match;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return undefined;
  }

  it('prepares a compiled version with passing blocking tests', async () => {
    ageVariableVersionId = await seededVariableVersionId(app, author, 'age');

    const created = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E notifications artifact',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Exercises the outbox to inbox pipeline end to end.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    versionId = created.body.versions[0].id;

    await request(server())
      .put(`/v1/artifact-versions/${versionId}/graph`)
      .set({ ...author, 'if-match': '1' })
      .send({
        dependencies: [
          {
            variableVersionId: ageVariableVersionId,
            usageType: 'INPUT',
            isRequired: true,
            fallbackPolicy: 'FAIL_CLOSED',
            dependencyPath: 'input.age',
          },
        ],
        conditions: [
          {
            code: 'AGE_OK',
            name: 'Age is at least 21',
            expressionType: 'JSON_AST',
            expression: { op: 'gte', left: { var: 'age' }, right: { value: 21 } },
            severity: 'BLOCKING',
            reusable: true,
          },
        ],
        actions: [
          {
            code: 'SET_APPROVED',
            type: 'SET_OUTCOME',
            payload: { outcome: 'APPROVED' },
            terminal: true,
            reasonCodes: [],
          },
          {
            code: 'SET_DECLINED',
            type: 'SET_OUTCOME',
            payload: { outcome: 'DECLINED' },
            terminal: true,
            reasonCodes: [],
          },
        ],
        nodes: [
          {
            key: 'START',
            type: 'START',
            label: 'Start',
            config: {},
            x: 0,
            y: 0,
            order: 1,
            terminal: false,
            conditions: [],
            actions: [],
          },
          {
            key: 'CHECK',
            type: 'CONDITION',
            label: 'Check age',
            config: {},
            x: 100,
            y: 0,
            order: 2,
            terminal: false,
            conditions: [],
            actions: [],
          },
          {
            key: 'APPROVE',
            type: 'ACTION',
            label: 'Approve',
            config: {},
            x: 200,
            y: -50,
            order: 3,
            terminal: true,
            conditions: [],
            actions: [{ actionCode: 'SET_APPROVED', order: 1 }],
          },
          {
            key: 'DECLINE',
            type: 'ACTION',
            label: 'Decline',
            config: {},
            x: 200,
            y: 50,
            order: 4,
            terminal: true,
            conditions: [],
            actions: [{ actionCode: 'SET_DECLINED', order: 1 }],
          },
        ],
        edges: [
          {
            key: 'START_CHECK',
            from: 'START',
            to: 'CHECK',
            type: 'DEFAULT',
            priority: 1,
            default: true,
            conditions: [],
          },
          {
            key: 'CHECK_APPROVE',
            from: 'CHECK',
            to: 'APPROVE',
            type: 'CONDITIONAL',
            priority: 1,
            default: false,
            conditions: [{ conditionCode: 'AGE_OK', order: 1 }],
          },
          {
            key: 'CHECK_DECLINE',
            from: 'CHECK',
            to: 'DECLINE',
            type: 'DEFAULT',
            priority: 999,
            default: true,
            conditions: [],
          },
        ],
      })
      .expect(200);

    await request(server())
      .post(`/v1/artifact-versions/${versionId}/validate`)
      .set(author)
      .expect(201);
    await request(server())
      .post(`/v1/artifact-versions/${versionId}/compile`)
      .set(author)
      .expect(201);

    const suite = await request(server())
      .post(`/v1/artifact-versions/${versionId}/test-suites`)
      .set(author)
      .send({
        suiteCode: `${artifactCode}_REGRESSION`,
        name: 'Age eligibility regression',
        suiteType: 'REGRESSION',
        isBlocking: true,
        cases: [
          {
            caseCode: 'APPROVE_ADULT',
            testName: 'Approves an adult',
            input: { age: 30 },
            expectedResult: { outcome: 'APPROVED' },
          },
          {
            caseCode: 'DECLINE_YOUNG',
            testName: 'Declines under 21',
            input: { age: 19 },
            expectedResult: { outcome: 'DECLINED' },
          },
        ],
      })
      .expect(201);

    const queued = await request(server())
      .post(`/v1/test-suites/${suite.body.id}/runs`)
      .set(author)
      .send({})
      .expect(202);

    const deadline = Date.now() + 20_000;
    let run = queued;
    while (Date.now() < deadline) {
      run = await request(server()).get(`/v1/test-runs/${queued.body.id}`).set(author).expect(200);
      if (['PASSED', 'FAILED', 'ERROR'].includes(run.body.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(run.body.status).toBe('PASSED');
  }, 60_000);

  it('turns a submit-for-review into an inbox notification for the reviewer role', async () => {
    await request(server())
      .post(`/v1/artifact-versions/${versionId}/submit-for-review`)
      .set(author)
      .send({ requireCompliance: false })
      .expect(201);

    const notification = await waitForNotification(
      qaAnalyst,
      (item) => item.eventType === 'version.submitted_for_review' && item.entityId === versionId,
    );

    expect(notification).toBeDefined();
    expect(notification).toMatchObject({
      category: 'GOVERNANCE',
      recipientRole: 'QA_ANALYST',
      readAt: null,
    });
    expect(notification.title).toContain(artifactCode);
    // Addressed to the role, so it carries no principal id.
    expect(notification.recipientId).toBeNull();
  }, 40_000);

  it('does not show a reviewer notification to an unrelated role', async () => {
    const response = await request(server())
      .get('/v1/notifications')
      .query({ pageSize: 50 })
      .set(auditor)
      .expect(200);

    const leaked = response.body.items.filter(
      (item: { entityId: string }) => item.entityId === versionId,
    );
    expect(leaked).toEqual([]);
  });

  it('counts, marks read and clears the inbox idempotently', async () => {
    const before = await request(server())
      .get('/v1/notifications/unread-count')
      .set(qaAnalyst)
      .expect(200);
    expect(before.body.unread).toBeGreaterThanOrEqual(1);

    const listed = await request(server())
      .get('/v1/notifications')
      .query({ pageSize: 50, unreadOnly: 'true' })
      .set(qaAnalyst)
      .expect(200);
    const target = listed.body.items.find(
      (item: { entityId: string }) => item.entityId === versionId,
    );
    expect(target).toBeDefined();

    const read = await request(server())
      .post(`/v1/notifications/${target.id}/read`)
      .set(qaAnalyst)
      .expect(200);
    expect(read.body.readAt).not.toBeNull();

    // Re-reading is a no-op, not an error, and never moves the original timestamp.
    const again = await request(server())
      .post(`/v1/notifications/${target.id}/read`)
      .set(qaAnalyst)
      .expect(200);
    expect(again.body.readAt).toBe(read.body.readAt);

    await request(server()).post('/v1/notifications/read-all').set(qaAnalyst).expect(200);
    const after = await request(server())
      .get('/v1/notifications/unread-count')
      .set(qaAnalyst)
      .expect(200);
    expect(after.body.unread).toBe(0);
  }, 30_000);

  it('refuses to mark a notification the caller cannot see', async () => {
    const listed = await request(server())
      .get('/v1/notifications')
      .query({ pageSize: 1 })
      .set(qaAnalyst)
      .expect(200);
    if (!listed.body.items.length) return;
    await request(server())
      .post(`/v1/notifications/${listed.body.items[0].id}/read`)
      .set(auditor)
      .expect(404);
  });
});
