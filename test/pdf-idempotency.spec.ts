/**
 * Idempotencia (§31) y huella del payload (§32).
 *
 * Lo que se fija aquí es que la clave incluye el CONTENIDO. Sin eso, un cliente que reutiliza
 * «pedido-4821» para dos documentos distintos recibe el primero disfrazado de segundo, y ese
 * fallo es silencioso, tardío y prácticamente imposible de diagnosticar desde su lado.
 */
import {
  buildIdempotencyKey,
  canonicalJson,
  payloadFingerprint,
} from '../src/pdf-worker/application/services/idempotency-key';
import { InMemoryIdempotencyStoreAdapter } from '../src/pdf-worker/infrastructure/idempotency/in-memory-idempotency-store.adapter';

const scope = {
  idempotencyKey: 'pedido-4821',
  templateId: 'informe',
  templateVersion: '1.0.0',
  brandId: 'atlas',
};

const outcome = {
  documentId: 'DOC-A1B2C3D4E5F6',
  checksum: 'abc',
  filename: 'informe.pdf',
  sizeBytes: 1_024,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('Idempotencia', () => {
  it('serializa con las claves ordenadas en todos los niveles', () => {
    // Dos servicios distintos serializan el mismo objeto en distinto orden. Sin canonicalizar,
    // la idempotencia dejaría de funcionar justo entre servicios, que es donde hace falta.
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(payloadFingerprint({ a: 1, b: 2 })).toBe(payloadFingerprint({ b: 2, a: 1 }));
  });

  it('da la misma clave para el mismo payload y otra distinta para otro', () => {
    const uno = buildIdempotencyKey({ ...scope, payload: { total: 100 } });
    expect(buildIdempotencyKey({ ...scope, payload: { total: 100 } })).toBe(uno);
    expect(buildIdempotencyKey({ ...scope, payload: { total: 101 } })).not.toBe(uno);
    // Misma clave del cliente, otra versión de template: es otro documento.
    expect(
      buildIdempotencyKey({ ...scope, templateVersion: '1.1.0', payload: { total: 100 } }),
    ).not.toBe(uno);
  });

  describe('almacén en memoria', () => {
    it('devuelve el desenlace guardado y bloquea una segunda reserva simultánea', async () => {
      const store = new InMemoryIdempotencyStoreAdapter();
      expect(await store.acquire('k', 60)).toBe(true);
      // Sin la reserva, dos peticiones simultáneas renderizarían las dos y una pisaría a la
      // otra: la idempotencia sólo cubriría el reenvío lento, que es el caso fácil.
      expect(await store.acquire('k', 60)).toBe(false);

      await store.put('k', outcome, 60);
      expect(await store.get('k')).toEqual(outcome);
    });

    it('libera la reserva pero conserva el desenlace', async () => {
      const store = new InMemoryIdempotencyStoreAdapter();
      await store.acquire('k', 60);
      await store.release('k');
      expect(await store.get('k')).toBeUndefined();
      expect(await store.acquire('k', 60)).toBe(true);

      await store.put('k', outcome, 60);
      await store.release('k');
      expect(await store.get('k')).toEqual(outcome);
    });

    it('caduca: una reserva huérfana no puede bloquear la clave para siempre', async () => {
      const store = new InMemoryIdempotencyStoreAdapter();
      // Un proceso que muere a mitad de un render deja la reserva puesta. Si no caducase, el
      // reintento —que es justo lo que la idempotencia debe permitir— se rechazaría siempre.
      expect(await store.acquire('k', 0.05)).toBe(true);
      await new Promise((done) => setTimeout(done, 120));
      expect(await store.acquire('k', 60)).toBe(true);
    });
  });
});
