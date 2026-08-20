/**
 * Un riesgo ALTO al entrar en revisión avisa a cumplimiento y a fraude.
 *
 * La detección ya existía (`SecurityReviewService.computeFindings`) y la notificación
 * también (`notification-projector.service.ts`), pero nadie emitía `security.risk_detected`:
 * las dos mitades estaban escritas y desconectadas, así que el aviso no llegaba nunca.
 *
 * El envío a revisión es el momento correcto para emitirlo —ocurre una vez y todavía se
 * puede actuar—, no la lectura del panel, que es un GET y dispararía un aviso por cada carga
 * de página.
 *
 * Lo detectó el smoke integral, al quedarse sin emisor la rama del proyector.
 */
import { ConfigService } from '@nestjs/config';
import { GovernanceService } from '../src/modules/governance/governance.service';
import { NotificationProjectorService } from '../src/modules/notifications/notification-projector.service';
import { DecisionEventType } from '../src/common/events/event-types';

const HIGH_REVIEW = {
  severity: 'HIGH',
  findings: [
    { severity: 'HIGH', code: 'SENSITIVE_VARIABLES', message: '1 variable sensible.' },
    { severity: 'MEDIUM', code: 'NESTED_REFERENCES', message: '1 referencia anidada.' },
  ],
};

function governanceWith(review: unknown) {
  const published: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const version = {
    id: 7n,
    versionNumber: 3,
    status: 'COMPILED',
    artifactId: 1n,
    createdBy: 'autor',
    artifact: { artifactCode: 'CREDIT_POLICY', tenantId: 1n },
    compiledArtifacts: [{ id: 9n, compileStatus: 'SUCCESS' }],
  };

  const created = { id: 11n, steps: [{ id: 21n, stepOrder: 1, requiredRole: 'QA_ANALYST' }] };
  const tx = {
    decisionApprovalRequest: { create: jest.fn().mockResolvedValue(created) },
  };

  const prisma = {
    decisionArtifactVersion: { findFirst: jest.fn().mockResolvedValue(version) },
    decisionApprovalRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx)),
  };

  const service = new GovernanceService(
    prisma as never,
    {
      verifyBlockingTests: jest.fn().mockResolvedValue({ passed: true, evidence: {} }),
    } as never,
    { transition: jest.fn() } as never,
    { append: jest.fn() } as never,
    {
      publish: jest.fn(async (_tx: unknown, envelope: { eventType: string; payload: unknown }) => {
        published.push(envelope as never);
      }),
    } as never,
    { getVersionReview: jest.fn().mockResolvedValue(review) } as never,
    new ConfigService({}),
  );

  return { service, published };
}

const PRINCIPAL = {
  id: 'analista',
  requestId: 'req-1',
  tenantId: 1n,
  roles: [],
  audience: 'management',
};

describe('aviso de riesgo de seguridad', () => {
  it('emite security.risk_detected cuando la versión entra en revisión con riesgo ALTO', async () => {
    const { service, published } = governanceWith(HIGH_REVIEW);

    await service.submitForReview(
      1n,
      7n,
      { requireCompliance: false } as never,
      PRINCIPAL as never,
    );

    const risk = published.find(
      (event) => event.eventType === DecisionEventType.SECURITY_RISK_DETECTED,
    );
    expect(risk).toBeDefined();
    expect(risk?.payload.severity).toBe('HIGH');
    expect(risk?.payload.findingCodes).toEqual(['SENSITIVE_VARIABLES', 'NESTED_REFERENCES']);
    // El resumen nombra el hallazgo ALTO, que es lo accionable.
    expect(String(risk?.payload.summary)).toContain('SENSITIVE_VARIABLES');
  });

  it('no avisa cuando el riesgo no es ALTO', async () => {
    const { service, published } = governanceWith({
      severity: 'MEDIUM',
      findings: [{ severity: 'MEDIUM', code: 'NESTED_REFERENCES', message: 'x' }],
    });

    await service.submitForReview(
      1n,
      7n,
      { requireCompliance: false } as never,
      PRINCIPAL as never,
    );

    // Un aviso por cada hallazgo menor entrena a quien lo recibe a ignorarlos.
    expect(
      published.some((event) => event.eventType === DecisionEventType.SECURITY_RISK_DETECTED),
    ).toBe(false);
    expect(
      published.some((event) => event.eventType === DecisionEventType.VERSION_SUBMITTED_FOR_REVIEW),
    ).toBe(true);
  });

  it('el proyector lo convierte en aviso para cumplimiento y fraude', () => {
    const projector = new NotificationProjectorService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const specs = (
      projector as unknown as { project(event: unknown): Array<Record<string, unknown>> }
    ).project({
      eventType: DecisionEventType.SECURITY_RISK_DETECTED,
      tenantId: 1n,
      outboxEventId: 1n,
      aggregateType: 'DecisionArtifactVersion',
      aggregateId: '7',
      correlationId: 'req-1',
      payload: { summary: 'CREDIT_POLICY entró en revisión con riesgo ALTO: SENSITIVE_VARIABLES' },
    });

    expect(specs.map((spec) => spec.recipientRole).sort()).toEqual(['COMPLIANCE', 'FRAUD_ANALYST']);
    expect(specs.every((spec) => spec.priority === 'HIGH')).toBe(true);
    expect(String(specs[0]?.body)).toContain('SENSITIVE_VARIABLES');
  });
});
