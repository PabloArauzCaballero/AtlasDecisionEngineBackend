import { Module } from '@nestjs/common';
import { BankStatementController } from './bank-statement/bank-statement.controller';
import { BankStatementRunWorkerService } from './bank-statement/bank-statement-run-worker.service';
import { BankStatementService } from './bank-statement/bank-statement.service';
import { WorkersController } from './workers.controller';

/**
 * Workers adicionales (ADR-0026): análisis semántico y extractos bancarios.
 *
 * Un solo módulo con **dos workers independientes dentro**. Comparten el
 * módulo porque comparten el catálogo (`/v1/workers`) y la forma de sus
 * ejecuciones; no comparten nada más: cada uno tiene su tabla, su cola, su
 * processor, su configuración y sus pruebas. Mezclarlos en un processor común
 * para ahorrar archivos habría acoplado un fallo del lector de PDF con la cuota
 * de un proveedor de modelos.
 *
 * No declara `imports`: los dos trabajos se registran solos en
 * `JobSchedulerService`, que es global, y la persistencia va por `PrismaService`.
 * Los servicios de fondo consultan `WORKER_ROLE` en su propio `onModuleInit`,
 * así que cargar este módulo en una réplica de API no arranca ningún worker.
 */
@Module({
  controllers: [WorkersController, BankStatementController],
  providers: [BankStatementService, BankStatementRunWorkerService],
  exports: [BankStatementService],
})
export class WorkersModule {}
