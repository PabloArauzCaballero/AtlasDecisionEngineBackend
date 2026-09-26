# Triage de extractos y cola de revisión humana

El worker de extractos tenía **un solo desenlace** para todo lo que no terminaba en
movimientos: `FAILED`. Con esa forma, el día que se quiso derivar los casos ambiguos a una
persona no había dónde separar el contrato que nadie debió subir del extracto con el
encabezado ilegible — los dos caían en la misma cola.

Una cola de revisión con facturas dentro no se revisa. Cuesta dinero, esconde los casos que
sí importan, y hace imposible medir si el motor mejora: la cola crece igual acierte o falle.

Este documento describe la separación que corrige eso.

## La regla

```text
PDF cargado
      ↓
¿Es un PDF admisible?            no → rechazo inmediato, sin fila
      ↓ sí
¿Hay evidencia de que sea un extracto?
      ↓
  claramente sí  → PROCESAR
  duda razonable → PENDING_REVIEW  (cola humana, con categoría)
  claramente no  → PDF_INVALID     (rechazo, historial, FUERA de la cola)
```

> **La revisión humana se reserva para casos verdaderamente ambiguos, no para documentos
> obviamente incorrectos.**

## Las dos confianzas, que no son la misma pregunta

| Campo                      | Qué mide                                               | Qué decide                                 |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| `document_type_confidence` | Qué tan seguro es que el documento **sea** un extracto | Procesar · preguntar · rechazar            |
| `confidence`               | Qué tan bien se **leyeron** los movimientos            | Entregar · entregar con avisos · preguntar |

Colapsarlas hacía que «99 % de que es un extracto, 60 % de algunos movimientos» —que es
revisión de extracción— y «2 % de que sea un extracto» —que es un rechazo— se leyeran igual.

## Los tres umbrales, configurables

Viven en el entorno del motor y no en un componente del portal: una regla de negocio escrita
en el frontend no gobierna a quien llama la API sin pasar por él.

| Variable                                      | Por defecto | Qué separa                                      |
| --------------------------------------------- | ----------- | ----------------------------------------------- |
| `BANK_STATEMENT_DOCUMENT_ACCEPT_CONFIDENCE`   | `0.55`      | Procesar de preguntar                           |
| `BANK_STATEMENT_DOCUMENT_REVIEW_CONFIDENCE`   | `0.30`      | Preguntar de rechazar                           |
| `BANK_STATEMENT_REVIEW_EXTRACTION_CONFIDENCE` | `0.50`      | Entregar de preguntar                           |
| `BANK_STATEMENT_QUEUE_WAIT_BUDGET_MS`         | `180000`    | Cuánto puede esperar en cola antes de derivarse |

`normalizeThresholds` ordena el par de clasificación: un `accept` por debajo del `review`
dejaría la franja de duda vacía y todo documento dudoso se rechazaría **en silencio**.

## Estado y motivo son dos columnas

El estado dice **dónde** está el caso; el motivo dice **qué** hay que resolver. Con un solo
campo habría que inventar un estado por causa, y migrar el enum del ciclo de vida entero cada
vez que aparece una causa nueva.

- `status = PENDING_REVIEW` + `review_reason` ∈ `TIMEOUT`, `LOW_CONFIDENCE`,
  `DOUBTFUL_DOCUMENT`, `UNKNOWN_BANK`, `PARTIAL_EXTRACTION`, `AMBIGUOUS_DATA`, `OCR_ERROR`,
  `MANUAL_REQUEST`.
- `status = PDF_INVALID` + `rejection_reason` ∈ `NOT_BANK_STATEMENT`, `UNSUPPORTED_FILE`,
  `EMPTY_DOCUMENT`, `CORRUPTED_PDF`, `UNREADABLE_DOCUMENT`.

Dos restricciones CHECK en la base sostienen la invariante, porque hay dos caminos que
escriben aquí —el worker y las acciones de revisión— y sólo uno es el sospechoso habitual.

