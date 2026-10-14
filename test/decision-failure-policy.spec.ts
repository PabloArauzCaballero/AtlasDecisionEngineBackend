import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../src/common/errors/domain-exception';
import {
  errorCodeOfFailure,
  httpStatusOfFailure,
  isRetryableFailure,
} from '../src/modules/runtime/decision-failure-policy';
import { decisionValidUntil } from '../src/modules/runtime/decision-response';
import { requestedAmountOf } from '../src/modules/runtime/decision-safeguards.service';

describe('decision-failure-policy', () => {
  const business = new DomainException('SOME_RULE', 'no', HttpStatus.UNPROCESSABLE_ENTITY);
  const unavailable = new DomainException('DOWN', 'caído', HttpStatus.SERVICE_UNAVAILABLE);
  const noDeployment = new DomainException(
    'ACTIVE_DEPLOYMENT_NOT_FOUND',
    'sin',
    HttpStatus.NOT_FOUND,
  );

  it('un error de negocio 4xx es determinista y se cachea', () => {
    expect(isRetryableFailure(business)).toBe(false);
    expect(httpStatusOfFailure(business)).toBe(422);
    expect(errorCodeOfFailure(business)).toBe('SOME_RULE');
  });

  it('los 5xx, los errores de infraestructura y «sin despliegue activo» se reintentan', () => {
    expect(isRetryableFailure(unavailable)).toBe(true);
    expect(isRetryableFailure(new Error('timeout'))).toBe(true);
    expect(isRetryableFailure(noDeployment)).toBe(true);
  });

  it('un error desconocido es 500 con código genérico', () => {
    expect(httpStatusOfFailure(new Error('x'))).toBe(500);
    expect(errorCodeOfFailure(new Error('x'))).toBe('RUNTIME_EXECUTION_FAILED');
  });
});

describe('decisionValidUntil', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  it('usa los segundos configurados y, si no valen, tres días', () => {
    expect(decisionValidUntil(now, 60).toISOString()).toBe('2026-01-01T00:01:00.000Z');
    expect(decisionValidUntil(now, 'x').toISOString()).toBe('2026-01-04T00:00:00.000Z');
    expect(decisionValidUntil(now, -5).toISOString()).toBe('2026-01-04T00:00:00.000Z');
  });
});

describe('requestedAmountOf', () => {
  it('toma el primer importe positivo conocido y 0 si no hay ninguno', () => {
    expect(requestedAmountOf({ monto_solicitado: '120.5' })).toBe(120.5);
    expect(requestedAmountOf({ requested_amount: 0, loan_amount: 7 })).toBe(7);
    expect(requestedAmountOf({ otro: 5 })).toBe(0);
  });
});
