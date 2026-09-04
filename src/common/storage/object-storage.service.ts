import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { presignS3Url, type S3Credentials } from './s3-signature.util';

/** Lo que se guarda de un objeto ya escrito. Es lo único que una tabla necesita conservar. */
export interface StoredObject {
  objectKey: string;
  sizeBytes: number;
  contentType: string;
  sha256Hex: string;
}

/**
 * Almacén de objetos del motor — MinIO, el MISMO que usa AtlasBackend.
 *
 * ## Qué problema resuelve
 *
 * El motor no tenía almacén. Las imágenes de identidad —la cara de la persona y las dos caras de
 * su cédula— vivían en columnas `Bytes` de Postgres y se ponían a `null` en cuanto había veredicto.
 * Como decisión de privacidad era coherente y estaba escrita en el esquema; como consecuencia
 * práctica significaba que la evidencia sobre la que se decidió NO EXISTÍA al día siguiente: ni
 * para revisar el caso, ni para responder a una impugnación, ni para auditar por qué se rechazó a
 * alguien.
 *
 * Este servicio le da al motor un sitio donde esas imágenes sobreviven al cierre de la ejecución,
 * fuera de la base y fuera del disco del contenedor.
 *
 * ## Lo que NO cambia
 *
 * Las columnas `Bytes` siguen siendo la copia de trabajo del pipeline y se siguen borrando en los
 * seis sitios donde se borraban. Lo que se añade es una copia duradera escrita ANTES, al ingresar.
 * No se tocó ninguna de las rutas de borrado, a propósito: hacerlo habría convertido un cambio de
 * retención en un cambio del ciclo de vida de la ejecución.
 *
 * ## Por qué no el SDK de AWS
 *
 * Mismo criterio que en AtlasBackend: de todo el árbol de dependencias sólo se necesitan tres
 * verbos firmados. SigV4 es público y estable; ver `s3-signature.util.ts`.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * `false` cuando falta configuración. No lanza: el motor tiene que poder correr sin almacén en
   * desarrollo y en las pruebas, y quien exige lo contrario lo dice con
   * `IDENTITY_IMAGE_RETENTION_REQUIRED=true`, que se comprueba al validar el entorno.
   */
  isConfigured(): boolean {
    return this.credentials() !== null;
  }

  private credentials(): S3Credentials | null {
    const endpoint = this.config.get<string>('STORAGE_S3_ENDPOINT');
    const bucket = this.config.get<string>('STORAGE_S3_BUCKET');
    const accessKeyId = this.config.get<string>('STORAGE_S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('STORAGE_S3_SECRET_ACCESS_KEY');
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

    return {
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: this.config.get<string>('STORAGE_S3_REGION') ?? 'us-east-1',
      forcePathStyle: this.config.get<boolean>('STORAGE_S3_FORCE_PATH_STYLE') ?? true,
    };
  }

  /**
   * Las mismas credenciales con el extremo PÚBLICO.
   *
   * Este proceso alcanza MinIO por el nombre de servicio de su red; el navegador del revisor, por
   * el dominio publicado. La firma se calcula sobre el mismo bucket y la misma clave, así que el
   * objeto es el mismo por los dos caminos. Sin este desdoblamiento, la URL que se le entrega al
   * portal es correcta y no la puede abrir nadie.
   */
  private publicCredentials(): S3Credentials | null {
    const base = this.credentials();
    if (!base) return null;
    const publicEndpoint = this.config.get<string>('STORAGE_S3_PUBLIC_ENDPOINT');
    return publicEndpoint ? { ...base, endpoint: publicEndpoint } : base;
  }

  private ttlSeconds(): number {
    return this.config.get<number>('STORAGE_URL_TTL_SECONDS') ?? 300;
  }

  /** Cada segmento al alfabeto seguro: una clave que se escribe con un nombre y se lee con otro es un archivo perdido. */
  private safeSegment(value: string): string {
    const cleaned = value.trim().replace(/[^A-Za-z0-9_-]/g, '_');
    return cleaned.length > 0 ? cleaned.slice(0, 64) : 'unknown';
  }

  /**
   * La clave la construye SIEMPRE el servidor: `prefijo/tenant/petición/tipo-uuid.ext`.
   *
   * El `requestId` en la ruta es lo que permite recuperar las tres imágenes de un caso sin
   * guardar un índice aparte, y el prefijo de tenant es lo que deja acotar la política del bucket.
   */
  buildIdentityKey(input: {
    tenantId: bigint | string;
    requestId: string;
    kind: 'document' | 'document-back' | 'selfie';
    extension: string;
  }): string {
    const prefix = (this.config.get<string>('STORAGE_IDENTITY_KEY_PREFIX') ?? 'identity')
      .trim()
      .replace(/^\/+|\/+$/g, '');
    return [
      ...(prefix ? [prefix] : []),
      this.safeSegment(String(input.tenantId)),
      this.safeSegment(input.requestId),
      `${input.kind}-${randomUUID()}.${this.safeSegment(input.extension)}`,
    ].join('/');
  }

  /**
   * La clave del extracto bancario: `prefijo/tenant/petición/<uuid>.<ext>`.
   *
   * Misma forma que la de identidad y con el mismo criterio —el servidor impone la ruta— pero con
   * su propio prefijo, para que las dos poblaciones puedan tener retenciones distintas.
   */
  buildStatementKey(input: { tenantId: bigint | string; requestId: string; extension: string }): string {
    const prefix = (this.config.get<string>('STORAGE_STATEMENT_KEY_PREFIX') ?? 'statements')
      .trim()
      .replace(/^\/+|\/+$/g, '');
    return [
      ...(prefix ? [prefix] : []),
      this.safeSegment(String(input.tenantId)),
      this.safeSegment(input.requestId),
      `${randomUUID()}.${this.safeSegment(input.extension)}`,
    ].join('/');
  }

  /**
   * Escribe un objeto. Devuelve `null` si no hay almacén configurado.
   *
   * `null` y no una excepción: quien llama decide si eso es aceptable. El worker de identidad lo
   * trata como aceptable en desarrollo y como fallo cuando la retención es obligatoria, y esa
   * decisión no pertenece a este servicio.
   *
   * Un rechazo del almacén SÍ es una excepción: es la diferencia entre «no hay almacén» y «hay
   * almacén y no me dejó escribir», y confundirlas fue exactamente lo que dejó al VPS entregando
   * claves de objetos que nunca existieron.
   */
  async put(objectKey: string, content: Buffer, contentType: string): Promise<StoredObject | null> {
    const credentials = this.credentials();
    if (!credentials) return null;

    const headers = { 'content-type': contentType, 'content-length': String(content.byteLength) };
    const url = presignS3Url({
      credentials,
      method: 'PUT',
      objectKey,
      expiresInSeconds: 60,
      signedHeaders: headers,
      now: new Date(),
    });

    const response = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(content) });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`El almacén rechazó la escritura de ${objectKey}: HTTP ${response.status}. ${detail}`);
    }

    return {
      objectKey,
      sizeBytes: content.byteLength,
      contentType,
      sha256Hex: createHash('sha256').update(content).digest('hex'),
    };
  }

  /** Lee un objeto. `null` si no hay almacén o si el objeto no está. */
  async get(objectKey: string): Promise<{ content: Buffer; contentType: string | null } | null> {
    const credentials = this.credentials();
    if (!credentials) return null;

    const url = presignS3Url({ credentials, method: 'GET', objectKey, expiresInSeconds: 60, now: new Date() });
    const response = await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`El almacén no pudo servir ${objectKey}: HTTP ${response.status}.`);

    return {
      content: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type'),
    };
  }

  /**
   * Borra un objeto. Best-effort a propósito: se usa para limpiar lo que quedó huérfano cuando una
   * subida se dedujo duplicada, y ahí un fallo de borrado no debe tumbar la petición del cliente —
   * el objeto sobrante cuesta unos kilobytes, la petición fallida cuesta un alta.
   */
  async remove(objectKey: string): Promise<void> {
    const credentials = this.credentials();
    if (!credentials) return;

    try {
      const url = presignS3Url({ credentials, method: 'DELETE', objectKey, expiresInSeconds: 60, now: new Date() });
      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) {
        this.logger.warn(`No se pudo borrar el objeto huérfano ${objectKey}: HTTP ${response.status}.`);
      }
    } catch (error) {
      this.logger.warn(`No se pudo borrar el objeto huérfano ${objectKey}: ${(error as Error).message}`);
    }
  }

  /**
   * URL de lectura firmada y con vencimiento, para entregar al navegador del revisor.
   *
   * Vence pronto y se emite en el momento: la cara de una persona no sale del almacén por una URL
   * que alguien pueda guardar o pegar en un chat.
   */
  createDownloadUrl(objectKey: string, now: Date = new Date()): { url: string; expiresAt: string } | null {
    const credentials = this.publicCredentials();
    if (!credentials) return null;

    const expiresInSeconds = this.ttlSeconds();
    return {
      url: presignS3Url({ credentials, method: 'GET', objectKey, expiresInSeconds, now }),
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    };
  }
}
