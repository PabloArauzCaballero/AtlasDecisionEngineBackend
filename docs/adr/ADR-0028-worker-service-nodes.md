# ADR-0028: Llamada a servicios de worker desde un nodo del grafo

## Estado

Aceptado — 2026-08-06

## Contexto

[ADR-0026](ADR-0026-additional-workers-integration.md) absorbió dos workers —análisis
semántico y extractos bancarios— como capacidades del producto, cada uno con su cola, su
tabla de ejecuciones y sus endpoints. Quedaron **aislados**: nada fuera de
`src/modules/workers` los usaba, y en particular el motor de decisión no podía consumirlos.

El requisito es que un algoritmo pueda usar lo que esos workers producen, configurándolo
**desde el nodo**, y que el resultado quede disponible como variables nuevas sobre las que
el motor razone.

## Fuerzas y restricciones

- El motor no puede depender del módulo de workers: `GraphModule` es el núcleo y
  `WorkersModule` está por encima. Un `import` en esa dirección crea un ciclo.
- Las variables intermedias (§2) ya son el mecanismo del motor para un valor que nace
  durante la ejecución, con tipo declarado, autorización de escritura por nodo, política de
  actualización y política de traza. Añadir un segundo mecanismo para «valores que vienen
  de fuera» duplicaría gobierno y dejaría un camino sin él.
- Los dos workers son asíncronos por diseño: se encolan y se reclaman. Una decisión, en
  cambio, responde en línea.
- Un extracto bancario es un documento financiero de una persona. No puede acabar
  persistido en la evidencia de cada ejecución.

## Opciones consideradas

### ¿Qué invoca el nodo?

| Opción                                                        | Por qué no                                                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Referenciar una ejecución del worker ya terminada por su `requestId` | No es una llamada, es una lectura: obliga a que alguien haya encolado el trabajo antes y a que el cliente sondee hasta que termine. El nodo deja de ser una acción del algoritmo |
| Encolar el trabajo desde el nodo y esperar a que la cola lo reclame | Añade la latencia de la cola a la decisión sin ninguna ventaja: el trabajo se necesita ahora y el proceso que decide puede hacerlo |
| **Invocar el NÚCLEO del worker en el proceso que decide**      | **Elegida**                                                                                                                                     |

El núcleo de los dos workers —el motor de extractos, el pipeline semántico— no sabe nada de
colas: es lo que ADR-0026 dejó explícitamente separado de la infraestructura. Llamarlo en
línea desde el motor y desde la cola es exactamente el uso que esa separación permite.

### ¿Dónde deja el nodo lo que recibe?

| Opción                                    | Por qué no                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Un espacio de nombres propio (`worker.*`) | Un valor sin tipo declarado, sin política de traza y sin nadie que autorice su escritura; gobierno paralelo |
| Escribir directamente el contrato de salida | Un servicio externo podría publicar al consumidor sin pasar por el contrato                              |
| **Variables intermedias declaradas (§2)** | **Elegida**                                                                                                |

## Decisión

### 1. Un tipo de nodo nuevo: `WORKER`

`nodeType` es `VarChar`, así que no hace falta migración. El nodo declara en su `config`
qué servicio y operación llama, cómo se alimenta cada argumento desde el contexto del
grafo, a qué variables intermedias proyecta la respuesta y qué hace si el servicio falla.

### 2. El invocador se pasa como argumento de llamada

`ExecutionEngineService.execute()` recibe un `WorkerServiceInvoker` opcional, igual que ya
recibía el `ArtifactReferenceResolver` de los árboles anidados y el `onStep` de la
ejecución en vivo. Lo implementa `WorkerServiceInvokerService` en `WorkersModule` y lo ata
al tenant y al principal de la petición con `bind()`. `GraphModule` no depende de
`WorkersModule`, y un nodo `WORKER` alcanzado sin invocador falla cerrado con
`WORKER_SERVICE_NOT_CONFIGURED`.

### 3. El catálogo de servicios se comprueba al validar

`WORKER_SERVICE_OPERATIONS` es un catálogo cerrado que el validador de grafo consulta. Un
nodo que nombra un servicio inexistente impide **aprobar el artefacto**; descubrirlo en
ejecución costaría una decisión abortada con el autor ya fuera. Un servicio apagado en el
despliegue se rechaza con la misma bandera que publica el catálogo `GET /v1/workers`: si la
interfaz dice que la capacidad no está, un algoritmo tampoco puede usarla por detrás.

### 4. Las rutas de proyección van sobre `{ result, call }`

`result.*` es la respuesta del servicio y `call.*` los metadatos de la llamada (`status`,
`errorCode`, `durationMs`, `warningCount`). Separarlos evita que un servicio con su propio
campo `status` tape el estado real de la llamada, que es de donde suele colgar la rama de
contingencia.

### 5. `onError: CONTINUE` exige valores por defecto

Un nodo puede declarar que la decisión continúa aunque el servicio falle. Cuando lo hace,
el validador exige `defaultValue` en **todas** sus proyecciones: continuar sin decir con
qué valores dejaría la primera lectura posterior reventando por un motivo que ya no
menciona al servicio. Además se emite el aviso `WORKER_CALL_CONTINUES_ON_ERROR`.

## Consecuencias

### Aceptadas

- **La decisión dura lo que dure la llamada.** Convertir un PDF o clasificar un texto es
  trabajo real dentro del camino crítico. Se acota con `timeoutMs` por nodo, recortado al
  máximo configurado del servicio y con un techo absoluto de 120 s, y se mide con
  `atlas_worker_node_call_duration_ms`.
- **Una decisión con nodos `WORKER` no es reproducible por sí sola.** Reejecutarla vuelve a
  llamar al servicio, cuya respuesta puede cambiar con otra versión del analizador o del
  modelo. La evidencia de lo decidido está en la ejecución persistida —entrada, traza paso a
  paso con la llamada registrada, salida y cadena de auditoría—, no en la posibilidad de
  repetirla. Es la misma propiedad que ya tenía cualquier variable resuelta contra un
  sistema externo.
- El documento de entrada viaja como variable marcada `sensitive`: el motor persiste su
  HMAC y no su contenido, y la traza de cada nodo lo publica como nulo.

### Rechazadas explícitamente

- No se crea una segunda tabla de ejecuciones para las llamadas desde un nodo. La evidencia
  vive en la traza de la decisión, que es donde se busca.
- No se toca el camino asíncrono existente. `POST /v1/workers/…` sigue encolando, con su
  reclamo atómico y sus reintentos, para las conversiones que nadie está esperando en línea.

## Referencias

- Detalle operativo: [Nodos que llaman a un servicio de worker](../workers/worker-service-nodes.md)
- Demo ejecutable: `EXTRACTO_CAPACIDAD_PAGO`
  (`src/modules/seeding/data/statement-worker-demo.graph.ts`)
