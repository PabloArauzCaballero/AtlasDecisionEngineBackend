/**
 * Catálogo de identidades visuales (§12).
 *
 * Separado del de templates porque las dos dimensiones son ortogonales: N templates × M
 * marcas. Meter la marca dentro del template obliga a duplicar el informe una vez por
 * organización, que es exactamente el crecimiento que el §50 quiere evitar.
 */
import type { DocumentBrand } from '../../domain/value-objects/document-brand';

export interface BrandRepositoryPort {
  get(brandId: string): DocumentBrand;
  /** Marca aplicada cuando la petición no nombra ninguna. Siempre existe. */
  getDefault(): DocumentBrand;
  has(brandId: string): boolean;
  list(): readonly DocumentBrand[];
  register(brand: DocumentBrand): void;
}

export const BRAND_REPOSITORY_PORT = Symbol('BrandRepositoryPort');
