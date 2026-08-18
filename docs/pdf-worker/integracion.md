# Integrar el PDF Generator Worker

Tres decisiones, en este orden: **dónde corre**, **quién lo llama** y **qué adaptadores lleva**.

---

## 1. Dónde corre

### Dentro del motor (lo que hay hoy)

```ts
// src/app.module.ts
imports: [ …, PdfWorkerModule.register() ]
```

Publica `/pdf/*` en el mismo puerto que la API y expone `PDF_GENERATOR_PORT` para inyectarlo.
Ventaja: una llamada de función, sin serialización ni red. Coste: Chromium vive en el proceso
que atiende decisiones en línea.

Sin rutas HTTP, sólo el SDK:

```ts
PdfWorkerModule.register({ http: false })
```

### Como servicio aparte

```bash
docker build --target pdf-worker -t atlas-pdf-worker .
docker run -p 3100:3100 -e PDF_ORG_NAME="Mi Organización" atlas-pdf-worker
```

`src/pdf-worker.ts` monta **sólo** `PdfWorkerModule`: ni Prisma, ni Redis, ni el catálogo de
variables. Que ese arranque compile es la prueba de que el worker no depende del motor.

Cuándo separarlo: cuando la memoria de Chromium empiece a competir con el camino de decisión, o
cuando el volumen de documentos justifique escalarlos por separado. Chromium añade ~450 MiB a
la imagen y consume en ráfagas al rasterizar.

---

## 2. Quién lo llama

El consumidor depende de `PdfGeneratorPort`, **nunca** de una clase concreta. Las dos
implementaciones son intercambiables:

```ts
// mismo proceso
{ provide: PDF_GENERATOR_PORT, useExisting: LocalPdfGeneratorAdapter }

// servicio aparte — el consumidor NO cambia
{
  provide: PDF_GENERATOR_PORT,
  useFactory: (config: ConfigService) =>
    new HttpPdfGeneratorAdapter({
      baseUrl: config.getOrThrow('PDF_WORKER_URL'),
      timeoutMs: 60_000,
      headers: { 'x-api-key': config.getOrThrow('PDF_WORKER_API_KEY') },
    }),
  inject: [ConfigService],
}
```

Ejemplo completo de un algoritmo publicando su resultado:
[`src/pdf-worker/examples/algorithm-report.example.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/pdf-worker/examples/algorithm-report.example.ts).

### Dos costumbres que ahorran incidentes

**Fije la versión del template.** Sin `templateVersion`, el worker sirve la última publicada; el
día que salga una `2.0.0` con otro contrato, su algoritmo empezará a recibir 422 en producción
sin haber cambiado una línea.

**Derive `idempotencyKey` del hecho de negocio**, no de un aleatorio. `analysis:${correlationId}`
hace que un reintento no emita un segundo informe del mismo análisis.

---

## 3. Qué adaptadores lleva

Los que se entregan son reales y funcionan; tres de ellos tienen límites que hay que conocer
antes de un despliegue con varias réplicas.

### Idempotencia → Redis o Postgres

`InMemoryIdempotencyStoreAdapter` cubre el reenvío accidental y la carrera **dentro de una
réplica**. No cubre dos réplicas ni sobrevive a un reinicio.

```ts
class RedisIdempotencyStore implements IdempotencyStorePort {
  constructor(private readonly redis: Redis) {}

  async get(key: string) {
    const raw = await this.redis.get(`${key}:outcome`);
    return raw ? (JSON.parse(raw) as IdempotentOutcome) : undefined;
  }

  async put(key: string, outcome: IdempotentOutcome, ttlSeconds: number) {
    await this.redis.set(`${key}:outcome`, JSON.stringify(outcome), 'EX', ttlSeconds);
  }

  // `NX` es lo que hace atómica la reserva: sin él, dos réplicas la toman a la vez.
  async acquire(key: string, leaseSeconds: number) {
    return (await this.redis.set(`${key}:lease`, '1', 'EX', leaseSeconds, 'NX')) === 'OK';
  }

  async release(key: string) {
    await this.redis.del(`${key}:lease`);
  }
}
```

```ts
{ provide: IDEMPOTENCY_STORE_PORT, useClass: RedisIdempotencyStore }
```

### Cola → BullMQ

`InMemoryPdfQueueAdapter` es acotada y drena al apagar, pero un reinicio pierde lo pendiente.

```ts
class BullPdfQueue implements PdfJobQueuePort {
  readonly provider = 'bullmq';
  constructor(private readonly queue: Queue, private readonly connection: ConnectionOptions) {}

  async enqueue(command: GeneratePdfCommand) {
    // El búfer NO viaja por la cola: un PDF de dos megas por mensaje la revienta, y el
    // consumidor va a persistirlo de todos modos.
    const job = await this.queue.add('generate', {
      ...command,
      options: { ...command.options, returnContent: false, persist: true },
    });
    return { jobId: String(job.id), queuedAhead: await this.queue.getWaitingCount() };
  }

  consume(handler: (job: PdfJob) => Promise<void>) {
    new Worker(this.queue.name, async (job) => handler({
      jobId: String(job.id),
      command: job.data as GeneratePdfCommand,
      enqueuedAt: new Date(job.timestamp).toISOString(),
      attempts: job.attemptsMade,
    }), { connection: this.connection, concurrency: 2 });
  }
  // stats() y drain() completan el puerto.
}
```

`PdfQueueGateway` llama al **mismo** `GeneratePdfUseCase` que el controlador síncrono. No hay
una ruta «rápida» y otra «de fondo» que puedan desviarse.

### Almacenamiento → S3 / MinIO / R2

```ts
class S3DocumentStorage implements DocumentStoragePort {
  readonly provider = 's3';
  constructor(private readonly client: S3Client, private readonly bucket: string) {}

  async save(content: Buffer, metadata: StoredDocumentMetadata) {
    const key = `pdf/${metadata.templateId}/${metadata.documentId}.pdf`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content,
      ContentType: 'application/pdf',
      // El checksum ya está calculado; dejar que el almacén lo verifique es gratis.
      ChecksumSHA256: Buffer.from(metadata.checksum, 'hex').toString('base64'),
    }));
    return { provider: this.provider, key };
  }
  // load() y health() completan el puerto.
}
```

### Eventos → el bus del motor

`LoggingEventPublisherAdapter` deja el hecho en el registro estructurado. Para publicarlo de
verdad:

```ts
@Injectable()
class OutboxPdfEventPublisher implements EventPublisherPort {
  constructor(private readonly outbox: OutboxPublisherService) {}

