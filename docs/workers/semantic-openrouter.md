# OpenRouter como gateway del worker semántico

El worker semántico puede clasificar contra un modelo de lenguaje a través de **dos gateways**:
el propio ([LiteLLM](semantic-litellm-gateway.md)) y **OpenRouter**. Este documento cubre el
segundo y la pieza que los une: la elección del gateway y del modelo **desde el portal**, en
caliente, sin redesplegar.

## Qué problema resuelve

Con LiteLLM, cambiar de modelo es editar `infra/litellm/config.yaml` y reiniciar el contenedor
del gateway. Es lo correcto para un despliegue con un proveedor fijo y suplente, pero exige tener
el contenedor, sus claves y una persona con acceso al servidor. OpenRouter da acceso a los mismos
proveedores —OpenAI, Anthropic, Google, Meta…— con **una sola credencial y ningún contenedor**, y
publica un catálogo con precio por modelo. A cambio, no hay alias: el motor pide el modelo físico
(`openai/gpt-4.1-mini`) y por eso conviene que ese nombre lo elija alguien desde una pantalla y no
quede escrito en una variable de entorno.

Los dos gateways conviven. El entorno decide cuál es el valor por omisión; el portal puede
cambiarlo.

## El adaptador

`core/infrastructure/openrouter/openrouter-semantic.provider.ts` habla la interfaz de OpenAI
(`/chat/completions`) y comparte con el adaptador de LiteLLM el transporte —reintentos, plazos,
clasificación de fallos— y el contrato de clasificación —prompt, esquema estricto, validación de
códigos—. Lo específico de OpenRouter:

| Qué                                   | Por qué                                                                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider: { require_parameters }`    | Un mismo modelo lo sirven varios proveedores físicos y no todos honran `response_format` estricto. Sin esto OpenRouter enruta por precio y puede caer en uno que ignore el esquema. |
| `usage: { include: true }`            | El coste real de la llamada sólo viene si se pide. Es el equivalente de `x-litellm-response-cost`; ausente significa «no lo dijo», nunca cero.                          |
| `modelVersion = modelo@proveedor`     | El `provider` de la respuesta dice qué despliegue físico atendió. Es lo que hay que mirar cuando el mismo modelo se comporta distinto según el día.                      |
| 402 y «Insufficient credits»          | Sin créditos no se reintenta: consumiría los tres intentos por glosa y para siempre.                                                                                     |
| `error` dentro de un 200              | OpenRouter contesta 200 con el error embebido cuando el proveedor falló tras aceptar la petición. Se reconduce al mismo camino que un error HTTP.                          |

Los identificadores tienen la forma `proveedor/modelo` (con variante opcional `:free`,
`:nitro`). Es exactamente la forma que el adaptador de LiteLLM **rechaza**, y no es una
contradicción: cada uno exige lo que su gateway resuelve.

## Variables de entorno

```bash
SEMANTIC_ANALYSIS_PROVIDER=openrouter      # o `cascade` con SEMANTIC_CASCADE_REMOTE_PROVIDER=openrouter
OPENROUTER_API_KEY=                        # la única credencial que ve el motor
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_FAST_MODEL=openai/gpt-4.1-mini
OPENROUTER_DEEP_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_TIMEOUT_MS=30000
OPENROUTER_MAX_ATTEMPTS=3
OPENROUTER_MAX_OUTPUT_TOKENS=2048
OPENROUTER_APP_URL=                        # atribución opcional (HTTP-Referer)
OPENROUTER_APP_TITLE=                      # atribución opcional (X-Title)
```

Los dos modelos por omisión declaran `structured_outputs` en el catálogo de OpenRouter. En
producción, `openrouter` exige declarar `SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER=true` igual que
`litellm` y `openai`: el texto sale del país en la primera llamada.

**La cascada puede escalar a OpenRouter.** `SEMANTIC_ANALYSIS_PROVIDER=cascade` con
`SEMANTIC_CASCADE_REMOTE_PROVIDER=openrouter` deja el codificador local exactamente igual y
sólo cambia a quién se le pregunta lo difícil. Sólo hace falta la credencial del gateway que se
elija: el esquema de entorno exige `OPENROUTER_API_KEY` o `LITELLM_API_KEY` según el remoto, no
las dos.

OpenRouter no ofrece `/embeddings`: con el recuperador híbrido hay que declarar
`SEMANTIC_EMBEDDING_PROVIDER` (`transformer`, `litellm` u `openai`).

## Elegirlo desde el portal

**Workers → Análisis semántico → Configuración.** La pestaña enseña qué está en uso y de dónde
sale (entorno o portal), deja elegir el gateway y el modelo por nivel, y tiene dos botones en
este orden: **Probar** y **Guardar**.

- **Probar** clasifica una glosa sintética por nivel con la configuración candidata, sin
  guardarla, y enseña quién respondió, latencia, coste y si respetó el esquema. Cuesta lo que
  cuestan dos glosas. Existe para no elegir a ciegas un modelo que llene la bandeja de revisión
  al día siguiente.
- **Guardar** escribe UNA fila global (`decision_semantic_model_setting`) y queda auditado
  (`SEMANTIC_MODEL_SETTINGS_UPDATED`). **Volver al entorno** la quita
  (`SEMANTIC_MODEL_SETTINGS_RESET`).

Roles: leer, los del worker; guardar y probar, `RISK_ANALYST` y `OPERATIONS` —el primero porque
gobierna cómo decide el motor, el segundo porque gobierna cuánto gasta—.

### Qué NO se elige desde el portal

- **El modo** (`transformer`, `cascade`, directo): depende de qué contenedores existen en el
  despliegue. En un modo sin gateway remoto la pestaña lo explica y no deja guardar.
- **Las credenciales.** El portal sabe si el motor TIENE la de cada gateway, nunca cuál es. Un
  gateway sin credencial se ofrece deshabilitado con la variable que falta.

### Cómo se entera el worker

La API escribe la fila; el worker es otro proceso. `SemanticModelSettingsService` sondea la
**versión** de la fila cada `SEMANTIC_MODEL_SETTINGS_REFRESH_MS` (10 s) en los procesos que
corren el worker y, cuando cambia, el puente del proveedor **reconstruye el adaptador y vacía la
caché de clasificación**. Sin lo segundo, los veredictos del modelo anterior se seguirían
sirviendo como si fueran del nuevo —el mismo defecto que tuvo el catálogo cuando editar una
categoría no cambiaba su firma—.

La configuración del portal se traduce a las **mismas variables** que lee la fábrica del núcleo
(`model-settings/environment-overrides.ts`): un modelo elegido en la pantalla y el mismo modelo
puesto en `.env` construyen exactamente el mismo adaptador, con las mismas validaciones y la misma
comprobación de presupuesto.

### El lease

El gateway se puede cambiar en caliente, así que el peor caso que dimensiona el lease del análisis
es el del gateway **más lento al que el despliegue puede llegar** —los que tienen credencial—, no
sólo el del elegido en el entorno (`semantic-config.bridge.ts`). Un lease calculado para LiteLLM
que de pronto ampara llamadas a OpenRouter con un plazo mayor dejaría que otra réplica reclamase
un job todavía vivo.

## Endpoints

| Operación                                                 | Roles                                             |
| --------------------------------------------------------- | ------------------------------------------------- |
| `GET /v1/workers/semantic-analysis/model-settings`         | RISK_ANALYST, FRAUD_ANALYST, QA_ANALYST, OPERATIONS |
| `PUT /v1/workers/semantic-analysis/model-settings`         | RISK_ANALYST, OPERATIONS                          |
| `DELETE /v1/workers/semantic-analysis/model-settings`      | RISK_ANALYST, OPERATIONS                          |
| `GET /v1/workers/semantic-analysis/model-settings/catalog` | RISK_ANALYST, FRAUD_ANALYST, QA_ANALYST, OPERATIONS |
| `POST /v1/workers/semantic-analysis/model-settings/test`   | RISK_ANALYST, OPERATIONS                          |

El catálogo es el de OpenRouter (`/models`), cacheado diez minutos y **filtrado a los modelos que
declaran `structured_outputs`**: los demás se omiten porque con ellos cada glosa acabaría en
revisión humana.

## Verificación

```bash
# Unidad: el adaptador contra el límite HTTP, la selección y el enrutado del portal.
yarn jest test/openrouter-semantic-provider.spec.ts test/openrouter-provider-selection.spec.ts \
  test/semantic-model-settings.service.spec.ts test/semantic-model-provider-router.spec.ts

