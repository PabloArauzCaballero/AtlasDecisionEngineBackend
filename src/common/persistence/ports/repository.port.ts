/**
 * Contratos genéricos de repositorio, separados por ruta.
 *
 * Son la base común, NO un repositorio universal: un puerto de dominio (por ejemplo
 * `DecisionAuditReadPort`) declara sus propias operaciones con nombres de negocio y solo
 * hereda de aquí lo que de verdad comparte. Meter toda consulta imaginable en una única
 * interfaz genérica devuelve el acoplamiento por la puerta de atrás (§7).
 */
import type { ReadContext, WriteContext } from './data-source.types';

export interface ReadRepository<TEntity, TId, TCriteria = unknown> {
  findById(id: TId, context?: ReadContext): Promise<TEntity | null>;
  findOne(criteria: TCriteria, context?: ReadContext): Promise<TEntity | null>;
  findMany(criteria: TCriteria, context?: ReadContext): Promise<TEntity[]>;
  exists(criteria: TCriteria, context?: ReadContext): Promise<boolean>;
  count(criteria: TCriteria, context?: ReadContext): Promise<number>;
}

export interface WriteRepository<TEntity, TId> {
  insert(entity: TEntity, context?: WriteContext): Promise<TEntity>;
  update(entity: TEntity, context?: WriteContext): Promise<TEntity>;
  delete(id: TId, context?: WriteContext): Promise<void>;
}

/**
 * Filas y total de una lectura paginada.
 *
 * A propósito NO es la forma de respuesta HTTP (`PageResult`, con `totalPages` y
 * `hasNextPage`): montar la página es trabajo de la capa de aplicación. Un puerto que
 * devolviera la forma de transporte obligaría a cada adaptador a conocerla, y cambiar el
 * contrato de la API pasaría por tocar todos los adaptadores.
 */
export interface CountedRows<T> {
  readonly items: T[];
  readonly total: number;
}
