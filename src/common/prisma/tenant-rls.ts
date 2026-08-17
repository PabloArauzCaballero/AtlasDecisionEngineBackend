/**
 * Envoltura de tenancy y de ruta para un cliente Prisma.
 *
 * Fija el GUC `app.tenant_id` de Postgres en cada consulta con ámbito de petición, para
 * que las políticas de Row-Level Security del tenant (migración 20260719080000) apliquen
 * de verdad como defensa en profundidad.
 *
 * Cómo llega el contexto a la base de datos:
 *  - Las operaciones de modelo se envuelven en una extensión de consulta que agrupa
 *    `set_config('app.tenant_id', <tenant>, true)` con la operación en UNA transacción,
 *    de forma que el GUC —local a la transacción— aplique a esa sentencia.
 *  - `$transaction` (forma de callback y de array) se sobrescribe para fijar el GUC como
 *    primera sentencia, así queda cubierta toda consulta dentro de la transacción.
 *  - Sin tenant en el contexto (resolución de auth, salud, migraciones, semillas) el GUC
 *    se deja sin fijar; las políticas permiten un contexto vacío, así que esos caminos no
 *    se ven afectados. Por eso la RLS es inerte hasta que la aplicación conecta con el rol
 *    NO superusuario `atlas_app`: un superusuario la salta pase lo que pase.
 *
 * **Una consulta cruda contra una tabla con RLS forzada debe ir dentro de `$transaction`.**
 * `$queryRaw` suelto cae al cliente base y no fija el GUC, y eso no es sólo perder la
 * defensa en profundidad: una vez que una conexión del pool ha servido a un tenant, el GUC
 * queda DEFINIDO con cadena vacía, así que `current_setting('app.tenant_id', true) IS NULL`
 * ya no se cumple y la política evalúa `''::bigint`, que aborta con `22P02`. El fallo
 * depende de qué conexión toque, de modo que aparece y desaparece. Las consultas crudas
 * sobre vistas `vw_*` no lo sufren porque esas vistas no llevan la política.
 *
 * La segunda responsabilidad —`readOnly`— existe porque separar rutas solo sirve si la de
 * lectura no puede escribir. El privilegio del rol de base de datos es la barrera real;
 * esta guardia es la que convierte «el reader no tiene permiso» en un error del dominio,
 * inmediato y con nombre, en vez de un 42501 a medio camino de una petición.
 */
import { PrismaClient } from '@prisma/client';
import { ReadOnlyConnectionError } from '../persistence/errors/persistence-errors';

/** Operaciones de modelo que modifican estado. Se comparan por nombre exacto. */
const MUTATING_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/** Miembros `$` del cliente que ejecutan DML/DDL arbitrario. */
const MUTATING_MEMBERS = new Set(['$executeRaw', '$executeRawUnsafe']);

export interface TenantRlsOptions {
  /** Tenant activo, o `undefined` fuera de una petición con contexto. */
  currentTenantId(): string | undefined;
  /** Nombre lógico de la conexión; solo para el mensaje de error. */
  readonly connectionName: string;
  /** Ruta de lectura: rechaza toda operación que modifique estado. */
  readonly readOnly?: boolean;
}

/**
 * Devuelve un Proxy que enruta las operaciones de modelo por la extensión que fija el
 * tenant y `$transaction` por su sobrescritura, mientras cualquier otro miembro (consultas
 * crudas, `$connect`, ciclo de vida) cae al cliente base sin cambios.
 */
export function applyTenantRls<TClient extends PrismaClient>(
  client: TClient,
  options: TenantRlsOptions,
): TClient {
  const { currentTenantId, connectionName, readOnly = false } = options;

  // Capturado antes de proxificar para que las sobrescrituras alcancen los originales sin
  // volver a entrar en el Proxy (lo que recursaría).
  const rawTransaction = PrismaClient.prototype.$transaction.bind(client) as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;

  const setTenantStatement = (tenantId: string) =>
    client.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

  const rejectWrite = (operation: string): never => {
    throw new ReadOnlyConnectionError(
      `Operation "${operation}" is a write and cannot be issued on the read path`,
      { connectionName, engine: 'postgresql', operation },
    );
  };

  const extended = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          if (readOnly && MUTATING_OPERATIONS.has(operation)) rejectWrite(operation);
          const tenantId = currentTenantId();
          if (tenantId === undefined) return query(args);
          const [, result] = (await rawTransaction([
            setTenantStatement(tenantId),
            query(args),
          ])) as [unknown, unknown];
          return result;
        },
      },
    },
  });

  const tenantTransaction = (arg: unknown, txOptions?: unknown): Promise<unknown> => {
    const tenantId = currentTenantId();
    if (tenantId === undefined) return rawTransaction(arg, txOptions);
    if (Array.isArray(arg)) {
      // Se antepone la sentencia del tenant y luego se descarta su resultado, para que el
      // llamante siga recibiendo sus operaciones en el orden en que las pasó.
      //
      // `arg as unknown[]`: `Array.isArray` sobre un `unknown` lo estrecha a `any[]`, y
      // esparcirlo tal cual mete un `any` en la lista de operaciones — que es tipado
      // perdido en el camino por el que pasa TODA escritura acotada por tenant.
      const operaciones = arg as unknown[];
      return rawTransaction([setTenantStatement(tenantId), ...operaciones], txOptions).then(
        (results) => (results as unknown[]).slice(1),
      );
    }
    // Forma interactiva: el GUC se fija como primera sentencia dentro de la transacción,
    // así toda consulta que el callback ejecute sobre `tx` queda acotada al tenant.
    const callback = arg as (tx: unknown) => unknown;
    return rawTransaction(
      async (tx: {
        $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
      }) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return callback(tx);
      },
      txOptions,
    );
  };

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === '$transaction') return tenantTransaction;
      if (readOnly && typeof prop === 'string' && MUTATING_MEMBERS.has(prop)) {
        return () => rejectWrite(prop);
      }
      if (
        typeof prop === 'string' &&
        !prop.startsWith('$') &&
        !prop.startsWith('_') &&
        prop in extended
      ) {
        const value = (extended as unknown as Record<string, unknown>)[prop];
        if (value && typeof value === 'object') return value;
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
