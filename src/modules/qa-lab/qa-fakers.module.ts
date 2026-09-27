/**
 * Fakers del servidor mock para los datos de prueba. Módulo propio porque lo usan dos
 * caminos que no se conocen: el QA Lab (corridas y valores por versión) y el simulador
 * (valores del contrato desplegado).
 */
import { Module } from '@nestjs/common';
import { QaFakersClient } from './qa-fakers.client';
import { QaFakersService } from './qa-fakers.service';

@Module({
  providers: [QaFakersClient, QaFakersService],
  exports: [QaFakersService],
})
export class QaFakersModule {}
