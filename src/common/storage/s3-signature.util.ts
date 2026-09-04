import { createHash, createHmac } from 'node:crypto';

/**
 * Firma AWS Signature Version 4 para URLs prefirmadas de S3, implementada con `node:crypto`.
 *
 * Se implementa aquí en vez de agregar `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
 * porque el repositorio exige una decisión documentada (ADR) para incorporar una librería, y lo
 * único que este proyecto necesita del SDK es firmar dos verbos (PUT y GET) contra un endpoint
 * compatible con S3. SigV4 es un algoritmo público y estable; el costo de mantenerlo es menor que
 * el de arrastrar el árbol de dependencias del SDK para dos operaciones.
 *
 * Compatible con cualquier almacenamiento que hable el protocolo S3 (AWS S3, MinIO, Cloudflare R2,
 * Backblaze B2), que es justamente lo que evita el bloqueo por proveedor.
 *
 * ## Por qué está DUPLICADA desde AtlasBackend
 *
 * Es la misma implementación, carácter por carácter salvo este comentario, y eso es deliberado: son
 * dos repositorios sin un paquete común publicado, y la alternativa —un tercer repo, su versionado
 * y su publicación— cuesta más que 130 líneas de un algoritmo público que no cambia desde 2012.
 * Si algún día se toca, hay que tocar las dos: `AtlasBackend/src/common/storage/s3-signature.util.ts`.
 * La prueba que fija la firma contra un vector conocido existe en ambos lados por esa razón.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Endpoint base, sin bucket: `https://s3.us-east-1.amazonaws.com` o `http://localhost:9000`. */
  endpoint: string;
  bucket: string;
  /** MinIO y compatibles necesitan `bucket` en la ruta; AWS acepta ambos estilos. */
  forcePathStyle: boolean;
};

export type PresignInput = {
  credentials: S3Credentials;
  /**
   * `DELETE` se suma a los tres originales para el adaptador de archivos: SigV4 firma el verbo como
   * un dato más de la petición canónica, así que soportarlo no cambia el algoritmo — sólo amplía
   * qué se puede pedir con una URL prefirmada.
   */
  method: 'PUT' | 'GET' | 'HEAD' | 'DELETE';
  objectKey: string;
  expiresInSeconds: number;
  /** Cabeceras que el cliente DEBE enviar; van firmadas, así que alterarlas invalida la URL. */
  signedHeaders?: Record<string, string>;
  /** Marca temporal de la firma. Explícita para que la función sea determinista y testeable. */
  now: Date;
};

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** Codificación de URI de AWS: como `encodeURIComponent` pero conservando `~` y escapando `!*'()`. */
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = '';
  for (const char of value) {
    const isUnreserved = /[A-Za-z0-9\-._~]/.test(char);
    if (isUnreserved) out += char;
    else if (char === '/') out += encodeSlash ? '%2F' : '/';
    else {
      for (const byte of Buffer.from(char, 'utf8')) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

function amzDate(now: Date): { stamp: string; dateOnly: string } {
  const stamp = `${now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, '')
    .slice(0, 15)}Z`;
  return { stamp, dateOnly: stamp.slice(0, 8) };
}

function buildHostAndPath(credentials: S3Credentials, objectKey: string): { host: string; path: string; origin: string } {
  const url = new URL(credentials.endpoint);
  const encodedKey = uriEncode(objectKey, false);
  if (credentials.forcePathStyle) {
    return { host: url.host, path: `/${credentials.bucket}/${encodedKey}`, origin: url.origin };
  }
  const host = `${credentials.bucket}.${url.host}`;
  return { host, path: `/${encodedKey}`, origin: `${url.protocol}//${host}` };
}

function signingKey(credentials: S3Credentials, dateOnly: string): Buffer {
  const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, dateOnly);
  const regionKey = hmac(dateKey, credentials.region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

/**
 * Construye una URL prefirmada.
 *
 * Todas las cabeceras que se firman quedan obligadas para el cliente: si el frontend sube el
 * archivo con un `Content-Type` o un `Content-Length` distinto al que se firmó, S3 rechaza la
 * petición. Es lo que permite acotar tipo y tamaño ANTES de que el objeto exista, en vez de
 * descubrirlo después.
 */
export function presignS3Url(input: PresignInput): string {
  const { credentials } = input;
  const { stamp, dateOnly } = amzDate(input.now);
  const { host, path, origin } = buildHostAndPath(credentials, input.objectKey);

  const headers: Record<string, string> = { host, ...(input.signedHeaders ?? {}) };
  const canonicalHeaderEntries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaderNames = canonicalHeaderEntries.map(([name]) => name).join(';');
  const canonicalHeaders = `${canonicalHeaderEntries.map(([name, value]) => `${name}:${value}`).join('\n')}\n`;

  const credentialScope = `${dateOnly}/${credentials.region}/${SERVICE}/aws4_request`;
  const queryEntries: Array<[string, string]> = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${credentials.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(input.expiresInSeconds)],
    ['X-Amz-SignedHeaders', signedHeaderNames],
  ];
  const canonicalQuery = queryEntries
    .map(([key, value]) => [uriEncode(key, true), uriEncode(value, true)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonicalRequest = [input.method, path, canonicalQuery, canonicalHeaders, signedHeaderNames, UNSIGNED_PAYLOAD].join('\n');
  const stringToSign = [ALGORITHM, stamp, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(credentials, dateOnly)).update(stringToSign, 'utf8').digest('hex');

  return `${origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
