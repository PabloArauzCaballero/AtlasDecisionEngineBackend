/**
 * El catálogo de errores, comprobado contra el código.
 *
 * Un catálogo es documentación con otro nombre, y la documentación envejece en silencio. Estas
 * pruebas son lo que impide que pase: no se puede añadir un error sin explicarlo, ni dejar una
 * explicación de un error que ya no existe, ni cambiar el estado HTTP de una clase sin que el
 * catálogo lo refleje.
 */
import {
  PDF_ERROR_CATALOG,
  errorCatalogEntries,
} from '../src/pdf-worker/domain/errors/error-catalog';
import {
  ArtifactContractUnavailableError,
  ArtifactNotFoundError,
  AssetResolutionError,
  DocumentStorageError,
  IdempotentRequestInFlightError,
  InvalidBrandError,
  PDF_ERROR_CODES,
  PdfRenderError,
  PdfRenderTimeoutError,
  PdfWorkerError,
  ProtectedOptionOverrideError,
  RenderCapacityExceededError,
  TemplateAdminDisabledError,
  TemplateAdminUnauthorizedError,
  TemplateAlreadyRegisteredError,
  TemplateBuiltinProtectedError,
  TemplateBundleInvalidError,
  TemplateImmutableError,
  TemplateNotFoundError,
  TemplatePayloadValidationError,
  TemplateRenderError,
  TemplateSourceError,
  TemplateStoreError,
  TemplateVersionNotFoundError,
} from '../src/pdf-worker/domain/errors/pdf-worker.errors';

/**
 * Una instancia de CADA clase de error.
 *
 * Es la lista que hace real la comprobación: sin instanciarlas no hay forma de leer su `code`
 * ni su `httpStatus`, porque los declara la clase y no un mapa aparte. Añadir una clase nueva y
 * olvidarla aquí lo detecta la última prueba del archivo.
 */
const INSTANCIAS: readonly PdfWorkerError[] = [
  new TemplateNotFoundError('x'),
  new TemplateVersionNotFoundError('x', '1.0.0', []),
  new TemplateAlreadyRegisteredError('x', '1.0.0'),
  new TemplatePayloadValidationError('x', '1.0.0', []),
  new TemplateSourceError('x', 'motivo'),
  new TemplateRenderError('x', 'motivo'),
  new PdfRenderError('motivo'),
  new PdfRenderTimeoutError(1_000),
  new RenderCapacityExceededError(1, 1),
  new AssetResolutionError('asset:x', 'motivo'),
  new DocumentStorageError('local', 'motivo'),
  new InvalidBrandError('x', 'motivo'),
  new ProtectedOptionOverrideError(['page.scale']),
  new IdempotentRequestInFlightError('clave'),
  new TemplateBundleInvalidError([]),
  new TemplateImmutableError('x', '1.0.0', '1.0.1'),
  new TemplateStoreError('guardar', 'motivo'),
  new TemplateAdminDisabledError(),
  new TemplateAdminUnauthorizedError(),
  new TemplateBuiltinProtectedError('x', '1.0.0'),
  new ArtifactContractUnavailableError(),
  new ArtifactNotFoundError('x'),
];

describe('Catálogo de errores', () => {
  it('todo código publicado tiene entrada, y toda entrada corresponde a un código', () => {
    expect(Object.keys(PDF_ERROR_CATALOG).sort()).toEqual([...PDF_ERROR_CODES].sort());
    for (const code of PDF_ERROR_CODES) {
      // La clave del mapa y el `code` de la entrada tienen que coincidir: si divergen, el
      // catálogo publicado describe un error con el nombre de otro.
      expect(PDF_ERROR_CATALOG[code].code).toBe(code);
    }
  });

  it('cada entrada explica qué es, por qué pasa y cómo se resuelve', () => {
    for (const entry of errorCatalogEntries()) {
      expect(entry.title.length).toBeGreaterThan(8);
      expect(entry.meaning.length).toBeGreaterThan(20);
      expect(entry.cause.length).toBeGreaterThan(20);
      expect(entry.remedy.length).toBeGreaterThan(20);
      expect(entry.httpStatus).toBeGreaterThanOrEqual(400);
      expect(['consumidor', 'operador', 'ambos']).toContain(entry.audience);
    }
  });

  it('el estado HTTP del catálogo es el que devuelve la clase', () => {
    // Es la comprobación que impide la mentira más cara: cambiar un 429 por un 503 en el
    // código y dejar el catálogo prometiendo el anterior, con lo que el cliente reintenta —o
    // deja de hacerlo— siguiendo una documentación que ya no describe nada.
    for (const error of INSTANCIAS) {
      const entry = PDF_ERROR_CATALOG[error.code];
      expect(entry).toBeDefined();
      expect(entry.httpStatus).toBe(error.httpStatus);
    }
  });

  it('hay una clase de error por cada código publicado', () => {
    const cubiertos = new Set(INSTANCIAS.map((error) => error.code));
    expect([...cubiertos].sort()).toEqual([...PDF_ERROR_CODES].sort());
  });

  it('sólo los reintentables sugieren reintentar', () => {
    for (const entry of errorCatalogEntries()) {
      // Reintentar un 422 es tiempo perdido; no reintentar un 429 es rendirse cuando bastaba
      // esperar. Que el campo exista obliga a decidirlo explícitamente para cada código.
      if (entry.httpStatus === 422 || entry.httpStatus === 403) {
        expect(entry.retryable).toBe(false);
      }
    }
    expect(PDF_ERROR_CATALOG.PDF_RENDER_CAPACITY_EXCEEDED.retryable).toBe(true);
    expect(PDF_ERROR_CATALOG.TEMPLATE_PAYLOAD_INVALID.retryable).toBe(false);
  });
});
