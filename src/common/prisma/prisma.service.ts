import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { RequestContextService } from '../context/request-context.service';
import {
  ConnectionRegistryService,
  WRITE_CONNECTION,
} from '../persistence/connections/connection-registry.service';
import { applyTenantRls } from './tenant-rls';

/**
 * Cliente de la RUTA DE ESCRITURA.
 *
 * Sigue llamándose `PrismaService` y conserva su superficie: es el cliente que ya usaban
 * todos los módulos, y una escritura, una transacción de negocio o una lectura que deba
 * ver lo que acaba de escribirse siguen resolviéndose por aquí sin tocar nada. Lo que
 * cambia es de dónde sale el pool: ya no lo abre este servicio, lo toma de la conexión
 * `postgres-write` del registro. Así la lectura puede compartir ese mismo pool
 * (Escenario A) o abrir el suyo contra otro rol, otro servidor u otra réplica
 * (Escenarios B a E) sin que este archivo se entere.
 *
 * El tenant y la RLS los aplica `applyTenantRls`, compartido con la ruta de lectura para
 * que no existan dos definiciones de «consulta acotada al tenant».
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly nodeEnv: string;

  constructor(
    registry: ConnectionRegistryService,
    config: ConfigService,
    private readonly requestContext: RequestContextService,
  ) {
    const connection = registry.postgres(WRITE_CONNECTION);
    // `disposeExternalPool: false`: el pool pertenece a la conexión registrada, que lo
    // cierra en el apagado ordenado. Si Prisma también lo cerrara, el segundo cierre
    // fallaría cuando lectura y escritura comparten pool.
    super({ adapter: new PrismaPg(connection.pool, { disposeExternalPool: false }) });
    this.nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
    return applyTenantRls(this, {
      currentTenantId: () => this.requestContext.get()?.tenantId,
      connectionName: WRITE_CONNECTION,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.assertNotSuperuser();
    this.logger.log('PostgreSQL write path established');
  }

  /**
   * La RLS es inerte para una conexión de superusuario (ver `tenant-rls.ts`), así que un
   * DATABASE_URL de superusuario llegando a la API en producción desactivaría en silencio
   * todas las políticas de aislamiento por tenant. Falla cerrado en producción; en el
   * resto solo avisa, para que los flujos locales que aún usan el rol administrativo
   * (antes de aplicar `bootstrap-app-role`) sigan funcionando.
   */
  private async assertNotSuperuser(): Promise<void> {
    const [{ isSuperuser }] = await this.$queryRaw<{ isSuperuser: boolean }[]>`
      SELECT current_setting('is_superuser')::boolean AS "isSuperuser"
    `;
    if (!isSuperuser) return;
    const message =
      'Database connection is a superuser role — tenant Row-Level Security policies are ' +
      'inert for this connection. The API must connect as the non-superuser atlas_app role ' +
      '(see scripts/set-app-db-role.mjs and docs/DEPLOYMENT.md).';
    if (this.nodeEnv === 'production') {
      throw new Error(message);
    }
    this.logger.warn(message);
  }

  async onModuleDestroy(): Promise<void> {
    // Solo se desconecta el cliente: el pool lo cierra el registro de conexiones.
    await this.$disconnect();
  }
}
