# ADR-0031 — Generador documental como worker desacoplado

- **Estado**: aceptado
- **Fecha**: 2026-02-11
- **Sustituye a**: nada
- **Contexto relacionado**: ADR-0028 (nodos de servicio de worker)

## Contexto

Varios artefactos del motor necesitan emitir documentos: el veredicto de una solicitud de
crédito, el resultado de un análisis, un certificado, una factura. Sin una pieza común, cada uno
acaba construyendo su propio HTML y llamando a su propio navegador. El resultado previsible es
el que se ve en cualquier base con varios años: tres membretes ligeramente distintos, dos
formatos de fecha, un informe con «[object Object]» en una celda y nadie que se atreva a cambiar
el diseño porque no sabe cuántos sitios lo repiten.

El problema no es «generar un PDF». Es que la maquetación, la identidad institucional y las
reglas de impresión dejen de ser responsabilidad de quien produce los datos.

## Decisión

Se construye `src/pdf-worker/`: una plataforma documental con arquitectura hexagonal donde el
consumidor entrega `templateId + payload` y el worker se encarga de validar, componer, aplicar la
marca, imprimir, opcionalmente almacenar y publicar el hecho.

### Lo que se fija

1. **Contrato tipado por template.** Cada documento declara su esquema; un payload que no lo
   cumple se rechaza con campo, problema, regla esperada y valor recibido —recortado— **antes**
   de levantar ningún navegador. El dominio no importa el validador: declara `PayloadSchema<T>`,
   una interfaz de tres métodos, y el adaptador de Zod la satisface.
2. **Versiones inmutables**, una carpeta por versión. Registrar dos veces `id@version` falla.
   Un informe archivado declara con qué template salió, y esa declaración sólo vale si esa
   versión no ha cambiado.
3. **Puertos para todo lo externo**: motor de impresión, motor de plantillas, almacenamiento,
   recursos, fuentes, cola, eventos, idempotencia, métricas, reloj. Playwright lo importan dos
   archivos; Handlebars, dos. Lo verifica una prueba que lee los imports.
4. **La petición sólo mueve una lista corta y publicada** (`persist`, `filename`,
   `classification`, `returnContent`, `page.format`, `page.orientation`). Todo lo demás es
   protegido y un intento se **rechaza**, no se ignora.
5. **Despliegue separable.** El worker no importa nada de `common/` ni de `modules/`. La única
   dependencia es la línea de `app.module.ts` que lo monta.

### Lo que se descartó

- **Una biblioteca de PDF por código** (PDFKit, pdf-lib). Maquetar tablas que paginan, cabeceras
  que se repiten y bloques que no se parten es exactamente lo que un motor de impresión de
  navegador ya sabe hacer; reimplementarlo son meses y el resultado no es mejor.
- **Un servicio externo de conversión.** Los payloads llevan datos personales y el documento es
  el registro de una decisión; sacarlos de la red del motor exige un análisis de tratamiento que
  el valor no justifica. El puerto queda para poder hacerlo si algún día compensa.
- **Plantillas en base de datos, editables en caliente.** Convertiría la maquetación en entrada
  del sistema, con todo lo que eso arrastra: inyección de plantilla, versionado en filas y un
  documento que nadie puede reproducir desde el código.

## Consecuencias

### Positivas

- Añadir un documento es una carpeta y una línea en el catálogo. El motor central no cambia.
- El aspecto de todos los documentos se cambia en un sitio.
- Otro artefacto puede **preguntar** qué datos necesita un documento
  (`GET /pdf/templates/:id/schema`) en vez de copiarlo de una conversación.
- La superficie de ataque está acotada y probada: sin red durante el render, sin JavaScript en la
  página, escapado obligatorio, recursos por catálogo, nombres de archivo saneados.

### Negativas y su mitigación

| Coste | Mitigación |
| --- | --- |
| Chromium añade ~450 MiB a la imagen y consume memoria en ráfagas | Etapa `pdf-worker` en el Dockerfile, separada de la de la API |
| Un navegador vivo es estado en un proceso que debería ser sin estado | `BrowserPool` lo relanza si muere y lo cierra en el apagado; `/pdf/health` lo sondea |
| La idempotencia y la cola que se entregan viven en memoria | Están detrás de sus puertos y sus límites están escritos en `docs/pdf-worker/README.md`; cambiarlas es una clase |
| Sin fuente embebida, el documento depende de la del sistema | La imagen instala Liberation y DejaVu; `/pdf/health` publica `fontsEmbedded: []` en vez de suponerlo |

