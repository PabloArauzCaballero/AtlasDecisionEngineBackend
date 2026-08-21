/**
 * El bloque describiéndose a sí mismo para el catálogo unificado del ecosistema.
 *
 * Importa `DiscoveryModule` porque el inventario de rutas se lee del router vivo de Nest; no
 * declara dependencias de dominio a propósito: si este módulo necesitara un servicio de negocio
 * para saber qué expone el proceso, es que ya no estaría describiendo el proceso.
 */
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { PlatformCatalogController } from './platform-catalog.controller';
import { PlatformCatalogService } from './platform-catalog.service';
import { OpenApiDocumentRegistry } from './openapi-document.registry';
import { RouteInventoryService } from './route-inventory.service';
import { SchemaInventoryService } from './schema-inventory.service';

@Module({
  imports: [DiscoveryModule],
  controllers: [PlatformCatalogController],
  providers: [
    PlatformCatalogService,
    RouteInventoryService,
    SchemaInventoryService,
    OpenApiDocumentRegistry,
  ],
  // Se exporta para que el arranque pueda depositar el documento OpenAPI ya construido.
  exports: [OpenApiDocumentRegistry],
})
export class PlatformCatalogModule {}
