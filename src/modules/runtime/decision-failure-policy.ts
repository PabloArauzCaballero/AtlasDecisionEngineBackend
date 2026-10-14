import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';

export function httpStatusOfFailure(error: unknown): number {
  if (error instanceof DomainException) return error.status;
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

export function errorCodeOfFailure(error: unknown): string {
  return error instanceof DomainException ? error.code : 'RUNTIME_EXECUTION_FAILED';
}

/**
 * A failure is transient when it is not a modelled business error: infrastructure
 * errors (which never reach us as a DomainException) and 5xx domain errors — timeouts,
 * unavailable dependencies — are retryable. A 4xx DomainException is a deterministic
 * business outcome and is safe to cache.
 */
export function isRetryableFailure(error: unknown): boolean {
  // «Sin despliegue activo» es un 404 pero NO es un veredicto sobre la solicitud: es el estado
  // del entorno (un rollback en curso, una ventana entre despliegues). Cachearlo como FAILED
  // durante el TTL de idempotencia (24 h) devolvía el mismo 404 a quien reintentaba con su misma
  // clave después de arreglar el despliegue.
  if (error instanceof DomainException && error.code === 'ACTIVE_DEPLOYMENT_NOT_FOUND') {
    return true;
  }
  if (error instanceof DomainException) return error.status >= 500;
  return true;
}
