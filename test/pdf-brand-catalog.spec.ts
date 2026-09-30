import {
  brandCatalog,
  COMMERCIAL_BRAND_ID,
  ERP_BRAND_ID,
} from '../src/pdf-worker/infrastructure/config/brand-catalog';
import { brandFromEnv } from '../src/pdf-worker/infrastructure/config/default-brand';
import { assertBrand } from '../src/pdf-worker/domain/value-objects/document-brand';

/** Lo que recibe un comercio no puede ir firmado «ATLAS ERP · Enterprise Hub». */
describe('catálogo de marcas del generador', () => {
  const env = {
    PDF_BRAND_ID: 'atlas',
    PDF_BRAND_NAME: 'ATLAS Decision Engine',
    PDF_ORG_NAME: 'ATLAS Decision Engine',
    PDF_BRAND_ACCENT: '#1f6f5c',
    PDF_DEFAULT_FORMAT: 'A4',
    PDF_LETTERHEAD_MODE: 'full',
    PDF_FOOTER_TEXT: 'Documento generado por la plataforma ATLAS.',
  } as never;

  it('la marca comercial firma ATLAS con el teal de la marca pública, y conserva lo demás', () => {
    const base = brandFromEnv(env);
    const comercial = brandCatalog(env).find((marca) => marca.id === COMMERCIAL_BRAND_ID)!;
    expect(comercial.letterhead.organizationName).toBe('ATLAS');
    expect(comercial.letterhead.secondaryText).toBe('Compras en cuotas para su comercio');
    expect(comercial.palette.accent).toBe('#0E7377');
    expect(comercial.typography).toEqual(base.typography);
    expect(() => assertBrand(comercial)).not.toThrow();
  });

  it('la del ERP sigue igual', () => {
    expect(
      brandCatalog(env).find((marca) => marca.id === ERP_BRAND_ID)!.letterhead.organizationName,
    ).toBe('ATLAS ERP');
  });
});
