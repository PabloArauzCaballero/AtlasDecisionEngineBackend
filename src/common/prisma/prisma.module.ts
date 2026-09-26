/**
 * Los dos clientes PostgreSQL, uno por ruta.
 *
 * `PrismaService` (escritura) y `PrismaReadService` (lectura) se montan sobre los pools
 * que gobierna el registro de conexiones, por eso este módulo importa el núcleo de
 * persistencia. El cliente de lectura no se inyecta en los módulos de dominio: se llega a
 * él por `ReadPathService`, que es quien aplica enrutamiento, interruptor y fallback.
 */
import { Global, Module } from '@nestjs/common';
import { PersistenceCoreModule } from '../persistence/persistence-core.module';
import { PrismaReadService } from './prisma-read.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  imports: [PersistenceCoreModule],
  providers: [PrismaService, PrismaReadService],
  exports: [PrismaService, PrismaReadService],
})
export class PrismaModule {}
