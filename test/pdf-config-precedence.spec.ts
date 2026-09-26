/**
 * Precedencia de configuración y opciones protegidas (§13).
 *
 * La prueba central es la del rechazo: comprobar que una opción protegida se IGNORA no sirve de
 * nada, porque ignorarla produce un documento distinto al pedido sin que nadie se entere. Lo
 * que hay que fijar es que se conteste.
 */
import { z } from 'zod';
import { defineTemplate } from '../src/pdf-worker/domain/contracts/template-contract';
import {
  ProtectedOptionOverrideError,
  InvalidBrandError,
} from '../src/pdf-worker/domain/errors/pdf-worker.errors';
import {
  assertBrand,
  type DocumentBrand,
} from '../src/pdf-worker/domain/value-objects/document-brand';
import {
  OVERRIDABLE_REQUEST_OPTIONS,
  assertOnlyOverridable,
  resolveClassification,
  resolvePageSetup,
} from '../src/pdf-worker/application/services/config-precedence';
import { brandFromEnv } from '../src/pdf-worker/infrastructure/config/default-brand';
import { loadPdfWorkerEnv } from '../src/pdf-worker/infrastructure/config/pdf-worker.env';
import { zodSchema } from '../src/pdf-worker/infrastructure/validation/zod-payload-schema';

const brand: DocumentBrand = brandFromEnv(
  loadPdfWorkerEnv({ PDF_ORG_NAME: 'Organización de prueba', PDF_DEFAULT_FORMAT: 'A4' }),
);

const contract = defineTemplate({
  id: 'informe',
  version: '1.0.0',
  title: 'Informe',
  description: '—',
  sourceDir: __dirname,
  schema: zodSchema(z.strictObject({})),
  fixture: () => ({}),
  classification: 'CONFIDENTIAL',
  page: { orientation: 'landscape' },
});

describe('Precedencia de configuración', () => {
  it('acepta las opciones publicadas como sobrescribibles', () => {
    expect(() =>
      assertOnlyOverridable({ persist: true, filename: 'a.pdf', page: { format: 'Letter' } }),
    ).not.toThrow();
    expect(OVERRIDABLE_REQUEST_OPTIONS).toContain('page.format');
  });

  it('rechaza —no ignora— una opción protegida y dice cuál', () => {
    try {
      assertOnlyOverridable({ page: { scale: 3 } });
      throw new Error('debería haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtectedOptionOverrideError);
      expect((error as ProtectedOptionOverrideError).attempted).toEqual(['page.scale']);
    }
  });

  it('rechaza también los márgenes, que son los que hacen que la cabecera tape el texto', () => {
    expect(() => assertOnlyOverridable({ page: { margins: { top: '2mm' } } })).toThrow(
      ProtectedOptionOverrideError,
    );
    expect(() => assertOnlyOverridable({ letterhead: { organizationName: 'Otra' } })).toThrow(
      ProtectedOptionOverrideError,
    );
  });

  it('aplica defaults → marca → template → petición, en ese orden', () => {
    const setup = resolvePageSetup(brand, contract, { page: { format: 'Legal' } });
    // El formato lo impuso la petición; la orientación, el template; los márgenes, los defaults.
    expect(setup.format).toBe('Legal');
    expect(setup.orientation).toBe('landscape');
    expect(setup.margins.top).toBe('32mm');
  });

  it('la petición puede SUBIR la clasificación pero no bajarla', () => {
    expect(resolveClassification(brand, contract, 'RESTRICTED')).toBe('RESTRICTED');
    // El template se declara CONFIDENTIAL porque el documento lo es; permitir que una petición
    // lo rebaje a PUBLIC convertiría el rótulo en una preferencia del llamante.
    expect(resolveClassification(brand, contract, 'PUBLIC')).toBe('CONFIDENTIAL');
  });

  it('valida la marca al registrarla, con el campo exacto', () => {
    expect(() => assertBrand(brand)).not.toThrow();
    expect(() => assertBrand({ ...brand, palette: { ...brand.palette, ink: 'azul' } })).toThrow(
      InvalidBrandError,
    );
    expect(() =>
      assertBrand({
        ...brand,
        letterhead: { ...brand.letterhead, logo: 'https://cdn.example.com/logo.svg' },
      }),
    ).toThrow(InvalidBrandError);
  });

  it('aborta el arranque cuando el entorno no cuadra, con todos los problemas a la vez', () => {
    expect(() =>
      loadPdfWorkerEnv({ PDF_RENDER_CONCURRENCY: '0', PDF_BRAND_ACCENT: 'azul' }),
    ).toThrow(
      /PDF_RENDER_CONCURRENCY[\s\S]*PDF_BRAND_ACCENT|PDF_BRAND_ACCENT[\s\S]*PDF_RENDER_CONCURRENCY/,
    );
  });
});
