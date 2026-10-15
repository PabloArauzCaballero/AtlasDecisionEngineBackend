import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import type { DeployVersionDto } from './deployment.dto';

/** Holgura de reloj entre quien despliega y el servidor. */
const EFFECTIVE_FROM_TOLERANCE_MS = 60_000;

/** Lo que el runtime no sabe hacer, o una vigencia que lo dejaría sin despliegue activo, se rechaza. */
export function assertDeployRequestAllowed(dto: DeployVersionDto): void {
  if (dto.traffic.length) {
    const total = dto.traffic.reduce((sum, rule) => sum + rule.trafficPercentage, 0);
    if (Math.abs(total - 100) > 0.001) {
      throw new DomainException('INVALID_TRAFFIC_PERCENTAGE', 'Traffic percentages must total 100');
    }
  }

  /*
   * Lo que el runtime no sabe hacer se RECHAZA, no se guarda.
   *
   * `DeploymentResolverService.resolve` no lee `deploymentMode` ni `traffic`: devuelve siempre el
   * despliegue enlazado y desactiva el anterior. Aceptar un CANARY al 10 % y mandar el 100 % de
   * las decisiones a la versión nueva —con el historial diciendo «canario»— es peor que decir que
   * no. Cuando el resolver sepa enrutar por segmento o porcentaje, se retira esta guarda.
   */
  if (dto.deploymentMode !== 'DIRECT' || dto.traffic.length > 0) {
    throw new DomainException(
      'DEPLOYMENT_MODE_NOT_SUPPORTED',
      'Sólo se admiten despliegues DIRECT sin reglas de tráfico: el runtime todavía no enruta ' +
        'por porcentaje ni por segmento y mandaría el 100 % a la versión nueva.',
      HttpStatus.BAD_REQUEST,
      { deploymentMode: dto.deploymentMode, trafficRules: dto.traffic.length },
    );
  }
  /*
   * Una ventana de vigencia que no cubre «ahora» deja el artefacto SIN despliegue activo: el
   * anterior se marca SUPERSEDED y el binding apunta al nuevo al instante, pero el resolver
   * filtra por `effectiveFrom <= now` y `effectiveTo > now` y responde ACTIVE_DEPLOYMENT_NOT_FOUND.
   */
  const now = Date.now();
  const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom).getTime() : now;
  if (effectiveFrom > now + EFFECTIVE_FROM_TOLERANCE_MS) {
    throw new DomainException(
      'DEPLOYMENT_EFFECTIVE_FROM_IN_FUTURE',
      'effectiveFrom no puede ser futuro: el despliegue anterior dejaría de servir ya y el ' +
        'artefacto quedaría sin despliegue activo hasta esa fecha.',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (dto.effectiveTo && new Date(dto.effectiveTo).getTime() <= Math.max(effectiveFrom, now)) {
    throw new DomainException(
      'DEPLOYMENT_EFFECTIVE_WINDOW_INVALID',
      'effectiveTo debe ser posterior a effectiveFrom y a la hora actual.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
