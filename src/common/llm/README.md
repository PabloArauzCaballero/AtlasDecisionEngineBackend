# Cliente y transporte de modelos de lenguaje

Lo que varios módulos necesitan para hablar con una API compatible con OpenAI, y
nada más: aquí no hay ni una regla de negocio ni un prompt de dominio.

| Archivo | Qué aporta |
| --- | --- |
| `openai-compatible-transport.ts` | Reintentos, plazos y **clasificación de fallos**: qué es pasajero, qué es permanente y qué significa «no queda saldo» |
| `openrouter-chat.client.ts` | Una conversación estructurada contra OpenRouter, con o sin imágenes, y el saldo por `GET /key` |
| `llm-provider.error.ts` | Las clases genéricas, para quien no tenga taxonomía propia |

## Por qué vive en `common` y no dentro de un worker

El transporte nació en el worker semántico y ahí se quedó mientras fue su único
usuario. Lo sacó de allí tener **tres consumidores con la misma necesidad y
ningún dominio en común**:

- el árbitro de la franja de duda de identidad,
- el segundo lector de campos del carnet,
- el consejero de columnas de un extracto sin analizador propio.

Lo que se comparte no es «hacer un `fetch`» —eso no vale una carpeta—, sino la
parte que costó acertar: reconocer **saldo agotado** en las tres formas en que
llega (el 402 de OpenRouter, un código de facturación, y la prosa del proveedor
físico cuando el gateway aplanó su error estructurado). Esa lista se midió contra
cuentas reales sin fondos; copiarla habría creado dos versiones que se separan al
primer proveedor nuevo.

## La regla que gobierna a los tres consumidores

**El modelo propone y algo determinista decide.** Cada consumidor tiene su juez:

| Consumidor | Quién verifica su respuesta |
| --- | --- |
| Segundo lector del carnet | El dígito de control de la MRZ |
| Consejero de columnas | El saldo corriente del extracto, fila a fila |
| Árbitro de identidad | Nadie: por eso **sólo puede escalar, nunca aprobar** |

El tercero es el que explica los otros dos. Donde no hay verificador, el modelo
no recibe autoridad; donde lo hay, su propuesta se aplica sólo si el verificador
la confirma.

## Taxonomía de errores

`TransportErrors` es inyectable porque el semántico distingue
`SemanticTimeoutError` para rescatar un análisis a medias y `toStableErrorCode`
sólo sabe nombrar sus propias clases. Quien no necesite esa distinción usa
`DEFAULT_TRANSPORT_ERRORS` y se queda con las de aquí.

`LlmCreditsExhaustedError` es la única que tiene clase propia por una razón de
operación y no de programación: es el único fallo de esta familia que **no se
arregla tocando el motor**. Desde una bandeja de revisión, «no hay créditos» y
«el proveedor no contestó» se ven idénticos y tienen dueños distintos.
