/**
 * Consola de consultas SQL gobernada (ADR-0031).
 *
 * No exporta nada. Es deliberado: ningún otro módulo debe poder pedirle a éste que ejecute
 * SQL arbitrario. Lo que este módulo sabe hacer sólo tiene sentido detrás de su propio
 * controlador, con sus roles y su bitácora; exportar `QueryExecutorService` convertiría un
 * ejecutor de SQL ajeno en una dependencia inyectable por cualquiera, que es exactamente
 * cómo una superficie acotada deja de estarlo.
 */
import { Module } from '@nestjs/common';
import { QueryExecutorService } from './execution/query-executor.service';
import { SqlConsoleController } from './sql-console.controller';
import { SqlConsoleService } from './sql-console.service';

@Module({
  controllers: [SqlConsoleController],
  providers: [SqlConsoleService, QueryExecutorService],
})
export class SqlConsoleModule {}