  async publish(event: PdfEvent): Promise<void> {
    // NO relanza: el archivo ya existe y quien lo pidió ya lo tiene. Un bus caído no puede
    // convertir un documento correcto en un fallo.
    try {
      await this.outbox.enqueue({ type: event.event, payload: event });
    } catch (error) {
      this.logger.warn('No se pudo publicar el evento del documento', { error });
    }
  }
}
```

### Métricas → el `/metrics` del anfitrión

El worker tiene su propio `Registry` de `prom-client` (registrar en el global rompe al montar un
segundo contexto en pruebas). Para fundirlo con el del motor:

```ts
const merged = Registry.merge([engineMetrics.registry, pdfMetrics.registry]);
```

Series publicadas: `pdf_generation_total`, `pdf_generation_failed_total`,
`pdf_generation_duration_ms`, `pdf_generation_size_bytes`, `pdf_queue_wait_ms`,
`pdf_render_active`. Las etiquetas llevan `template` y `version`, **nunca** `documentId`: un
identificador único por etiqueta produce una serie nueva por cada PDF.

---

## 4. Qué vigilar en producción

| Señal | Qué significa | Qué hacer |
| --- | --- | --- |
| `pdf_generation_failed_total{error_code="PDF_RENDER_CAPACITY_EXCEEDED"}` sube | Los carriles están saturados | Subir `PDF_RENDER_CONCURRENCY` **y** la memoria del contenedor, o escalar réplicas |
| `pdf_generation_duration_ms` p99 cerca de `PDF_RENDER_TIMEOUT_MS` | Documentos al límite | Revisar qué template los produce; probablemente un payload sin cota efectiva |
| `error_code="TEMPLATE_PAYLOAD_INVALID"` concentrado en un consumidor | Su contrato se desvió | Ese consumidor no fijó `templateVersion`, o el template publicó una versión mayor |
| `/pdf/health` → `renderer.ok: false` | Chromium no arranca o se cayó | El proceso de Node sigue vivo y verde: sin esta sonda, la réplica parece sana y responde 502 a todo |
| `fonts.embedded: []` | Se depende de la tipografía del sistema | Aceptable dentro de la imagen; fuera de ella el documento no es reproducible |

## 5. Seguridad, en una línea cada una

- El payload es **no confiable**: lo valida el contrato del template antes de tocar nada.
- Handlebars escapa por defecto y el cargador **prohíbe** `{{{ }}}` en plantillas de documento.
- Sólo se pueden invocar los ayudantes del catálogo (`knownHelpersOnly`).
- La página **no tiene red**: toda petición se aborta salvo `data:`, `about:` y `blob:`.
- **JavaScript apagado** dentro de la página.
- Los recursos son `asset:<nombre>`; una URL se rechaza y un nombre con `/`, `\` o `..` también.
- El nombre de archivo se sanea siempre, incluido el que llega en la petición.
- La respuesta se comprueba: si no empieza por `%PDF-`, no sale.
- El consumidor **no puede** mandar HTML, CSS, plantillas ni rutas: no hay campo donde ponerlos.
