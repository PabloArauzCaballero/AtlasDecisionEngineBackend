import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { RequestContextService } from '../context/request-context.service';
import {
  ConnectionRegistryService,
  READ_CONNECTION,
} from '../persistence/connections/connection-registry.service';
import { applyTenantRls } from './tenant-rls';

/**
 * Cliente de la RUTA DE LECTURA.
 *
 * Se monta sobre el pool de la conexión `postgres-read`, que puede ser el mismo pool que
 * el de escritura (Escenario A), otro pool contra el mismo servidor con el rol
 * `atlas_reader` (Escenario B, el recomendado en desarrollo) o una réplica (Escenario C).
 * En los tres casos este cliente rechaza toda operación de escritura antes de llegar a la
 * base: es la contraparte en código del privilegio que el rol lector no tiene.
 *
 * Nadie inyecta esta clase directamente en un caso de uso. Se llega a ella por
 * `ReadPathService`, que es quien aplica el enrutamiento, el fallback y las métricas.
 */
@Injectable()
export class PrismaReadService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaReadService.name);
  private readonly nodeEnv: string;
  private readonly dedicated: boolean;

  constructor(
    registry: ConnectionRegistryService,
    config: ConfigService,
    private readonly requestContext: RequestContextService,
  ) {
    const connection = registry.postgres(READ_CONNECTION);
    super({ adapter: new PrismaPg(connection.pool, { disposeExternalPool: false }) });
    this.nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
    this.dedicated = !registry.readSharesWrite;
    return applyTenantRls(this, {
      currentTenantId: () => this.requestContext.get()?.tenantId,
      connectionName: READ_CONNECTION,
      readOnly: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    if (this.dedicated) await this.assertCannotWrite();
    this.logger.log(
      this.dedicated
        ? 'PostgreSQL read path established on a dedicated connection'
        : 'PostgreSQL read path established (sharing the write connection)',
    );
  }

  /**
   * Comprueba el privilegio REAL del rol, no la configuración que se pretendía.
   *
   * Inspeccionar los GRANT no basta y las guardias en código tampoco: si el rol lector
   * conserva INSERT sobre alguna tabla, cualquier ruta que no pase por este cliente
   * —una consulta cruda, una migración mal apuntada— puede escribir por la conexión de
   * lectura. Se pregunta al motor tabla por tabla porque un GRANT olvidado suele ser de
   * una sola tabla añadida después.
   */
  private async assertCannotWrite(): Promise<void> {
    const [{ writable }] = await this.$queryRaw<{ writable: number }[]>`
      SELECT count(*)::int AS "writable"
      FROM pg_tables
      WHERE schemaname = 'public'
        AND (
          has_table_privilege(current_user, schemaname || '.' || quote_ident(tablename), 'INSERT')
          OR has_table_privilege(current_user, schemaname || '.' || quote_ident(tablename), 'UPDATE')
          OR has_table_privilege(current_user, schemaname || '.' || quote_ident(tablename), 'DELETE')
        )
    `;
    if (writable === 0) return;
    const message =
      `The read connection's database role holds write privileges on ${writable} table(s). ` +
      'The read path must be strictly read-only; run `yarn db:provision:dev` (development) or ' +
      'apply scripts/postgres/provision-roles.sql with an administrative role.';
    if (this.nodeEnv === 'production') throw new Error(message);
    this.logger.warn(message);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
