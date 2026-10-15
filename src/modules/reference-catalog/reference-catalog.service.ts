/**
 * @file Siembra del catálogo de REFERENCIA en cada arranque: padrón ASFI, logotipos y árbol de categorías.
 * @business Sin padrón el Motor no reconoce ningún banco y manda cada extracto a revisión; sin categorías no clasifica.
 * @system en `onApplicationBootstrap`, por tenant, crea lo que falte (nunca pisa lo editado); no depende de STARTUP_SEED.
 */
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { runsBackgroundJobs } from '../../common/config/worker-role';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveBootstrapTenantId } from '../../common/seeding/bootstrap-tenant';
import { FinancialInstitutionService } from '../workers/bank-statement/institutions/financial-institution.service';
import { seedSemanticCatalog } from './seeds/semantic-catalog.seed';

const ACTOR = 'catalogo-de-referencia@atlas';

/**
 * El catálogo de referencia NO es la siembra de demostración.
 *
 * `SeedingService` trae el conjunto publicado en la rama de semillas (`SEED_SOURCE_*`) y sólo en una base vacía:
 * es lo que un entorno de pruebas «limpio» (TEST, Pablo 2026-09-15) no quiere. Pero el padrón de entidades con
 * licencia de ASFI y el árbol de categorías no son datos de prueba: sin ellos el Motor no funciona. El
 * 2026-10-15 TEST tenía las dos tablas a cero —«Faltan 71 entidades de la nómina de ASFI», «Categorías» en
 * blanco— y cada extracto acababa en revisión como UNKNOWN_BANK. Por eso esto corre SIEMPRE, independiente de
 * `STARTUP_SEED_ENABLED` y de la rama de semillas, y sólo CREA lo que falta:
 *
 * - una entidad o una categoría que alguien editó en el portal no se toca, y una dada de baja no vuelve;
 * - un logotipo subido a mano manda; un monograma se cambia por el oficial cuando lo hay (`syncLogos`);
 * - reejecutarlo no escribe nada: es lo que permite correrlo en cada arranque de cada réplica.
 *
 * Un fallo no tumba el arranque: se registra en `error` y el resto del proceso sigue —el portal permite cargar la
 * nómina a mano mientras tanto—.
 */
@Injectable()
export class ReferenceCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReferenceCatalogService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
    config: ConfigService,
  ) {
    const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
    const flag = config.get<string | boolean>('REFERENCE_CATALOG_SEED_ENABLED');
    // Las pruebas automáticas montan sus propios datos; fuera de ellas, encendido salvo que se apague a mano.
    this.enabled =
      runsBackgroundJobs(config) && nodeEnv !== 'test' && flag !== false && flag !== 'false';
  }

  /**
   * El CRUD del padrón vive en `WorkersModule` y se pide al contenedor en vez de declararlo como dependencia:
   * así se usa LA instancia que invalida la instantánea del motor, sin tocar `workers.module.ts` (deuda congelada
   * del gate de tamaño) para exportarlo.
   */
  private get institutions(): FinancialInstitutionService {
    return this.moduleRef.get(FinancialInstitutionService, { strict: false });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    await this.seedAll();
  }

  /** Los tenants a sembrar: el de arranque y todo tenant al que tenga acceso un cliente de integración. */
  async tenants(): Promise<bigint[]> {
    const rows = await this.prisma.integrationTenantAccess.findMany({
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    const ids = new Set<bigint>([resolveBootstrapTenantId(), ...rows.map((row) => row.tenantId)]);
    return [...ids].sort((a, b) => (a < b ? -1 : 1));
  }

  async seedAll(): Promise<void> {
    let tenants: bigint[];
    try {
      tenants = await this.tenants();
    } catch (error) {
      this.logger.error(
        `Catálogo de referencia: no se pudieron leer los tenants (${(error as Error).message}).`,
      );
      return;
    }
    for (const tenantId of tenants) await this.seedTenant(tenantId);
  }

  async seedTenant(tenantId: bigint): Promise<void> {
    const t = tenantId.toString();
    try {
      const padron = await this.institutions.syncSeed(tenantId, false, ACTOR);
      const logos = await this.institutions.syncLogos(tenantId, false, ACTOR);
      const catalogo = await seedSemanticCatalog(this.prisma, tenantId);
      const creado =
        padron.created.length + logos.applied.length + catalogo.categories + catalogo.aliases;
      const resumen =
        `tenant ${t}: ${padron.created.length} entidades de ${padron.total}, ${logos.applied.length} logotipos, ` +
        `${catalogo.categories} categorías y ${catalogo.aliases} alias creados`;
      if (creado > 0) this.logger.log(`Catálogo de referencia sembrado — ${resumen}.`);
      else this.logger.log(`Catálogo de referencia al día (tenant ${t}).`);
    } catch (error) {
      this.logger.error(
        `Catálogo de referencia del tenant ${t} NO sembrado: ${(error as Error).message}`,
      );
    }
  }
}
