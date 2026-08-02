/**
 * Orquestación central de los trabajos de fondo.
 *
 * Global porque un trabajo puede vivir en cualquier dominio y no debe obligar a su módulo a
 * importar una cadena de infraestructura para registrarse; y porque tener DOS orquestadores
 * en un proceso —uno por cada módulo que lo importara— reintroduciría exactamente el sondeo
 * duplicado que este módulo existe para eliminar.
 */
import { Global, Module } from '@nestjs/common';
import { JobSchedulerService } from './job-scheduler.service';
import { JobSignalService } from './job-signal.service';

@Global()
@Module({
  providers: [JobSignalService, JobSchedulerService],
  exports: [JobSignalService, JobSchedulerService],
})
export class JobsModule {}
