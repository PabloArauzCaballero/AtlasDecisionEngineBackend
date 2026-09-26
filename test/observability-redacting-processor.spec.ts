import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  RedactingSpanProcessor,
  stripQuery,
} from '../src/common/observability/redacting-span-processor';

describe('stripQuery', () => {
  it('quita la cadena de consulta y conserva el resto', () => {
    expect(
      stripQuery('https://minio:9000/atlas/carnet.jpg?X-Amz-Signature=abc&X-Amz-Credential=def'),
    ).toBe('https://minio:9000/atlas/carnet.jpg');
  });

  it('quita también el fragmento', () => {
    expect(stripQuery('http://a/b#seccion')).toBe('http://a/b');
  });

  it('deja intacta una URL sin consulta', () => {
    expect(stripQuery('http://motor:3000/v1/decisions')).toBe('http://motor:3000/v1/decisions');
  });

  it('un valor que no es una URL no rompe nada', () => {
    expect(stripQuery('no-es-una-url')).toBe('no-es-una-url');
    expect(stripQuery('')).toBe('');
  });
});

describe('RedactingSpanProcessor', () => {
  const exporter = new InMemorySpanExporter();
  let provider: BasicTracerProvider;

  beforeAll(() => {
    // El saneado va ANTES del exportador: es lo que hace que el span exportado esté ya limpio.
    provider = new BasicTracerProvider({
      spanProcessors: [new RedactingSpanProcessor(), new SimpleSpanProcessor(exporter)],
    });
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(provider);
  });
  beforeEach(() => exporter.reset());
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  function spanCon(attributes: Record<string, string>) {
    const span = trace.getTracer('t').startSpan('llamada.externa', { attributes });
    span.end();
    const [exportado] = exporter.getFinishedSpans();
    // Sin `!`: el tsconfig del motor no tiene `noUncheckedIndexedAccess`, así que la aserción
    // sobra y `no-unnecessary-type-assertion` la rechaza. Comprobarlo dice algo más útil de
    // todos modos: si el span no llegó al exportador, el fallo señala eso y no un `undefined`
    // tres líneas más abajo.
    if (exportado === undefined) throw new Error('El span no llegó al exportador en memoria.');
    return exportado;
  }

  it('la firma de una URL de MinIO NO llega al exportador', () => {
    /*
     * Esto NO es hipotético en este motor: se comprobó antes de arreglarlo. Cada `put`, `get` y
     * `delete` de `ObjectStorageService` va por `fetch` a una URL firmada, y la traza publicaba
     * `url.full` y `url.query` enteros —firma y credencial incluidas— para objetos que son el
     * carnet y la selfie del solicitante.
     */
    const exportado = spanCon({
      'url.full': 'https://minio:9000/atlas/carnet.jpg?X-Amz-Signature=7f3a&X-Amz-Credential=clave',
      'url.query': 'X-Amz-Signature=7f3a&X-Amz-Credential=clave',
      'url.path': '/atlas/carnet.jpg',
    });
    expect(exportado.attributes['url.full']).toBe('https://minio:9000/atlas/carnet.jpg');
    expect(exportado.attributes['url.query']).toBeUndefined();
    // Lo que sirve para diagnosticar se conserva.
    expect(exportado.attributes['url.path']).toBe('/atlas/carnet.jpg');
  });

  it('cubre también el nombre antiguo del atributo de URL', () => {
    expect(
      spanCon({ 'http.url': 'http://a/b?identifier=ana@ejemplo.com' }).attributes['http.url'],
    ).toBe('http://a/b');
  });

  it('borra los parámetros de base de datos por si alguien enciende el reporte ampliado', () => {
    expect(
      spanCon({ 'db.statement.parameters': "['7712345']" }).attributes['db.statement.parameters'],
    ).toBeUndefined();
  });

  it('no toca los atributos legítimos', () => {
    const exportado = spanCon({
      'app.module': 'credit',
      'server.address': 'minio',
      'db.query.text': 'SELECT 1',
    });
    expect(exportado.attributes).toMatchObject({
      'app.module': 'credit',
      'server.address': 'minio',
      'db.query.text': 'SELECT 1',
    });
  });

  it('un span sin ninguno de esos atributos pasa sin cambios', () => {
    expect(Object.keys(spanCon({ 'app.operation': 'x' }).attributes)).toEqual(['app.operation']);
  });
});
