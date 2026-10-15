import { Module } from '@nestjs/common';
import { ReferenceCatalogService } from './reference-catalog.service';

/**
 * El catálogo de referencia (padrón ASFI, logotipos y árbol de categorías), sembrado en cada arranque. Ver
 * `ReferenceCatalogService` y `docs/data/seeds.md`.
 */
@Module({ providers: [ReferenceCatalogService] })
export class ReferenceCatalogModule {}
