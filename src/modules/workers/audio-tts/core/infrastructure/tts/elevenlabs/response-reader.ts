import { TtsProviderError } from '../../../domain/errors';

/**
 * Lee el cuerpo por trozos y aborta al superar el límite. `arrayBuffer()` cargaría
 * en memoria lo que el proveedor decidiese enviar, sin techo.
 */
export async function readCappedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge(declared, maxBytes);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw tooLarge(total, maxBytes);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, total);
}

function tooLarge(size: number, maxBytes: number): TtsProviderError {
  return new TtsProviderError(
    `Respuesta de audio de ${size} bytes supera el máximo de ${maxBytes}`,
    'ELEVENLABS_RESPONSE_TOO_LARGE',
    false,
  );
}
