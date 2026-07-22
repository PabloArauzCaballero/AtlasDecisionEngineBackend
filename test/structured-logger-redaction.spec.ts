import { ConfigService } from '@nestjs/config';
import { StructuredLoggerService } from '../src/common/observability/structured-logger.service';
import { RequestContextService } from '../src/common/context/request-context.service';

/**
 * Guards the PII allowlist. Decision inputs (financial PII) travel under generic
 * container keys, so a service logging `{ variables: {...} }` must never write applicant
 * data in clear. `redact` is exercised directly to assert per-key behaviour.
 */
describe('StructuredLoggerService redaction', () => {
  function redact(value: unknown): Record<string, unknown> {
    const logger = new StructuredLoggerService(new ConfigService({}), new RequestContextService());
    return (logger as unknown as { redact: (v: unknown) => Record<string, unknown> }).redact(value);
  }

  it('redacts decision-input container keys that carry financial PII', () => {
    const result = redact({
      variables: { income: 90_000, ssn: '123-45-6789' },
      input: { applicant: 'Jane' },
      context: { score: 720 },
      payload: { amount: 1_000 },
    });

    expect(result.variables).toBe('[REDACTED]');
    expect(result.input).toBe('[REDACTED]');
    expect(result.context).toBe('[REDACTED]');
    expect(result.payload).toBe('[REDACTED]');
  });

  it('redacts raw PII fields regardless of nesting', () => {
    const result = redact({ applicant: { ssn: '123-45-6789', email: 'a@b.com', age: 33 } });
    const applicant = result.applicant as Record<string, unknown>;

    expect(applicant.ssn).toBe('[REDACTED]');
    expect(applicant.email).toBe('[REDACTED]');
    expect(applicant.age).toBe(33);
  });

  it('preserves existing credential redaction and non-sensitive fields', () => {
    const result = redact({ authorization: 'Bearer x', requestId: 'r-1', status: 'APPROVED' });

    expect(result.authorization).toBe('[REDACTED]');
    expect(result.requestId).toBe('r-1');
    expect(result.status).toBe('APPROVED');
  });
});
