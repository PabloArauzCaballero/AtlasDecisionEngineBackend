import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { BankStatementService } from '../src/modules/workers/bank-statement/bank-statement.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

/**
 * Qué hace el alta cuando el MISMO documento ya se subió antes.
 *
 * La deduplicación del worker de extractos es un índice único por
 * `(tenant, huella del archivo)`: sin caducidad y sin clave con la que forzar un
 * reanálisis —a diferencia del semántico y el de identidad, que sí admiten
 * `idempotencyKey`—. Eso convertía cualquier FALLO en permanente: el documento
 * que falló una vez respondía con ese fallo para siempre, y ninguna corrección
 * del lector de PDF podía alcanzarlo. Aquí se fija la distinción: un resultado
 * se reutiliza, un fallo se reintenta.
 *
 * Con dobles a propósito: lo que se prueba es la DECISIÓN de reencolar, no el
 * índice único, que ya tiene su prueba contra PostgreSQL de verdad en
 * `worker-runs.integration.spec.ts`.
 */

const TENANT = 7n;
const HUELLA = 'a'.repeat(64);

const PRINCIPAL = {
  id: 'analista@atlas',
  requestId: 'req-nuevo',
} as unknown as AuthenticatedPrincipal;

const ENTRADA = {
  fileName: 'extracto.pdf',
  fileHash: HUELLA,
  bytes: Buffer.from('%PDF-1.4 documento'),
};

function violacionDeUnicidad(): Error {
  return new Prisma.PrismaClientKnownRequestError('duplicado', {
    code: 'P2002',
    clientVersion: 'prueba',
  });
}

interface Registro {
  readonly notificaciones: number;
  readonly actualizaciones: Array<Record<string, unknown>>;
}

/**
 * Servicio con el alta ya ocupada por `existente`: crear choca contra el índice,
 * que es exactamente lo que ocurre al subir dos veces el mismo archivo.
 */
function servicioCon(existente: { status: WorkerRunStatus; requestId: string }): {
  service: BankStatementService;
  registro: Registro;
} {
  const registro: Registro = { notificaciones: 0, actualizaciones: [] };
  const prisma = {
    bankStatementRun: {
      findFirst: () => Promise.resolve(existente),
    },
    $transaction: (work: (tx: unknown) => Promise<unknown>) =>
      work({
        bankStatementRun: {
          create: () => {
            throw violacionDeUnicidad();
          },
          update: ({ data }: { data: Record<string, unknown> }) => {
            registro.actualizaciones.push(data);
            return Promise.resolve({ ...existente, ...data });
          },
        },
      }),
  };
  const jobSignal = {
    notify: () => {
      (registro as { notificaciones: number }).notificaciones += 1;
      return Promise.resolve();
    },
  };
  const service = new BankStatementService(
    prisma as never,
    jobSignal as never,
    new ConfigService({}),
    { inject: () => ({}) } as never,
  );
  return { service, registro };
}

describe('alta de una conversión de extracto ya subida', () => {
  it('reutiliza la ejecución cuando ya hay resultado', async () => {
    const { service, registro } = servicioCon({
      status: WorkerRunStatus.SUCCEEDED,
      requestId: 'req-viejo',
    });

    const { run, deduplicated } = await service.createRun(
      TENANT,
      PRINCIPAL,
      ENTRADA,
      WorkerInputSource.UPLOAD,
    );

    expect(deduplicated).toBe(true);
    expect(run.requestId).toBe('req-viejo');
    // Ni se reencola ni se avisa al worker: no hay trabajo que rehacer.
    expect(registro.actualizaciones).toHaveLength(0);
    expect(registro.notificaciones).toBe(0);
  });

  /*
   * El defecto: el corpus sintético de sesenta páginas se rechazaba por un
   * defecto del detector de columnas. Corregido el detector, volver a subir el
   * MISMO archivo seguía devolviendo `NOT_A_FINANCIAL_STATEMENT` —la fila
   * guardada—, y no había forma de pedir otro intento.
   */
  it('vuelve a intentarlo cuando el intento anterior falló', async () => {
    const { service, registro } = servicioCon({
      status: WorkerRunStatus.FAILED,
      requestId: 'req-viejo',
    });

    const { run, deduplicated } = await service.createRun(
      TENANT,
      PRINCIPAL,
      ENTRADA,
      WorkerInputSource.UPLOAD,
    );

    expect(deduplicated).toBe(false);
    expect(run.status).toBe(WorkerRunStatus.QUEUED);
    expect(registro.notificaciones).toBe(1);

    const [data] = registro.actualizaciones;
    // El rastro del intento anterior se limpia entero: un código de error junto
    // a un estado QUEUED describiría una ejecución que no existe.
    expect(data?.errorCode).toBeNull();
    expect(data?.errorMessage).toBeNull();
    expect(data?.attemptCount).toBe(0);
    expect(data?.finishedAt).toBeNull();
    // Y el documento vuelve: el worker borra los bytes al cerrar la ejecución,
    // así que sin reponerlos no habría nada que analizar.
    expect(data?.fileBytes).toEqual(new Uint8Array(ENTRADA.bytes));
  });

  it('vuelve a intentarlo también cuando se canceló', async () => {
    const { service, registro } = servicioCon({
      status: WorkerRunStatus.CANCELLED,
      requestId: 'req-viejo',
    });

    const { deduplicated } = await service.createRun(
      TENANT,
      PRINCIPAL,
      ENTRADA,
      WorkerInputSource.UPLOAD,
    );

    expect(deduplicated).toBe(false);
    expect(registro.notificaciones).toBe(1);
  });

  it('respeta la ejecución en curso: no la reencola', async () => {
    const { service, registro } = servicioCon({
      status: WorkerRunStatus.RUNNING,
      requestId: 'req-viejo',
    });

    const { deduplicated } = await service.createRun(
      TENANT,
      PRINCIPAL,
      ENTRADA,
      WorkerInputSource.UPLOAD,
    );

    expect(deduplicated).toBe(true);
    expect(registro.actualizaciones).toHaveLength(0);
  });
});
