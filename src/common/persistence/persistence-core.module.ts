/**
 * Núcleo de persistencia: registro de conexiones y router.
 *
 * Va en su propio módulo, separado de `PersistenceModule`, porque no depende de ningún
 * cliente: `PrismaModule` lo importa para tomar los pools, y `PersistenceModule` —que sí
 * necesita los clientes— importa a su vez `PrismaModule`. Con un módulo único la
 * dependencia sería circular.
 */
import { Global, Module } from '@nestjs/common';
import { ConnectionRegistryService } from './connections/connection-registry.service';
import { DataSourceRouterService } from './routing/data-source-router.service';

@Global()
@Module({
  providers: [ConnectionRegistryService, DataSourceRouterService],
  exports: [ConnectionRegistryService, DataSourceRouterService],
})
export class PersistenceCoreModule {}
