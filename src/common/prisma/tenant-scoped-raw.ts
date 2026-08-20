/**
 * Ejecuta consultas CRUDAS dentro del ámbito del tenant.
 *
 * ## Por qué esto no es opcional
 *
 * `applyTenantRls` (ver `tenant-rls.ts`) fija el GUC `app.tenant_id` en dos sitios: la
 * extensión que envuelve las operaciones de MODELO, y la sobrescritura de `$transaction`.
 * `$queryRaw` suelto no pasa por ninguno de los dos: cae al cliente base, sin GUC.
 *
 * Y no fijarlo no significa «sin filtro de tenant». Significa algo peor: una vez que la
 * conexión del pool que te toque ha servido a un tenant, el GUC queda DEFINIDO con cadena
 * vacía, así que `current_setting('app.tenant_id', true) IS NULL` deja de cumplirse y la
 * política de RLS evalúa `''::bigint`. La petición muere con `22P02 invalid input syntax
 * for type bigint: ""`. Depende de qué conexión toque, de modo que aparece y desaparece —
 * y en las pantallas de medición estuvo apareciendo sin que se notara, porque las tablas
 * estaban vacías y un 500 sobre una lista que iba a salir vacía no llama la atención.
 *
 * ## Cuándo hace falta y cuándo no
 *
 * - **Hace falta** en cualquier consulta cruda sobre una tabla con RLS forzada:
 *   `decision_execution`, `outcome_window_schedule`, `portfolio_state`, `credit_facility`,
 *   `monitoring_evaluation`… es decir, prácticamente todo lo que lleva `tenant_id`.
 * - **No hace falta** sobre las vistas `vw_*`, que no llevan la política, ni en los caminos
 *   sin tenant en contexto (salud, migraciones, siembra, reclamo de trabajos del worker):
 *   ahí el GUC nunca se fijó y `IS NULL` sí se cumple.
 *
 * Existe como función con nombre, y no como un comentario repetido ocho veces, para que
 * `grep consultaCrudaConTenant` conteste «qué consultas crudas están cubiertas» y para que
 * la respuesta a «¿por qué esta transacción de una sola sentencia?» esté en un solo sitio.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/** Lo mínimo que se necesita del cliente: la transacción que fija el tenant. */
type ClienteConTransaccion = Pick<PrismaClient, '$transaction'>;

export function consultaCrudaConTenant<T>(
  prisma: ClienteConTransaccion,
  consulta: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(consulta);
}