# Humo REAL (gasta créditos; opt-in). Comprueba que los modelos por omisión existen, que algún
# proveedor detrás honra el esquema estricto y que el coste viene en la respuesta.
RUN_OPENROUTER_E2E=true OPENROUTER_API_KEY=sk-or-v1-... yarn jest test/openrouter-smoke.spec.ts
```

Medido el 2026-09-04: `openai/gpt-4.1-mini` respondió por OpenAI en 4 s a 0,00037 USD;
`anthropic/claude-sonnet-4.5` por Amazon Bedrock en 8 s a 0,0056 USD. Los dos con el veredicto
esperado sobre la glosa de prueba.

## Troubleshooting

| Síntoma                                                            | Causa probable                                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `HTTP 400` en cada glosa con un modelo recién elegido               | Ningún proveedor físico de ese modelo honra el esquema estricto. Elige uno que declare `structured_outputs`. |
| `HTTP 402` permanente                                              | Sin créditos en la cuenta de OpenRouter. El adaptador no reintenta a propósito.                             |
| El portal dice «Sin credencial en el motor»                        | Falta `OPENROUTER_API_KEY` en el entorno del motor (en Coolify, en `motor.env`).                            |
| Guardar responde 409 «no tendría efecto»                           | `SEMANTIC_ANALYSIS_PROVIDER` es `transformer` u `openai`: el modo se cambia en el entorno.                  |
| El cambio no surte efecto                                          | El worker sondea cada 10 s; pasado eso, comprueba que el proceso WORKER tenga la misma base que la API.     |

## Seguridad

- La credencial de OpenRouter es la única que entra en el proceso; las cuentas de los proveedores
  físicos viven en OpenRouter. Nunca se escribe en la base ni sale por la API.
- Cada cambio de configuración queda en la cadena de auditoría con actor, antes y después.
- Probar exige el mismo rol que guardar: es la única forma de que alguien sin ese rol no pueda
  gastar créditos a discreción.
