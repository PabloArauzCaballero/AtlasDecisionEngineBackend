# El gateway LiteLLM del worker semántico

## Qué problema resuelve

El worker semántico ya sabía clasificar con dos adaptadores: `transformer`
(codificador local, dentro del perímetro) y `openai` (modelo generativo alojado).
El segundo trae dos ataduras que no son suyas y que este documento retira:

1. **El motor conoce el modelo físico.** `SEMANTIC_FAST_MODEL=gpt-4.1-mini` queda
   escrito en la configuración del motor, en la etiqueta de sus métricas y en cada
   fila de auditoría. Mover el tráfico a otro proveedor —porque abarata, porque
   se degrada, porque el contrato cambia— es un despliegue del motor.
2. **El motor guarda la credencial del proveedor.** Una por proveedor, en el
   mismo proceso que ejecuta grafos de decisión.

Un [LiteLLM Proxy](https://docs.litellm.ai/docs/simple_proxy) se pone en medio y
se lleva las dos cosas. El motor pide un **alias lógico** —
`semantic-classifier-fast`— contra un endpoint compatible con OpenAI y conoce
**una sola** credencial, la del gateway. Qué modelo atiende ese alias, con qué
suplente y con qué clave vive en [`infra/litellm/config.yaml`](../../infra/litellm/config.yaml).

```text
motor NestJS                 gateway (infra/litellm/config.yaml)
     │                                    │
     │  POST /v1/chat/completions         ├── despliegue primario
     │  model: semantic-classifier-fast   ├── suplente del mismo alias
     │  Authorization: LITELLM_API_KEY    └── … con SU clave, no la del motor
     ▼
   LiteLLM ──────────────────────────────► Gemini / OpenAI / Anthropic / …
```

## Por qué LiteLLM está fuera del dominio

El gateway es **una función especializada detrás de un puerto, no el cerebro del
sistema**. La autoridad sigue siendo del código determinista.

El puerto ya existía y no se ha tocado:
[`SemanticModelProvider`](../../src/modules/workers/semantic-analysis/core/application/ports.ts).
LiteLLM es su tercer adaptador, al lado de los otros dos:
[`litellm-semantic.provider.ts`](../../src/modules/workers/semantic-analysis/core/infrastructure/litellm/litellm-semantic.provider.ts).

Lo que el adaptador **puede** hacer: construir la petición mínima, poner el plazo,
autenticarse, exigir salida estructurada, validarla y traducir errores externos a
errores internos. Lo que **no** puede: decidir reglas de negocio, crear
categorías, escribir en la base, aprobar una asociación de forma permanente ni
decidir cuándo interviene una persona. Todo eso vive donde ya vivía —
`DecisionEngine`, `GlosaFallbackClassifier`, `UnresolvedSink`— y el gateway no lo
sabe.

## El LLM es el último escalón, no el primero

**`SEMANTIC_ANALYSIS_PROVIDER=cascade` es el modo recomendado.** El codificador
local clasifica todas las glosas y el LLM sólo entra en las que aquél **no
resuelve o tarda demasiado**:

```text
FAST  → codificador local (transformer)     gratis · dentro del perímetro
  ├── resuelve                → FIN, el LLM no se entera
  └── no resuelve / va lento  → el motor de decisión escala
                                     ↓
DEEP  → LiteLLM                             se paga sólo aquí
```

No es una optimización de matiz. Con un extracto de trescientos movimientos, la
diferencia entre preguntar siempre y preguntar sólo lo difícil es la mayor parte
de la factura — y del texto que sale del país.

**Quién decide que «no pudo» no es el adaptador.** Ese criterio ya existía y vive
en `DecisionEngine`: en el nivel `FAST`, si ninguna candidata alcanza su umbral o
las dos primeras empatan dentro del margen de ambigüedad, la decisión sale con
`requiresDeepAnalysis` y es el pipeline quien pide el nivel `DEEP`.
[`CascadingSemanticProvider`](../../src/modules/workers/semantic-analysis/core/infrastructure/cascade/cascading-semantic.provider.ts)
sólo atiende cada nivel con quien corresponde. Duplicar el criterio habría creado
dos definiciones de lo mismo, y la que mandaría sería la invisible.

**«Tarda demasiado» cuenta como «no puede».** Pasado
`SEMANTIC_CASCADE_LOCAL_TIMEOUT_MS` (2 s por defecto) se abandona al local y se
devuelve una *abstención* —ningún juicio, no un juicio negativo—, que es lo que
dispara la escalada. Propagar el error habría mandado el caso a revisión humana
teniendo un modelo capaz de resolverlo esperando detrás. Lo que **no** se
sustituye es una respuesta débil: si el local contesta con poca confianza, sus
juicios viajan intactos y es el motor quien decide que no bastan.

Una llamada que el local no llegó a atender se publica como
`cascade:local-unavailable` y no con el nombre del codificador: si se publicara
con su nombre, la métrica contaría un fallo suyo como una llamada que salió bien
y se perdería la señal de que está degradado.

`litellm` a secas —sin cascada— manda **todas** las glosas al gateway. Se
conserva para medir al modelo por su cuenta, no para producción.

| Modo | Quién clasifica | Cuándo usarlo |
|---|---|---|
| `cascade` | local primero, LLM si hace falta | **Producción con IA** |
| `transformer` | sólo el local | Sin IA, todo dentro del perímetro |
| `litellm` | sólo el gateway | Medir al LLM aisladamente |
| `openai` | OpenAI directo | Anterior a la integración |

## Cómo funciona el fallback

El orden no cambia respecto a
[«Ninguna glosa sin categoría»](semantic-sin-desconocido.md). El gateway ocupa
exactamente el hueco donde antes estaba el adaptador de OpenAI:

```text
caché de clasificación            ← no llama a nadie
        ↓
atajo por rubro literal           ← no llama a nadie
        ↓
presupuesto del tenant
        ↓
recuperación de candidatas
        ↓
LiteLLM  (nivel FAST → DEEP sólo si queda ambiguo)
        ↓
validación: JSON → esquema → códigos candidatos → umbral
        ↓
   ┌────┴────┐
válido    incierto o fallido
   │            │
   ▼            ▼
resultado   reglas deterministas + REVISIÓN HUMANA
```

**Nada se inventa.** Cuando la respuesta no sirve, el motor no elige «la más
parecida»: aplica sus reglas deterministas para no dejar el movimiento vacío,
marca `requiresReview` y escribe el motivo. Estos casos terminan **siempre**
delante de una persona:

| Qué pasó | Reintenta | Motivo en la bandeja |
|---|---|---|
| Plazo del análisis agotado | — | `TIMEOUT` |
| 429 / 5xx / gateway caído / red | sí | `PROCESSING_ERROR` |
| JSON inválido, esquema incumplido | no | `PROCESSING_ERROR` |
| Categoría fuera de las candidatas | no | `PROCESSING_ERROR` |
| Alias inexistente, saldo agotado, 401 | no | `PROCESSING_ERROR` |
| Confianza bajo el umbral de la categoría | — | `LOW_CONFIDENCE` |
| Filtro de contenido del proveedor | no | `PROCESSING_ERROR` |

Un fallo de **configuración** del motor (`SEMANTIC_CONFIGURATION_ERROR`) es la
única excepción y sigue fuera de la bandeja: nadie arregla una credencial ausente
desde una pantalla de clasificación, y mandarla ahí escondería el fallo real
detrás de cientos de pendientes.

## Variables de entorno

### Las que ve el motor

Ninguna nombra un modelo físico y sólo hay una credencial.

| Variable | Por omisión | Para qué |
|---|---|---|
| `SEMANTIC_ANALYSIS_PROVIDER` | *(vacío)* | `cascade` (recomendado) o `litellm`. Vacío ⇒ el worker no se registra |
| `SEMANTIC_CASCADE_LOCAL_TIMEOUT_MS` | `2000` | Cuánto se espera al local antes de escalar (sólo en `cascade`) |
| `TRANSFORMER_BASE_URL` | `http://127.0.0.1:8080` | Codificador local; en compose, `http://transformer:80` |
| `LITELLM_BASE_URL` | `http://litellm:4000/v1` | Endpoint del proxy |
| `LITELLM_API_KEY` | — | **Obligatoria.** La master key del proxy o una virtual key suya |
| `LITELLM_FAST_MODEL` | `semantic-classifier-fast` | Alias del nivel rápido |
| `LITELLM_DEEP_MODEL` | `semantic-classifier-deep` | Alias del nivel profundo |
| `LITELLM_EMBEDDING_MODEL` | `semantic-embedding` | Alias de embeddings (sólo en modo híbrido) |
| `LITELLM_TIMEOUT_MS` | `30000` | Plazo por petición |
| `LITELLM_MAX_ATTEMPTS` | `3` | Intentos ante fallos transitorios |
| `LITELLM_MAX_OUTPUT_TOKENS` | `2048` | Techo de salida |
| `SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER` | `false` | Obligatoria en producción (ver **Seguridad**) |

`LITELLM_FAST_MODEL` y `LITELLM_DEEP_MODEL` **rechazan un modelo físico**
(`gpt-*`, `claude-*`, `gemini-*`, `proveedor/modelo`). No es purismo: en cuanto el
motor pide un nombre físico, cambiar de proveedor vuelve a ser un despliegue, y el
fallo es silencioso porque funciona perfectamente el día que se configura. Quien
de verdad quiera hablar directo con un modelo tiene la salida declarada:
`SEMANTIC_ANALYSIS_PROVIDER=openai` con `OPENAI_BASE_URL` apuntando al gateway.

**El presupuesto del análisis no se configura a mano: se deriva.**
`semantic-config.bridge.ts` calcula el peor caso del proveedor elegido
—`LITELLM_TIMEOUT_MS × LITELLM_MAX_ATTEMPTS × 2 niveles`— y eleva solo el lease y
el presupuesto para que quepa, así que subir el plazo del gateway no exige tocar
`SEMANTIC_ANALYSIS_LEASE_SECONDS`. Ese peor caso es un **suelo**: `num_retries` del
gateway suma por debajo y el motor no lo ve, por eso `config.yaml` lo mantiene en
`0` o `1`.

### Las que ve SÓLO el contenedor del gateway

Aquí sí van nombres físicos y las claves de cada proveedor. **Nunca llegan al
motor.**

| Variable | Para qué |
|---|---|
| `LITELLM_MASTER_KEY` | La credencial que el motor presenta. La única compartida |
| `SEMANTIC_FAST_DEPLOYMENT` / `SEMANTIC_FAST_API_KEY` | Despliegue primario del nivel rápido |
| `SEMANTIC_FAST_FALLBACK_DEPLOYMENT` / `..._API_KEY` | Suplente del mismo alias |
| `SEMANTIC_DEEP_DEPLOYMENT` / `SEMANTIC_DEEP_API_KEY` | Despliegue del nivel profundo |
| `SEMANTIC_EMBEDDING_DEPLOYMENT` / `..._API_KEY` | Embeddings del recuperador híbrido |

## Inicio local

```bash
# 1. Declara las variables en .env (ver .env.example, sección del worker semántico)
#    LITELLM_MASTER_KEY, SEMANTIC_FAST_DEPLOYMENT, SEMANTIC_FAST_API_KEY, …

# 2. Levanta los DOS escalones. Van bajo perfil: un despliegue que no los use no
#    arranca contenedores de más.
docker compose --profile transformer --profile litellm up -d transformer litellm

# 3. Levanta el motor en modo cascada
SEMANTIC_ANALYSIS_WORKER_ENABLED=true \
SEMANTIC_ANALYSIS_PROVIDER=cascade \
docker compose up -d api worker
```

En modo `cascade` el codificador local es parte del camino crítico: sin el
servicio `transformer` levantado, **todas** las glosas escalan al LLM y la
integración cuesta lo que costaría sin cascada. El aviso queda en el log
(`cascade:local-unavailable`), no en un fallo de arranque, porque el sistema sigue
clasificando correctamente — sólo que caro.

## Verificación

El puerto 4000 **no se publica al host**: quien tiene la master key puede gastar
contra todos los proveedores configurados. Se comprueba desde dentro de la red.

```bash
# ¿El proxy está en pie? (no consulta a los proveedores, no cuesta nada)
docker compose exec litellm curl -s localhost:4000/health/liveliness

# ¿Qué alias conoce? Deben aparecer los tres del motor.
docker compose exec litellm \
  curl -s -H "Authorization: Bearer $LITELLM_MASTER_KEY" localhost:4000/v1/models

# ¿Responde el alias de verdad? Esto SÍ gasta tokens.
docker compose exec litellm curl -s localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"semantic-classifier-fast","messages":[{"role":"user","content":"ping"}],"max_tokens":5}'
```

Y contra el adaptador real, con el gateway ya levantado:

```bash
RUN_LITELLM_E2E=true \
LITELLM_BASE_URL=http://localhost:4000/v1 LITELLM_API_KEY=<master-key> \
yarn jest test/litellm-smoke.spec.ts
```

## Troubleshooting

| Síntoma | Causa habitual | Qué mirar |
|---|---|---|
| `SEMANTIC_PROVIDER_ERROR` reintentable, sin llegar a HTTP | Conexión rechazada: el gateway no está levantado | `docker compose --profile litellm ps litellm` |
| Igual, pero sólo desde los contenedores | `LITELLM_BASE_URL` apunta a `localhost` | Entre contenedores es `http://litellm:4000/v1`; `localhost` es el propio contenedor |
| `HTTP 401` | La master key del motor y la del proxy no coinciden | `LITELLM_API_KEY` (motor) vs `LITELLM_MASTER_KEY` (gateway) |
| `HTTP 400 (model_not_found)`, sin reintento | El alias no está en `model_list` | Que `LITELLM_*_MODEL` coincida con `model_name` de `config.yaml` |
| El gateway no arranca | `os.environ/<VAR>` sin valor | Los `SEMANTIC_*_DEPLOYMENT` / `*_API_KEY` del servicio `litellm` |
| `HTTP 429`, reintentado y luego a revisión | Límite de tasa del proveedor físico | Añadir un suplente con el mismo `model_name` en `config.yaml` |
| `HTTP 429 (insufficient_quota)`, **sin** reintento | Saldo agotado en el proveedor | Es permanente: insistir sólo retrasaría la revisión |
| «La llamada al proveedor superó N ms» | El gateway responde más lento que el plazo | Subir `LITELLM_TIMEOUT_MS` **y** `SEMANTIC_ANALYSIS_TIMEOUT_SECONDS` a la vez |
| Bandeja creciendo con `PROCESSING_ERROR` y JSON inválido | El modelo detrás del alias no respeta `json_schema` | Cambiar el despliegue en `config.yaml`; no todos los modelos lo soportan |
| El motor no arranca: «transferencia internacional» | Falta la declaración en producción | `SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER=true`, o `SEMANTIC_ANALYSIS_PROVIDER=transformer` |
| El motor no arranca: «necesita la credencial del gateway» | Worker encendido con `litellm` y sin `LITELLM_API_KEY` | Es deliberado: sin la guarda, cada job se convertiría en un pendiente |

## Seguridad

**Qué se envía al proveedor.** Sólo lo que hace falta para clasificar, y la lista
es cerrada porque la construye
[`buildModelPayload`](../../src/modules/workers/semantic-analysis/core/infrastructure/model/classification-contract.ts):
el texto original, el normalizado, las entidades resueltas y los datos públicos de
las categorías candidatas.

**Qué NO se envía.** El `tenantId`, el `requestId`, quién pidió el análisis, los
umbrales de aceptación, las versiones del catálogo, el `retrievalScore` de cada
candidata y cualquier otro identificador interno. No hay que acordarse de
excluirlos: lo que no se proyecta explícitamente no sale del proceso.

**Inyección de instrucciones.** El texto de una glosa es un dato controlado por un
tercero. Tres barreras, y la última no depende del modelo: la instrucción de
sistema declara que el mensaje del usuario es un documento de datos; el esquema
`json_schema` enumera los códigos candidatos, de modo que la gramática no puede
emitir otra cosa; y `assertOnlyCandidateCodes` rechaza la respuesta entera si
aparece un código no propuesto. Una glosa que diga `IGNORE PREVIOUS INSTRUCTIONS`
sigue siendo la descripción de un movimiento.

**Secretos.** El motor conoce una sola credencial, la del gateway. Ningún mensaje
de error la incluye —se registran el estado HTTP y el código del proveedor, nunca
la cabecera ni el cuerpo—. El gateway lleva `turn_off_message_logging: true` para
no dejar una segunda copia del texto clasificado además de la que ya audita el
motor, sujeta a su propia [retención](semantic-sin-desconocido.md).

**Transferencia internacional.** `litellm` exige
`SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER=true` en producción, igual que `openai`.
El proxy corre dentro del perímetro, pero detrás de sus alias hay despliegues de
fuera y el texto sale por ahí igual; además el motor ya no puede verlo, así que
tratarlo como local permitiría transferir datos al exterior editando un YAML que
nadie audita como tal. Un despliegue con el gateway apuntado sólo a modelos
internos declara la variable igualmente: es una afirmación de más, y lo contrario
sería una transferencia de menos.

## Optimización de coste

Ordenadas por lo que ahorran, que es lo contrario del orden en que suelen
mirarse:

1. **No llamar.** La caché de clasificación por glosa normalizada + firma de
   catálogo, y el atajo por rubro literal, resuelven la mayor parte de un extracto
   sin una sola petición. Un extracto de trescientos movimientos trae más de la
   mitad de sus filas con el rubro rotulado.
2. **Escalar sólo lo ambiguo.** El nivel `DEEP` se invoca únicamente cuando el
   `FAST` deja el caso indeciso, y lo decide el motor, no el gateway.
3. **Prefiltrar candidatas.** Sólo se proponen las **hojas** del árbol y sólo las
   que el recuperador seleccionó (`SEMANTIC_ANALYSIS_CANDIDATE_LIMIT`), no el
   catálogo entero.
4. **Payload mínimo.** Ver **Seguridad**: menos campos son menos tokens de
   entrada, y son los mismos campos por la misma razón.
5. **Salida corta y `temperature: 0`.** Salida estructurada acotada por esquema y
   `LITELLM_MAX_OUTPUT_TOKENS`; sin variabilidad, la misma glosa no cae hoy en una
   categoría y mañana en otra.
6. **El local primero (`cascade`).** El escalón que más ahorra: el codificador
   resuelve sin coste por llamada y el LLM sólo ve lo que aquél no pudo.
7. **Modelo barato primero.** El alias `semantic-classifier-fast` puede apuntar al
   modelo más barato que sostenga la salida estructurada, y cambiarlo no toca el
   motor.
8. **Presupuesto por tenant.** `SEMANTIC_ANALYSIS_BUDGET_*` corta el gasto antes
   de la llamada, no después.

**Lo que se mide.** Cada llamada deja en su span `semantic.classify` el modelo
pedido (`semantic.model`, el alias), el que respondió (`semantic.model.resolved`,
sólo si difiere), los tokens (`semantic.usage.*`) y el coste que calculó el
gateway (`semantic.usage.estimated_cost`). Van a la traza y no a un contador de
Prometheus a propósito: son numéricos de alta variabilidad y su cardinalidad la
fijaría un fichero que este repositorio no controla. **Un atributo ausente
significa «el gateway no lo declaró»**, nunca «no gastó»: es lo que hay que
investigar si el panel de coste se queda plano.

## Rollback

Volver al comportamiento anterior es una variable y un reinicio, sin despliegue:

```bash
SEMANTIC_ANALYSIS_PROVIDER=transformer   # sólo el local; o vacío para apagar el worker
```

Con el worker apagado, una glosa desconocida termina en revisión humana
exactamente como antes de que existiera este documento.

## Pruebas

| Archivo | Qué fija | Coste |
|---|---|---|
| [`litellm-semantic-provider.spec.ts`](../../test/litellm-semantic-provider.spec.ts) | El adaptador: petición, esquema, parsing, cada modo de fallo | 0 |
| [`litellm-provider-selection.spec.ts`](../../test/litellm-provider-selection.spec.ts) | Alias lógico obligatorio, presupuesto, transferencia internacional | 0 |
| [`litellm-clasificacion-flujo.spec.ts`](../../test/litellm-clasificacion-flujo.spec.ts) | El flujo entero: determinista gana, y todo fallo acaba en la bandeja | 0 |
| [`semantic-cascada-local-primero.spec.ts`](../../test/semantic-cascada-local-primero.spec.ts) | El LLM sólo entra si el local no puede o tarda demasiado | 0 |
| [`litellm-gateway-contract.integration.spec.ts`](../../test/litellm-gateway-contract.integration.spec.ts) | El contrato HTTP contra un servidor real | 0 |
| [`litellm-smoke.spec.ts`](../../test/litellm-smoke.spec.ts) | Un gateway real: el alias existe y respeta el esquema | tokens, **opt-in** |

Sólo el último gasta dinero y sólo con `RUN_LITELLM_E2E=true`. CI no lo ejecuta.
