/**
 * Superficie de persistencia lista para inyectar: rutas de lectura y escritura, fábrica
 * de adaptadores y salud de las fuentes de datos.
 *
 * Aquí también se registra Redis como segunda conexión del registro. No añade ningún
 * cliente —envuelve el `CacheService` existente—, pero convierte el poliglotismo en algo
 * comprobable: el registro contiene dos motores y `/health/data-sources` los reporta por
 * separado.
 */
import { Global, Module, OnModuleInit } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { CacheService } from '../cache/cache.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ReadPathService } from './adapters/postgres/read-path.service';
import { WritePathService } from './adapters/postgres/write-path.service';
import { CACHE_CONNECTION, CacheConnection } from './connections/cache-connection';
import { ConnectionRegistryService } from './connections/connection-registry.service';
import { PersistenceAdapterFactory } from './factory/persistence-adapter.factory';
import { DataSourceHealthService } from './health/data-source-health.service';
import { PersistenceCoreModule } from './persistence-core.module';

@Global()
@Module({
  imports: [PersistenceCoreModule, PrismaModule, CacheModule],
  providers: [
    ReadPathService,
    WritePathService,
    PersistenceAdapterFactory,
    DataSourceHealthService,
  ],
  exports: [ReadPathService, WritePathService, PersistenceAdapterFactory, DataSourceHealthService],
})
export class PersistenceModule implements OnModuleInit {
  constructor(
    private readonly registry: ConnectionRegistryService,
    private readonly cache: CacheService,
  ) {}

  onModuleInit(): void {
    // Idempotente: una suite puede levantar más de un contexto de Nest en el mismo
    // proceso, y volver a registrar el mismo nombre debe ser un no-op, no un fallo.
    if (!this.registry.has(CACHE_CONNECTION)) {
      this.registry.register(new CacheConnection(this.cache));
    }
  }
}
