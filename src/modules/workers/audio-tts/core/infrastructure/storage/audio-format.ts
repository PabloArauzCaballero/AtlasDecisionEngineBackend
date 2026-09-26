/** Correspondencias formato ↔ extensión ↔ mime, compartidas por storage y proveedor. */
const FORMATS = [
  { prefix: 'mp3', extension: 'mp3', mimeType: 'audio/mpeg', accept: 'audio/mpeg' },
  { prefix: 'wav', extension: 'wav', mimeType: 'audio/wav', accept: 'audio/wav' },
  { prefix: 'pcm', extension: 'pcm', mimeType: 'audio/L16', accept: 'audio/basic' },
  { prefix: 'ulaw', extension: 'ulaw', mimeType: 'audio/basic', accept: 'audio/basic' },
  { prefix: 'opus', extension: 'opus', mimeType: 'audio/opus', accept: 'audio/opus' },
] as const;

function match(format: string): (typeof FORMATS)[number] | undefined {
  return FORMATS.find((entry) => format.startsWith(entry.prefix));
}

export function extensionFor(format: string): string {
  return match(format)?.extension ?? 'bin';
}

export function mimeTypeFor(format: string): string {
  return match(format)?.mimeType ?? 'application/octet-stream';
}

export function acceptFor(format: string): string {
  return match(format)?.accept ?? 'application/octet-stream';
}

/**
 * Verificación de que el cuerpo recibido es realmente audio. Un proveedor puede
 * devolver 200 con una página de error; sin esta comprobación se cachearía
 * de forma permanente como si fuese un audio válido.
 */
export function looksLikeAudio(buffer: Buffer, format: string): boolean {
  if (buffer.length < 4) return false;
  const head = buffer.subarray(0, 4);
  if (format.startsWith('mp3')) {
    const isId3 = head.toString('latin1', 0, 3) === 'ID3';
    const isFrame = head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0;
    return isId3 || isFrame;
  }
  if (format.startsWith('wav')) return head.toString('latin1') === 'RIFF';
  if (format.startsWith('opus')) return head.toString('latin1') === 'OggS';
  // pcm/ulaw no tienen cabecera: solo puede exigirse que no sea texto estructurado.
  const text = head.toString('latin1').trimStart().toLowerCase();
  return !text.startsWith('<') && !text.startsWith('{');
}
