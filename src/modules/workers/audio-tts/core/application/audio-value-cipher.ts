import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { AudioDomainError } from '../domain/errors';

const KDF_SALT = Buffer.from('audio-tts.kdf.v2', 'utf8');
const KDF_INFO = 'audio-tts:rendered-text';
const MIN_SECRET_LENGTH = 32;

export interface AudioDataKey {
  id: string;
  secret: string;
}

function deriveV2(secret: string, keyId: string): Buffer {
  const info = Buffer.from(`${KDF_INFO}|${keyId}`, 'utf8');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), KDF_SALT, info, 32));
}

/** Derivación del formato v1: hash simple, sin salt. Solo se conserva para descifrar datos antiguos. */
function deriveLegacyV1(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Cifrado de campo AES-256-GCM con derivación HKDF, rotación por keyId y
 * datos autenticados adicionales que ligan el texto a su asset.
 *
 * Formato v2: `v2.<keyId>.<iv>.<tag>.<ciphertext>` (base64url).
 * Formato v1 (solo lectura): `v1.<iv>.<tag>.<ciphertext>`.
 */
export class AudioValueCipher {
  private readonly keys = new Map<string, string>();

  constructor(
    private readonly active: AudioDataKey,
    previous: readonly AudioDataKey[] = [],
    private readonly allowShortSecret = false,
  ) {
    this.assertSecret(active.secret);
    this.keys.set(active.id, active.secret);
    for (const key of previous) {
      this.assertSecret(key.secret);
      this.keys.set(key.id, key.secret);
    }
  }

  /** @param aad Dato autenticado adicional. Debe ser el assetKey del asset propietario. */
  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', deriveV2(this.active.secret, this.active.id), iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      'v2',
      this.active.id,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(value: string, aad: string): string {
    const parts = value.split('.');
    if (parts[0] === 'v2') return this.decryptV2(parts, aad);
    if (parts[0] === 'v1') return this.decryptV1(parts);
    throw new AudioDomainError('Payload de audio cifrado inválido', 'AUDIO_CIPHER_FORMAT_INVALID');
  }

  /** true cuando el valor no está cifrado con la clave activa y conviene re-cifrarlo. */
  needsRewrap(value: string): boolean {
    const parts = value.split('.');
    return parts[0] !== 'v2' || parts[1] !== this.active.id;
  }

  private decryptV2(parts: readonly string[], aad: string): string {
    const [, keyId, iv, tag, ciphertext] = parts;
    if (!keyId || !iv || !tag || !ciphertext) {
      throw new AudioDomainError(
        'Payload de audio cifrado inválido',
        'AUDIO_CIPHER_FORMAT_INVALID',
      );
    }
    const secret = this.keys.get(keyId);
    if (!secret) {
      throw new AudioDomainError(
        `Clave de datos desconocida: ${keyId}`,
        'AUDIO_CIPHER_KEY_UNKNOWN',
      );
    }
    return this.open(deriveV2(secret, keyId), iv, tag, ciphertext, aad);
  }

  private decryptV1(parts: readonly string[]): string {
    const [, iv, tag, ciphertext] = parts;
    if (!iv || !tag || !ciphertext) {
      throw new AudioDomainError(
        'Payload de audio cifrado inválido',
        'AUDIO_CIPHER_FORMAT_INVALID',
      );
    }
    return this.open(deriveLegacyV1(this.active.secret), iv, tag, ciphertext);
  }

  private open(key: Buffer, iv: string, tag: string, ciphertext: string, aad?: string): string {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // No se propaga el error original: podría filtrar detalles del material criptográfico.
      throw new AudioDomainError(
        'No fue posible descifrar el texto del asset',
        'AUDIO_CIPHER_AUTH_FAILED',
      );
    }
  }

  private assertSecret(secret: string): void {
    const minimum = this.allowShortSecret ? 16 : MIN_SECRET_LENGTH;
    if (secret.length < minimum) {
      throw new AudioDomainError(
        `AUDIO_TTS_DATA_KEY debe tener al menos ${minimum} caracteres`,
        'AUDIO_CIPHER_KEY_TOO_SHORT',
      );
    }
  }
}

/** Parsea `id:secret,id:secret` en claves anteriores para descifrado durante una rotación. */
export function parsePreviousKeys(raw: string): AudioDataKey[] {
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator <= 0) {
        throw new AudioDomainError(
          'AUDIO_TTS_DATA_KEYS_PREVIOUS debe usar el formato id:secreto[,id:secreto]',
          'AUDIO_CIPHER_KEYRING_INVALID',
        );
      }
      return { id: entry.slice(0, separator), secret: entry.slice(separator + 1) };
    });
}
