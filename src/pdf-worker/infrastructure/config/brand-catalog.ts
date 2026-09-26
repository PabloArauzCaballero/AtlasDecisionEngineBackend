/**
 * Marcas que TODO despliegue trae registradas, además de la del entorno.
 *
 * El generador es uno solo para toda la casa, y por eso el membrete no puede ser el de un
 * producto. Cuando el ERP empezó a imprimir por aquí, sus facturas salían encabezadas «ATLAS
 * Decision Engine»: el nombre del motor de decisión sobre un documento que no había pasado por
 * él. El arreglo NO es tocar la plantilla —la comparten los dos— sino que cada consumidor pida
 * su identidad visual con `brandId`, que es para lo que existe el catálogo de marcas.
 *
 * Se derivan de la marca del entorno a propósito: paleta, tipografía, espaciado y geometría son
 * las mismas: lo que cambia es QUIÉN firma el documento. Copiarlas enteras habría hecho que el
 * día que alguien ajuste un color, la mitad de los documentos de Atlas se queden con el viejo.
 *
 * El pie no se toca aquí: `generic-result-report` fija el suyo y el de la plantilla gana sobre el
 * de la marca (`config-precedence.ts`). Ese texto ya es neutro para los dos productos.
 */
import { brandFromEnv } from './default-brand';
import type { PdfWorkerEnv } from './pdf-worker.env';
import type { DocumentBrand } from '../../domain/value-objects/document-brand';

/** Identificador que pide `AtlasERPBackend` en `PDF_WORKER_BRAND_ID`. */
export const ERP_BRAND_ID = 'atlas-erp';

export function brandCatalog(env: PdfWorkerEnv): readonly DocumentBrand[] {
  const base = brandFromEnv(env);

  const erp: DocumentBrand = {
    ...base,
    id: ERP_BRAND_ID,
    name: 'ATLAS ERP',
    letterhead: {
      ...base.letterhead,
      organizationName: 'ATLAS ERP',
      secondaryText: 'Enterprise Hub',
    },
  };

  return [erp];
}
