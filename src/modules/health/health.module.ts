/** Registers orchestration health probes separately from authenticated business APIs. */
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthProbeService } from './health-probe.service';

// El servicio se exporta porque el arranque del proceso WORKER (src/worker.ts) lo resuelve
// del contexto para servir las mismas sondas sin levantar los controladores de negocio.
@Module({
  controllers: [HealthController],
  providers: [HealthProbeService],
  exports: [HealthProbeService],
})
export class HealthModule {}