El mapa completo de código de error a desenlace vive en un solo archivo,
[`statement-outcome.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/modules/workers/bank-statement/statement-outcome.ts): es
una regla de negocio, no un detalle de ejecución, y repartida en `catch` no había forma de
responder «¿por qué acabó esto en la cola?» sin leer el worker entero.

## Qué se rechaza y qué se pregunta

| Situación                        | Desenlace                                               | Por qué                                                                                                                           |
| -------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Factura, contrato, carta, foto   | `PDF_INVALID` · `NOT_BANK_STATEMENT`                    | Hay evidencia suficiente. Preguntar es trabajo para nadie.                                                                        |
| PDF dañado o con contraseña      | `PDF_INVALID` · `CORRUPTED_PDF` / `UNREADABLE_DOCUMENT` | Una persona tampoco puede abrirlo; el trabajo que mueve el caso —conseguir la versión legible— sólo puede hacerlo quien lo subió. |
| Escaneo sin capa de texto        | `PENDING_REVIEW` · `OCR_ERROR`                          | Probablemente sí es un extracto: hay imagen que una persona lee de un vistazo.                                                    |
| Entidad o formato sin analizador | `PENDING_REVIEW` · `UNKNOWN_BANK`                       | Es un extracto. Además dice qué formato falta soportar.                                                                           |
| Saldos o totales que no cuadran  | `PENDING_REVIEW` · `AMBIGUOUS_DATA`                     | Hay dato y CONTRADICE al documento, que es peor que no tenerlo: se publicaría como cierto.                                        |
| Vencimiento de plazo             | `PENDING_REVIEW` · `TIMEOUT`                            | El documento es válido; lo que se agotó es la paciencia razonable de quien espera.                                                |
| Extracto correcto pero antiguo   | `PDF_INVALID` · `STALE_PERIOD`                          | El documento es bueno y describe un momento que ya pasó. Sólo lo arregla quien lo subió, volviendo a descargarlo.                 |
| Fechas posteriores a hoy         | `PENDING_REVIEW` · `AMBIGUOUS_DATA`                     | La causa más probable no es el fraude sino un día y un mes leídos al revés: es un defecto nuestro, no una acusación al cliente.   |

## La vigencia: hasta cuándo sirve un extracto

`core/engine/recency/recency-gate.ts`. Es la cuarta compuerta y la única que mide el
**tiempo**: se compara el último día de la ventana observada —`coverage.to`, la que
reconcilia la carátula con los movimientos— contra hoy.

- **Se mide el final de la ventana, no el principio.** Que el extracto empiece hace ocho
  meses no lo empeora; que termine hace ocho meses lo invalida entero. Medir el inicio
  castigaría justo al documento más informativo.
- **Tres días de tolerancia, en los dos sentidos.** «Hasta hoy» no existe en ningún banco:
  el extracto cierra en el último movimiento, y un fin de semana sin movimientos lo deja tres
  días atrás sin que el documento tenga nada de malo. Bajarla a cero rechazaría a quien
  descarga su extracto un lunes por la mañana. Hacia adelante la tolerancia es simétrica
  porque la misma zona horaria que explica un desfase explica el otro.
- **El reloj es inyectable** (`RecencyGateOptions.now`). Sin eso la compuerta no se puede
  probar —la prueba que hoy demuestra la vigencia mañana demostraría la caducidad— y no se
  puede reevaluar una cola atrasada contra la fecha en que cada documento se recibió.
- **Los escenarios del laboratorio están fechados en el primer trimestre de 2026.** Con
  `BANK_STATEMENT_RECENCY_ENFORCE=true` se rechazan todos por vencidos: son deterministas a
  propósito —su SHA-256 es lo que prueba la deduplicación— y por eso no se mueven solos.
  Reanclarlos a una ventana móvil es trabajo pendiente; hasta entonces, el entorno de QA
  necesita la variable en `false`.

## El parecido con el patrón de la entidad

`core/engine/similarity/`. No es una compuerta: es una **medida**, y devuelve un porcentaje.

La atribución de entidad se resuelve con que un marcador coincida en la carátula, así que basta
escribir «BANCO NACIONAL DE BOLIVIA S.A.» en un documento para que el motor diga que es del BNB.
El descriptor de señales contesta la pregunta que faltaba: **¿se parece a los extractos que esa
entidad emite de verdad?**

- **La evidencia se pondera, no se cuenta.** El criterio es cuánto cuesta FALSIFICAR cada señal,
  no cuán visible es: la razón social se copia y se pega; el generador que declara el archivo hay
  que producirlo con esa herramienta. Contarlas igual dejaría que un documento compuesto en Word
  con la carátula copiada puntuara casi como el original.
- **Cada señal se busca donde corresponde** (`COVER`, `DOCUMENT`, `COLUMNS`, `PRODUCER`). «SALDO»
  aparece en cualquier extracto; en el encabezado de la tabla significa que esa columna existe.
- **El parecido puede RESCATAR pero nunca rechazar.** Parecerse mucho es evidencia positiva y
  sostiene un documento que el contenedor dejó en duda (`SUSPECT`, 30–69). No parecerse es una
  ausencia con mil causas inocentes —maqueta nueva, descriptor incompleto, PDF escaneado— y
  rechazar por ella castigaría al cliente por lo que no sabemos de su banco. **No existe un modo
  que rechace**, y la ausencia es la decisión de diseño del módulo. Un `TAMPERED` (≥70) no se
  rescata nunca.
- **`provenance` gobierna la autoridad del descriptor.** `DECLARED` sólo mide; `MEASURED` —con su
  tamaño de muestra, mínimo 3— es el único que puede corroborar. Un descriptor que se declara
  medido sin muestra se rechaza al guardarlo: sin esa regla, «lo escribí a mano y puse MEASURED»
  sería una puerta trasera con permiso.
- **Los siete descriptores compilados son `DECLARED`**, derivados de los analizadores
  especializados (`core/institutions/signal-descriptors.ts`). Hoy, por tanto, el parecido se
  publica y **no cambia ningún desenlace**. El padrón administrado los pisa cuando los trae.
- **Les faltan a propósito las señales de `PRODUCER`**, que son las que más pesan y las únicas que
  no se pueden deducir de un analizador: hay que abrir PDF reales de cada banco y leer su
  diccionario `/Info`. Inventarlas sería peor que no tenerlas —una señal que nunca coincide baja
  el porcentaje de todos los extractos legítimos de esa entidad—. Añadirlas con su muestra es lo
  que convierte un descriptor en `MEASURED` y enciende el rescate.

Un documento sostenido por el parecido **siempre lo dice**, con la advertencia
`sospecha-sostenida-por-parecido`: quien lea el resultado tiene derecho a saber que ese documento
no entró limpio.

## Los meses completos ya no rechazan

`BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS` por omisión en `false`, y el porqué es una medición:
`monthsComplete` cuenta meses **naturales completos** —28 días cubiertos dentro del propio
mes—, así que el extracto que la banca por internet entrega como «últimos 3 meses»
(31/05 → 31/08) aporta **dos**, no tres. Exigir tres rechazaba a quien había hecho
exactamente lo que se le pidió, con un mensaje que le pedía repetirlo.

La cobertura se sigue midiendo y viaja como advertencia en el resultado, junto a los meses
sin movimientos. El mínimo en sí **no** es configurable: `normalizeAffordabilityPolicy` lo
sostiene en tres. Lo que se configura es si bloquea.

## El documento se conserva mientras el caso está abierto

La regla de privacidad del módulo —borrar el PDF en la misma transacción que cierra la
ejecución— sigue intacta: **un caso en revisión no está cerrado**. Sin eso, la cola ofrecería
«reprocesar» sobre una fila que ya no tiene documento, que es peor que no ofrecerlo. Al
resolver o al reencolar, los bytes se borran.

## La cola

`GET /v1/workers/bank-statement/reviews` — paginada en el servidor, filtrable por categoría,
estado, banco, rango de fechas y prioridad. `…/reviews/categories` publica los contadores
sobre la cola COMPLETA: deducirlos de la página cargada diría «Timeout (4)» sobre una cola de
cuatrocientos.

Acciones, todas auditadas (`BANK_STATEMENT_REVIEW_CLAIMED` / `_RESOLVED` / `_REPROCESSED`):

- `POST …/claim` — reclamar. Atómico (`updateMany` con el estado en el `WHERE`): un reclamo
  que no es atómico no es un reclamo.
- `POST …/resolve` — aprobar, corregir, rechazar o marcar como PDF no válido. **Sólo quien
  reclamó puede resolver**, por la misma segregación que gobierna la revisión manual de
  decisiones: sin ella, «reclamar» es un botón decorativo.
- `POST …/reprocess` — devolver a la cola del worker con los umbrales de hoy.

La prioridad se **deriva** del motivo (1 alta · 2 media · 3 baja). Puesta a mano acabaría
siendo «alta» siempre, que es lo mismo que no tenerla.

## Qué NO cambió, y por qué importa

La tasa de acierto del panel (`successRate`) sigue midiendo procesado frente a fallado. Un
documento rechazado es el worker haciendo su trabajo **bien** —decir que no es un extracto es
un acierto— y contarlo como error castigaría al motor por acertar; un caso en revisión todavía
no tiene desenlace. Los dos sí aparecen en `statusMix`, que es donde se ve el hueco que el
ratio no cubre: sin eso, un worker que derive el 40 % de lo que recibe publicaba un 100 % de
acierto sobre una cola creciendo.

## Enlaces

- Motor: [`core/engine/document-triage.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/modules/workers/bank-statement/core/engine/document-triage.ts) ·
  [`core/engine/document-classifier.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/modules/workers/bank-statement/core/engine/document-classifier.ts)
- Desenlaces: [`statement-outcome.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/modules/workers/bank-statement/statement-outcome.ts)
- Cola: [`review/statement-review.service.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/modules/workers/bank-statement/review/statement-review.service.ts)
- Migraciones: `20260816090000_statement_review_status`, `20260816091000_statement_review_triage`
- Arquitectura de los workers: [additional-workers-architecture.md](additional-workers-architecture.md)
