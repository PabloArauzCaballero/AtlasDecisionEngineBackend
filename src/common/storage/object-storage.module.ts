import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service';

/**
 * El almacén de objetos, disponible en todo el motor.
 *
 * `@Global` por la misma razón que el módulo de Prisma: es infraestructura sin estado que van a
 * necesitar varios módulos —hoy identidad, mañana el worker de extractos, que hoy también tira su
 * PDF al cerrar— y obligarlos a importarlo uno por uno sólo produce listas de imports más largas
 * sin ganar aislamiento real.
 */
@Global()
@Module({
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class ObjectStorageModule {}
