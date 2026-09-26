/**
 * Catálogo de identidades visuales.
 *
 * Cada marca se valida AL REGISTRARLA, no al usarla. La diferencia se nota el día del
 * despliegue: un color mal escrito aborta el arranque con el campo exacto, en vez de producir
 * el primer informe del trimestre con una regla CSS descartada y un panel en blanco.
 */
import { Injectable } from '@nestjs/common';
import type { BrandRepositoryPort } from '../../application/ports/brand-repository.port';
import { InvalidBrandError } from '../../domain/errors/pdf-worker.errors';
import { assertBrand, type DocumentBrand } from '../../domain/value-objects/document-brand';

@Injectable()
export class BrandRegistry implements BrandRepositoryPort {
  private readonly brands = new Map<string, DocumentBrand>();
  private defaultBrandId?: string;

  register(brand: DocumentBrand): void {
    assertBrand(brand);
    this.brands.set(brand.id, Object.freeze(brand));
    this.defaultBrandId ??= brand.id;
  }

  /**
   * Fija la marca por defecto por identificador.
   *
   * Falla si no existe en vez de caer a la primera registrada: un `PDF_DEFAULT_BRAND` con una
   * errata dejaría todos los documentos con el membrete equivocado, y eso no lo detecta
   * ninguna prueba automática — sólo alguien mirando un PDF ya enviado.
   */
  setDefault(brandId: string): void {
    if (!this.brands.has(brandId)) {
      throw new InvalidBrandError(brandId, 'no está registrada; revise PDF_DEFAULT_BRAND.');
    }
    this.defaultBrandId = brandId;
  }

  get(brandId: string): DocumentBrand {
    const brand = this.brands.get(brandId);
    if (!brand) {
      throw new InvalidBrandError(
        brandId,
        `no está registrada. Disponibles: ${[...this.brands.keys()].join(', ') || 'ninguna'}.`,
      );
    }
    return brand;
  }

  getDefault(): DocumentBrand {
    if (!this.defaultBrandId) {
      throw new InvalidBrandError('(ninguna)', 'no hay ninguna identidad visual registrada.');
    }
    return this.get(this.defaultBrandId);
  }

  has(brandId: string): boolean {
    return this.brands.has(brandId);
  }

  list(): readonly DocumentBrand[] {
    return [...this.brands.values()];
  }
}
