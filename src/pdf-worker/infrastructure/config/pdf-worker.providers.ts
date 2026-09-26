/**
 * Fábricas de la composición: dónde se decide qué implementación entra por cada puerto.
 *
 * Está separado del módulo porque es lo ÚNICO que cambia al añadir un proveedor —Gotenberg,
 * S3, BullMQ— y así el módulo sigue siendo una lista legible de un vistazo. Aquí es donde
 * `PDF_RENDERER=…` deja de ser texto y se convierte en una clase.
 */
import { resolve } from 'node:path';
import type { PdfWorkerSettings } from '../../application/ports/settings.port';
import type { DocumentStoragePort } from '../../application/ports/document-storage.port';
import type { PdfRendererPort } from '../../application/ports/pdf-renderer.port';
import { BUNDLED_TEMPLATES_ROOT } from '../templates/filesystem-template-loader';
import { PlaywrightPdfRendererAdapter } from '../rendering/playwright/playwright-pdf-renderer.adapter';
import { LocalDocumentStorageAdapter } from '../storage/local-document-storage.adapter';
import { MemoryDocumentStorageAdapter } from '../storage/memory-document-storage.adapter';
import type { PdfWorkerEnv } from './pdf-worker.env';

/** Token de inyección de las rutas. Vive aquí y no en el módulo para no cerrar un ciclo de
 *  importación: el ciclo de vida necesita las rutas y el módulo necesita el ciclo de vida. */
export const PDF_WORKER_PATHS = Symbol('PdfWorkerPaths');

export interface PdfWorkerPaths {
  readonly templates: string;
  readonly assets: string;
  readonly fonts: string;
  readonly storage: string;
  /** Templates publicados por la API. Separado del resto: es el único que se ESCRIBE. */
  readonly customTemplates: string;
}

/**
 * Rutas efectivas.
 *
 * Los recursos y las fuentes cuelgan por defecto de la raíz de plantillas para que TODO lo que
 * el documento necesita viaje junto en la imagen. Separarlos por omisión es cómo se acaba con
 * una imagen que tiene las plantillas y no el logotipo.
 */
export function resolvePaths(env: PdfWorkerEnv): PdfWorkerPaths {
  const templates = env.PDF_TEMPLATE_PATH ? resolve(env.PDF_TEMPLATE_PATH) : BUNDLED_TEMPLATES_ROOT;
  return {
    templates,
    assets: env.PDF_ASSETS_PATH
      ? resolve(env.PDF_ASSETS_PATH)
      : resolve(templates, 'shared', 'assets'),
    fonts: env.PDF_FONTS_PATH ? resolve(env.PDF_FONTS_PATH) : resolve(templates, 'shared', 'fonts'),
    storage: resolve(env.PDF_STORAGE_PATH),
    // Fuera del árbol de plantillas incorporadas a propósito: éstas se escriben en ejecución y
    // tienen que vivir en un volumen persistente, no en la capa de sólo lectura de la imagen.
    customTemplates: resolve(env.PDF_CUSTOM_TEMPLATE_PATH),
  };
}

export function settingsFrom(env: PdfWorkerEnv): PdfWorkerSettings {
  return {
    renderTimeoutMs: env.PDF_RENDER_TIMEOUT_MS,
    renderConcurrency: env.PDF_RENDER_CONCURRENCY,
    renderQueueTimeoutMs: env.PDF_RENDER_QUEUE_TIMEOUT_MS,
    storageEnabled: env.PDF_STORAGE_ENABLED,
    persistByDefault: env.PDF_PERSIST_BY_DEFAULT,
    idempotencyTtlSeconds: env.PDF_IDEMPOTENCY_TTL_SECONDS,
    idempotencyLeaseSeconds: env.PDF_IDEMPOTENCY_LEASE_SECONDS,
    defaultBrandId: env.PDF_BRAND_ID,
    defaultLocale: env.PDF_DEFAULT_LOCALE,
    defaultTimezone: env.PDF_DEFAULT_TIMEZONE,
    maxDocumentBytes: env.PDF_MAX_DOCUMENT_BYTES,
  };
}

/**
 * El punto donde `PDF_RENDERER` elige motor.
 *
 * Hoy tiene una rama y el esquema de entorno sólo admite un valor, así que no puede llegar
 * nada más. Añadir Gotenberg es una rama aquí y un valor en el enum — y CERO cambios en los
 * casos de uso, que es la propiedad que este archivo existe para hacer visible.
 */
export function createRenderer(env: PdfWorkerEnv): PdfRendererPort {
  switch (env.PDF_RENDERER) {
    case 'playwright':
    default:
      return new PlaywrightPdfRendererAdapter({
        concurrency: env.PDF_RENDER_CONCURRENCY,
        queueTimeoutMs: env.PDF_RENDER_QUEUE_TIMEOUT_MS,
        headless: env.PDF_BROWSER_HEADLESS,
        executablePath: env.PDF_BROWSER_EXECUTABLE_PATH,
        javaScriptEnabled: env.PDF_BROWSER_JAVASCRIPT,
      });
  }
}

export function createStorage(env: PdfWorkerEnv, paths: PdfWorkerPaths): DocumentStoragePort {
  return env.PDF_STORAGE_PROVIDER === 'memory'
    ? new MemoryDocumentStorageAdapter()
    : new LocalDocumentStorageAdapter(paths.storage);
}