## Verificación

- 72 pruebas unitarias y de integración (incluida una contra Chromium real) y 13 e2e sobre HTTP.
- `test/pdf-architecture.spec.ts` fija las reglas de dependencia leyendo los imports.
- `yarn pdf:evidencia` produce los PDF y las capturas del visor con el archivo abierto.
  **Fue esa evidencia, y no una prueba, la que detectó que un `@page { margin: 0 }` hacía que el
  membrete y el pie se pintaran encima del texto**: el HTML era correcto y el PDF tenía su firma,
  su tamaño y sus páginas. Queda registrado porque es la clase de defecto que ninguna aserción
  sobre bytes puede ver.

## Autenticación (añadido tras la auditoría del 13/08/2026)

Este ADR no decía nada sobre autenticación, y esa omisión no era neutral: se materializó en el
código como «ninguna».

Auditando el contenedor en marcha se midió esto:

```
GET  :3000/pdf/templates  → 200 sólo con credencial (401 sin ella)
GET  :3100/pdf/templates  → 200 SIN credencial, con el catálogo entero
POST :3100/pdf/generate   → 422, no 401 — o sea, un cuerpo vacío llegó al validador
```

El mismo `PdfWorkerModule` tenía **dos posturas de seguridad opuestas según cómo se arrancara**.
Dentro del motor lo cubría el `APP_GUARD` del anfitrión; suelto no lo cubría nada, porque
`src/pdf-worker.ts` monta el módulo y ninguno de sus controladores lleva `@UseGuards`. El único
guardia del árbol, `TemplateAdminGuard`, sólo protege `/pdf/admin/*`.

Agravado por tres cosas del mismo arranque: el puerto se publicaba en `0.0.0.0` (el resto del
stack se ata a `127.0.0.1`), faltaban `helmet` y `enableCors` —presentes en `main.ts`—, y Swagger
estaba encendido por omisión en el código, apagado sólo porque el compose fijaba la variable.

### Decisión

1. **`ServiceAuthGuard` como `APP_GUARD`, únicamente en modo suelto**
   (`PdfWorkerModule.register({ standalone: true })`). Global y no colgado de cada controlador:
   así uno nuevo nace protegido en vez de nacer abierto y esperar a que alguien recuerde el
   decorador, que es exactamente cómo se llegó aquí.
2. **Encendido por omisión**, al revés que la administración de templates. Aquélla es una
   capacidad que la mayoría de despliegues no usa; ésta es el suelo.
3. **Sin clave, el arranque aborta.** No degrada a modo abierto: un servicio que se abre solo
   cuando le falta la clave es un servicio sin autenticación con pasos extra.
4. **La exigencia NO vive en el esquema de entorno** sino en `assertServiceAuthConfigured()`.
   `loadPdfWorkerEnv()` también corre cuando el módulo va dentro del motor, donde no hay clave
   porque autentica el anfitrión; exigirla allí habría impedido arrancar el motor entero por una
   credencial que nunca iba a usar. Un endurecimiento que rompe el caso bueno no es
   endurecimiento.
5. **`GET /pdf/health` queda fuera de la puerta**, por ruta completa y no por prefijo: es la
   sonda del contenedor —el `HEALTHCHECK` la llama sin cabeceras— y publica estado de vida, no
   datos. Con `startsWith`, un futuro `/pdf/healthcheck-dump` entraría solo por parecerse.

### Lo que esta decisión NO resuelve

Cuando el portal desvía `pdf/generate` y `pdf/preview` al worker (`PDF_WORKER_URL`), esas dos
operaciones **no pasan por el interceptor de auditoría de acceso del motor**. Un documento
generado por esa vía no deja la traza que sí deja el resto. Queda anotado como deuda: la
alternativa —que el motor haga de intermediario— reintroduce el acoplamiento que este ADR
existe para evitar, así que la salida probable es que el worker emita su propio evento de
auditoría.

### Verificación

`test/pdf-service-auth.spec.ts` fija las cuatro afirmaciones: sin clave se rechaza, con la clave
correcta se pasa, la sonda sigue abierta, y declararse suelto sin clave aborta el arranque.
