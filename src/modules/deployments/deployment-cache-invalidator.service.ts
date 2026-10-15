import { Injectable, Logger } from '@nestjs/common';
import { DeploymentResolverService } from './deployment-resolver.service';

@Injectable()
export class DeploymentCacheInvalidator {
  private readonly logger = new Logger(DeploymentCacheInvalidator.name);

  constructor(private readonly resolver: DeploymentResolverService) {}

  /**
   * Invalida la caché del resolver DESPUÉS del commit, sin que un fallo suyo tumbe la respuesta.
   *
   * El despliegue ya es durable. Si Redis falla (y en producción no hay respaldo en memoria), el
   * `del` lanza: el cliente recibía un 5xx de algo que sí se hizo, reintentaba y creaba un segundo
   * despliegue con su segundo `VERSION_PUBLISHED`. La caché caduca sola (TTL corto), así que lo
   * peor de no invalidar es servir el binding viejo unos segundos, que se registra.
   */
  async invalidateAfterCommit(
    tenantId: bigint,
    artifactCode: string,
    environmentCode: string,
  ): Promise<void> {
    try {
      await this.resolver.invalidate(tenantId, artifactCode, environmentCode);
    } catch (error) {
      this.logger.error(
        `El despliegue de ${artifactCode} en ${environmentCode} se confirmó, pero no se pudo ` +
          `invalidar la caché del resolver; se seguirá sirviendo el binding anterior hasta que ` +
          `caduque: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
