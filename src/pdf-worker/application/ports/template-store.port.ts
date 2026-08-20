/**
 * Persistencia de los templates publicados por la API.
 *
 * Los incorporados no pasan por aquí: viajan en la imagen y se registran al arrancar. Este
 * puerto es sólo para los que un operador sube, y existe por una razón que se descubre el
 * primer reinicio: un template registrado únicamente en memoria desaparece, y con él la
 * capacidad de reproducir todos los documentos que ya se emitieron con él.
 *
 * El adaptador que se entrega escribe en disco. Para varias réplicas hace falta un almacén
 * compartido —una tabla, un bucket—: sin él, cada réplica conoce los templates que le
 * subieron a ella y `GET /pdf/templates` devuelve cosas distintas según a quién le toque.
 */
import type { StoredTemplate, TemplateBundle } from '../../domain/contracts/template-bundle';

export interface TemplateStorePort {
  /** Todo lo persistido, para cargarlo al arrancar. */
  list(): Promise<readonly StoredTemplate[]>;
  get(templateId: string, version: string): Promise<StoredTemplate | undefined>;
  /**
   * Guarda una versión NUEVA. Falla si la pareja `id@version` ya existe: la inmutabilidad se
   * defiende también aquí, no sólo en el registro en memoria, porque el disco sobrevive al
   * proceso y es el que acaba siendo la verdad.
   */
  save(bundle: TemplateBundle, meta: { createdBy?: string }): Promise<StoredTemplate>;
  /** Cambia el estado (publicado / obsoleto). No toca el contenido. */
  setStatus(
    templateId: string,
    version: string,
    status: StoredTemplate['status'],
  ): Promise<StoredTemplate>;
  /** Borra de verdad. Sólo debe usarse con versiones que nunca emitieron un documento. */
  remove(templateId: string, version: string): Promise<void>;
}

export const TEMPLATE_STORE_PORT = Symbol('TemplateStorePort');
