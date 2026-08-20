# PDF Generator Worker

Plataforma documental interna. Cualquier artefacto del ecosistema entrega **datos
estructurados** y recibe un PDF maquetado, con la identidad institucional aplicada, validado
contra un contrato versionado y reproducible.

El consumidor no construye HTML, no elige estilos, no conoce Playwright, no coloca logotipos,
no sabe qué es un margen y no valida el documento a ojo. Manda esto:

```json
{
  "templateId": "credit-analysis-report",
  "templateVersion": "1.1.0",
  "payload": { "customerName": "Juan Pérez Añez", "score": 782, "decision": "REVIEW" }
}
```

Evidencia real de lo que produce: [`evidencia/`](./evidencia/README.md).

---

## Cómo se usa

### Desde otro módulo del motor (mismo proceso)

```ts
constructor(@Inject(PDF_GENERATOR_PORT) private readonly pdf: PdfGeneratorPort) {}

const result = await this.pdf.generate({
  templateId: 'generic-result-report',
  templateVersion: '1.0.0',
  payload: { title: 'Resultado del análisis', sections: [...] },
  metadata: { correlationId, idempotencyKey: `analysis:${correlationId}` },
});
// result.content  → Buffer
// result.checksum → SHA-256 del archivo
```

Ejemplo completo y compilado: [`src/pdf-worker/examples/algorithm-report.example.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/pdf-worker/examples/algorithm-report.example.ts).

### Por HTTP

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `POST` | `/pdf/generate` | Genera. Con `Accept: application/pdf` devuelve el archivo; si no, la ficha en JSON. |
| `POST` | `/pdf/generate/async` | Encola (202). Requiere `PDF_QUEUE_ENABLED=true`. |
| `POST` | `/pdf/preview` | Previsualiza con el fixture del template. |
| `GET` | `/pdf/templates` | Catálogo, última versión de cada uno. |
| `GET` | `/pdf/templates/:id` | Definición completa (geometría efectiva, recursos, obsolescencia). |
| `GET` | `/pdf/templates/:id/schema` | **Qué datos hay que mandar**: `fields`, `jsonSchema`, `example`. |
| `GET` | `/pdf/templates/:id/versions` | Versiones publicadas. |
| `POST` | `/pdf/templates/:id/validate` | Comprueba un payload sin generar nada. |
| `GET` | `/pdf/health` | Motor, catálogo, recursos, fuentes, almacenamiento. |
| `GET` | `/pdf/errors` | **Catálogo completo de errores**: código, estado, causa, remedio, si conviene reintentar. |
| `GET` | `/pdf/template-format/example` | **Descarga un paquete de template de ejemplo**, funcional y completo. |
| `GET` | `/pdf/template-format/schema` | JSON Schema del formato que se admite al publicar. |
| `GET` | `/pdf/admin/templates` | Inventario con origen y estado. 🔒 |
| `POST` | `/pdf/admin/templates` | Publica un template nuevo. 🔒 |
| `GET` | `/pdf/admin/templates/:id/:version/source` | Descarga su paquete para editarlo. 🔒 |
| `POST` | `/pdf/admin/templates/:id/:version/deprecate` | Lo marca obsoleto sin retirarlo. 🔒 |
| `DELETE` | `/pdf/admin/templates/:id/:version` | Borrado real. 🔒 |

🔒 = exige `PDF_TEMPLATE_ADMIN_ENABLED=true` y la clave en `x-pdf-admin-key`.

OpenAPI: `http://localhost:3100/docs` y `openapi.json` con el proceso suelto.

### En local

```bash
yarn pdf:preview                                # lista los templates
yarn pdf:preview generic-result-report          # genera ./tmp/pdf-preview/…pdf
yarn pdf:preview credit-analysis-report 1.0.0 --out=./tmp/credito.pdf
yarn pdf:evidencia                              # PDFs + capturas del visor
yarn pdf:visual:baseline                        # compara huellas visuales
```

---

## Arquitectura

```
Algoritmo ──► PdfGeneratorPort ──► GeneratePdfUseCase
                                        │
                                        ├─► TemplateRepositoryPort   ¿qué template?
                                        ├─► PayloadSchema<T>          ¿el payload cumple?
                                        ├─► IdempotencyStorePort      ¿ya se hizo?
                                        ├─► TemplateEnginePort        HTML
                                        ├─► PdfRendererPort           bytes
                                        ├─► DocumentStoragePort       (opcional)
                                        └─► EventPublisherPort        PDF_GENERATED
```

```
src/pdf-worker/
├── domain/           entidades, value objects, enums, errores, contratos — CERO dependencias
├── application/      puertos, DTOs, casos de uso, composición y precedencia
├── infrastructure/   adaptadores: Playwright, Handlebars, disco, prom-client, Zod
├── presentation/     controladores HTTP, filtro de excepciones, sonda, consumidor de cola
├── templates/        layout base, parciales y estilos compartidos + documentos por versión
├── sdk/              PdfGeneratorPort + adaptadores local y HTTP
└── pdf-worker.module.ts
```

**El dominio y la aplicación no importan Playwright, Handlebars, Zod, `prom-client` ni el
sistema de archivos.** Es comprobable: `test/pdf-architecture.spec.ts` lo verifica leyendo los
imports, para que la regla no dependa de que alguien se acuerde.

`src/pdf-worker/` **no importa nada de `src/common/` ni de `src/modules/`**. La única
dependencia entre el motor y el worker es la línea de `app.module.ts` que lo monta; sacarlo a
su propio despliegue es borrarla (`src/pdf-worker.ts` ya lo arranca solo).

---

## Añadir un template nuevo

Sin tocar el motor central. Cuatro archivos y una línea:

```
src/pdf-worker/templates/documents/factura/1.0.0/
├── schema.ts            contrato Zod: qué campos, de qué tipo, con qué límites
├── template.hbs         SÓLO el contenido; el armazón lo pone el layout base
├── styles.css           sólo tokens, ningún color literal
├── preview.fixture.ts   datos ficticios VÁLIDOS que ejerciten lo que suele romperse
└── template.config.ts   la declaración
```

```ts
// template.config.ts
export const FacturaTemplate = defineTemplate({
  id: 'factura',
  version: '1.0.0',
  title: 'Factura',
  description: '…',
  sourceDir: __dirname,
  schema: zodSchema(FacturaSchema),
  fixture: facturaFixture,
  classification: 'CONFIDENTIAL',
  page: { format: 'Letter' },
});
```

```ts
// templates/template-catalog.ts  ← la única línea que se añade
export const TEMPLATE_CATALOG = [ …, FacturaTemplate as TemplateContract ];
```

Reglas que aplica el cargador y que fallan **al arrancar**, no en producción:

- Ningún `{{{ }}}` ni `{{& }}`: por ahí un payload se convertiría en marcado.
- Ningún parcial de nombre dinámico: el payload no elige qué plantilla se ejecuta.
- Sólo los ayudantes del catálogo (`knownHelpersOnly`); una errata es un error de compilación.
- La carpeta debe estar dentro de la raíz de plantillas.

**Publicar una versión nueva es una carpeta nueva** (`factura/1.1.0/`). Registrar dos veces la
misma pareja `id@version` falla: un informe archivado declara con qué template salió, y esa
declaración sólo vale si esa versión es inmutable. Las versiones viejas se conservan.

---

## Publicar un template por API (el «CRUD»)

Además de los incorporados, un operador puede publicar templates sin desplegar código. El
recorrido completo son cuatro llamadas:

```bash
# 1. Descargue el formato. Es un paquete funcional: se puede subir tal cual.
curl -s http://localhost:3100/pdf/template-format/example -o mi-template.json

# 2. Edítelo: cambie manifest.id, los campos y la plantilla.

# 3. Publíquelo.
curl -X POST http://localhost:3100/pdf/admin/templates \
  -H "x-pdf-admin-key: $PDF_TEMPLATE_ADMIN_KEY" \
  -H "x-requested-by: operador@atlas" \
  -H 'content-type: application/json' --data-binary @mi-template.json

# 4. Úselo como cualquier otro.
curl -X POST http://localhost:3100/pdf/generate -H 'accept: application/pdf' \
  -H 'content-type: application/json' \
  -d '{"templateId":"mi-template","payload":{ … }}' -o informe.pdf
```

### El paquete

Un único JSON —no un `.zip`— para poder versionarlo, revisarlo y diferenciarlo línea a línea:

```
manifest   id, version, title, description, tags, classification, page, footer
fields     contrato de datos, en vocabulario declarativo
template   cuerpo Handlebars (SÓLO el contenido; el armazón lo pone el layout)
styles     CSS propio, opcional
sample     datos de ejemplo VÁLIDOS, obligatorios
```

**El contrato viaja como datos, nunca como código.** Un template incorporado declara su
esquema con Zod —TypeScript revisado y desplegado—; uno subido no puede, porque aceptar código
de una petición es aceptar ejecución arbitraria por muy administrativa que sea la ruta. Por eso
`fields` es un vocabulario cerrado —`string`, `number`, `integer`, `boolean`, `enum`, `date`,
`array`, `object`— que el worker compila a Zod al registrarlo. La expresividad que se pierde es
exactamente la que no se puede auditar.

Se rechaza al publicar, no al renderizar: interpolación sin escapar, parciales dinámicos,
ayudantes fuera del catálogo, `@import` o `url(https://…)` en el CSS, y datos de ejemplo que no
cumplan su propio contrato. Los problemas se devuelven **todos juntos**.

### Por qué no es un CRUD literal

| Operación | Qué hace |
| --- | --- |
| Crear | `POST` da de alta una pareja `id@version` nueva. |
| Leer | `…/source` devuelve el paquete, listo para editar y volver a subir. |
| Actualizar | Publicar **otra versión**. Editar una publicada responde 409 con la siguiente sugerida. |
| Borrar | `deprecate` es lo normal: deja de recomendarse pero **sigue generando**. `DELETE` borra de verdad y existe para deshacer una publicación equivocada. |

Una versión publicada es inmutable porque un informe archivado declara con cuál salió. Si
pudiera editarse, esa declaración dejaría de significar nada. Los templates **incorporados** no
se tocan por la API (403): se versionan con el código.

## Catálogo de errores

`GET /pdf/errors` devuelve **todos** los códigos que el worker puede producir, cada uno con su
estado HTTP, qué significa, por qué ocurre, cómo se resuelve, si reintentar sirve de algo y
quién puede arreglarlo (`consumidor` u `operador`).

No es documentación aparte: es un dato del programa, y `test/pdf-error-catalog.spec.ts`
comprueba que todo código tenga entrada, que toda entrada corresponda a un código, que exista
una clase de error por código y que el estado HTTP publicado sea el que la clase devuelve. Sin
esas pruebas, un error nuevo llega al cliente sin explicación y una entrada vieja sigue
prometiendo un comportamiento que ya no existe.

## Añadir un motor de impresión

1. Implemente `PdfRendererPort` (`render`, `health`, `shutdown`) en
   `infrastructure/rendering/<proveedor>/`.
2. Añada el valor al enum `PDF_RENDERER` de `infrastructure/config/pdf-worker.env.ts`.
3. Añada la rama en `createRenderer()` de `infrastructure/config/pdf-worker.providers.ts`.

Ningún caso de uso cambia. El puerto ya modela lo que un motor necesita: HTML autocontenido,
geometría, plantillas de cabecera y pie por separado —porque «Página X de Y» sólo lo puede
resolver quien ya paginó— y un plazo.

## Añadir un almacenamiento

1. Implemente `DocumentStoragePort` (`save`, `load`, `health`) en `infrastructure/storage/`.
2. Añada el valor a `PDF_STORAGE_PROVIDER` y la rama en `createStorage()`.

S3, MinIO, R2, GCS y Azure Blob encajan sin tocar nada más. `save` recibe el búfer y los
metadatos; devuelve `{ provider, key, url? }`.

---

## Decisiones arquitectónicas

| # | Decisión | Por qué |
| --- | --- | --- |
| 1 | **Contrato tipado por template, no `Record<string, any>`** | Un PDF con «undefined» impreso lo detecta una persona abriendo el archivo; un payload rechazado lo detecta el llamante en el mismo segundo. El rechazo lleva campo, problema, regla y valor recibido —recortado—. |
| 2 | **El dominio no importa Zod** | Declara `PayloadSchema<T>`, tres métodos; el adaptador lo satisface. Es lo que hace cierto «Zod o una solución equivalente» en vez de una intención. |
| 3 | **Versiones inmutables, carpeta por versión** | Sobrescribir `1.0.0` haría que un informe de hace un año dijese que se produjo con un template que ya nadie puede reconstruir. |
| 4 | **Cabecera y pie fuera del flujo del documento** | `Página X de Y` sólo se conoce tras paginar. En el cuerpo, la cabecera sale una vez y el resto del informe queda sin identificar. |
| 5 | **`@page { margin }` NO se declara en CSS** | En Chromium el margen del CSS gana sobre el de la API. Con `margin: 0` el cuerpo ocupaba la hoja entera y el membrete se pintaba encima del título. Lo detectó la evidencia visual, no una prueba. |
| 6 | **Sin red durante el render** | Toda petición de la página se aborta salvo `data:`/`about:`/`blob:`. Un `<img src="https://…">` copiado de un correo convertiría el worker en un cliente que visita lo que le digan desde dentro de la red del motor. |
| 7 | **JavaScript apagado en la página** | Ninguna plantilla lo necesita. Sin él, ningún payload puede ejecutar nada aunque atravesara el escapado. Configurable para gráficos en cliente. |
| 8 | **Recursos como `asset:<nombre>`, nunca URL** | Cierra el SSRF y hace el render reproducible sin conexión. |
| 9 | **Un navegador vivo, un contexto por documento** | Arrancar Chromium por PDF más que duplica la latencia; compartir el contexto dejaría que el estado cruzase entre documentos de organizaciones distintas. |
| 10 | **429 y no 503 al agotar los carriles** | El servicio está sano, falta capacidad instantánea. Esa diferencia decide si el cliente reintenta o si el orquestador saca la réplica de rotación. |
| 11 | **La petición sólo mueve una lista corta y publicada** | Si un consumidor pudiera fijar la tipografía o los márgenes, el generador no podría volver a cambiar el diseño sin romperle el informe a alguien. Un intento se **rechaza**, no se ignora. |
| 12 | **La clasificación se puede subir, nunca bajar** | Si una petición pudiera rebajar `CONFIDENTIAL` a `PUBLIC`, el rótulo sería una preferencia del llamante y no significaría nada. |
| 13 | **La clave de idempotencia incluye la huella del payload** | Un cliente que reutiliza «pedido-4821» para dos documentos distintos recibiría el primero disfrazado de segundo: un fallo silencioso, tardío e imposible de diagnosticar desde su lado. |
| 14 | **Se comprueba que la salida empieza por `%PDF-`** | Un motor puede devolver bytes sin producir un PDF —una página de error—, y esos bytes tienen tamaño y checksum como cualquier archivo. |
| 15 | **Registro de métricas propio, no el global de `prom-client`** | El worker vive dentro de un backend que ya tiene el suyo; registrar en el global rompe al montar un segundo contexto en pruebas. |
| 16 | **Su propio esquema de entorno, leído de `process.env`** | `envSchema` del motor es un `z.object` y **descarta** las claves que no declara: todas las `PDF_*` desaparecerían del `ConfigService` sin que nada lo dijera. |
| 17 | **Imagen Docker separada de la API** | Chromium pesa ~450 MiB y consume memoria en ráfagas; mezclarlo con el proceso que atiende decisiones en línea hace que un informe de 200 páginas compita con el camino sensible a la latencia. |

---

## Límites conocidos

Escritos aquí porque un componente que promete de más es peor que uno que dice lo que no hace.

- **Idempotencia en memoria.** Cubre el reenvío accidental y la carrera dentro de una réplica.
  No cubre dos réplicas ni sobrevive a un reinicio. Con varias réplicas hay que sustituir
  `IdempotencyStorePort` por una implementación sobre Redis o Postgres.
- **Cola en memoria.** Acotada, con contrapresión y drenaje ordenado, pero un reinicio pierde lo
  pendiente. Es el puerto lo que está listo para BullMQ, no la durabilidad.
- **Sin fuentes embebidas.** El repositorio no incluye ninguna a propósito (licencias). Dentro de
  la imagen Docker el resultado es idéntico en desarrollo, CI y producción gracias a Liberation
  y DejaVu; fuera de ella depende del sistema. `/pdf/health` lo publica en vez de suponerlo.
  Ver [`templates/shared/fonts/README.md`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/pdf-worker/templates/shared/fonts/README.md).
- **La huella visual cubre el HTML compuesto, no el rasterizado.** Detecta cambios accidentales
  en plantillas, parciales, estilos, tokens, membrete y pie. No detecta que otra versión de
  Chromium pagine distinto; para eso están las capturas de `yarn pdf:evidencia`, que mira una
  persona.
- **El PDF no es comparable byte a byte.** Chromium le pone una `/CreationDate` que cambia en
  cada ejecución; por eso la referencia se toma sobre el HTML con el reloj congelado.
- **La imagen es grande: 4,39 GB** (base `mcr.microsoft.com/playwright:v1.61.1-noble`, 3,45 GB).
  Es el precio de no depender de `cdn.playwright.dev` al construir y de que la etiqueta clave la
  pareja navegador/biblioteca. Se llegó ahí por las malas: descargar el navegador durante la
  construcción falló seis veces seguidas —cinco reintentos con retroceso incluidos— mientras
  `apt` y npm iban perfectos. La base trae Firefox y WebKit, que este worker no abre nunca;
  **borrarlos no adelgaza la imagen** porque están en la capa base. Quien necesite una imagen
  pequeña (~700 MB) tiene que volver a `node:slim` + descarga y aceptar la dependencia del CDN.
  **Al subir `playwright` en `package.json` hay que subir la etiqueta de la base a la vez**: una
  comprobación del `Dockerfile` resuelve la ruta del ejecutable con el propio `playwright` y
  falla al construir si se desincronizan.

---

## Configuración

Todas las variables, con su motivo, en [`.env.example`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/.env.example) (sección
`PDF Generator Worker`). Un despliegue mínimo sólo necesita `PDF_ORG_NAME`.

## Pruebas

```bash
yarn test  --testPathPattern pdf-                       # unitarias, sin navegador
yarn test  --testPathPattern pdf-renderer.integration   # Playwright real
yarn test:e2e --testPathPattern pdf-worker              # HTTP de punta a punta
```

Las unitarias montan el módulo **real** —Handlebars real, plantillas reales, precedencia real—
y sustituyen únicamente el motor de impresión. Con dobles de todo pasarían aunque el layout
hubiera dejado de incluir el pie.
