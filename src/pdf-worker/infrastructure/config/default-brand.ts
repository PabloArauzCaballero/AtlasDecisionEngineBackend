/**
 * La marca por defecto, construida desde el entorno (§11, §12).
 *
 * Un despliegue nuevo obtiene un membrete correcto sin escribir código: basta `PDF_ORG_NAME` y,
 * si lo hay, `PDF_ORG_LOGO`. Registrar marcas adicionales —una por filial, por ejemplo— es
 * llamar a `BrandRegistry.register()` con otro objeto como éste; el motor no cambia.
 *
 * La paleta no es configurable por entorno salvo el acento. Es deliberado: los grises, los
 * colores de estado y sus lavados están calculados para contrastar entre sí sobre papel, y
 * dejar los nueve sueltos en variables de entorno garantiza que antes o después alguien
 * despliegue un informe con texto gris claro sobre fondo blanco.
 */
import type { DocumentBrand } from '../../domain/value-objects/document-brand';
import type { PdfWorkerEnv } from './pdf-worker.env';

export function brandFromEnv(env: PdfWorkerEnv): DocumentBrand {
  return {
    id: env.PDF_BRAND_ID,
    name: env.PDF_BRAND_NAME,
    letterhead: {
      organizationName: env.PDF_ORG_NAME,
      legalName: env.PDF_ORG_LEGAL_NAME,
      taxId: env.PDF_ORG_TAX_ID,
      address: env.PDF_ORG_ADDRESS,
      phone: env.PDF_ORG_PHONE,
      email: env.PDF_ORG_EMAIL,
      website: env.PDF_ORG_WEBSITE,
      secondaryText: env.PDF_ORG_SECONDARY_TEXT,
      logo: env.PDF_ORG_LOGO,
      mode: env.PDF_LETTERHEAD_MODE,
    },
    footer: {
      institutionalText: env.PDF_FOOTER_TEXT,
      showGeneratedAt: true,
      showDocumentId: true,
      showPageNumbers: true,
    },
    palette: {
      ink: '#111827',
      inkMuted: '#4b5563',
      accent: env.PDF_BRAND_ACCENT,
      surface: '#ffffff',
      surfaceMuted: '#f4f5f7',
      line: '#d4d7dd',
      positive: '#047857',
      caution: '#b45309',
      critical: '#b91c1c',
    },
    typography: {
      // La primera familia es la que embebe `FontRegistry` si hay un archivo en `fonts/`; el
      // resto es el respaldo que el contenedor garantiza (ver el Dockerfile).
      fontFamily: 'Atlas Sans',
      monoFamily: 'Atlas Mono',
      baseSizePt: 9.5,
      lineHeight: 1.45,
    },
    spacing: {
      blockGap: '4mm',
      sectionGap: '8mm',
      cellPaddingY: '1.6mm',
      cellPaddingX: '2.4mm',
    },
    page: { format: env.PDF_DEFAULT_FORMAT },
  };
}
