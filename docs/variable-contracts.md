# Contratos de variables, intermedias y salidas

Manual técnico y funcional de la taxonomía de variables del motor (§1–§4 de la
ampliación de contratos). Describe **lo implementado**, con los archivos y las pruebas
que lo respaldan.

---

## 1. Taxonomía: cinco cosas distintas que antes se llamaban igual

| Concepto | Dónde vive | Alcance | Sale en la respuesta |
| --- | --- | --- | --- |
| **Variable de entrada** | Catálogo global (`decision_variable_definition/_version`) + dependencia `usageType=INPUT` | Reutilizable entre artefactos | No |
| **Variable intermedia** | `decision_intermediate_variable`, ligada a UNA versión de artefacto | Una ejecución del grafo que la declara | Solo con mapeo explícito |
| **Valor producido por un nodo** | En memoria, dentro de la ejecución | El nodo y la traza | No por sí mismo |
| **Variable de salida** | Catálogo global + dependencia `usageType=OUTPUT`/`OUTPUT_PRIMARY` | Contrato público del artefacto | Sí |
| **Campo calculado** | `decision_calculated_field(_version)` | Reutilizable entre artefactos | No: devuelve un valor a quien lo invoca |

La regla que resuelve la confusión histórica: **no todo valor que produce un nodo es una
salida pública**. El motor las separa explícitamente en la traza (`variableState`) y la
UI las pinta en tres bloques distintos.

---

## 2. Tipos de dato canónicos

`src/common/contracts/data-types.ts` es la única lista:

```
STRING · LONG_TEXT · INTEGER · DECIMAL · BOOLEAN · DATE · DATETIME · TIME
ENUM · LIST · OBJECT · IDENTIFIER · PERCENTAGE · CURRENCY · CODE · STRUCTURED_RESULT
```

Los nombres históricos (`NUMBER`, `TEXT`, `ARRAY`, `UUID`, `JSON`…) se **normalizan**, no
se rechazan: hay artefactos aprobados —y por tanto inmutables— que los usan.

`PERCENTAGE` valida el rango 0–100 en la propia comprobación de forma. Es deliberado: un
porcentaje que llega como `0.42` en vez de `42` produce decisiones silenciosamente
erróneas, y es el error de escalado más común en integraciones.

**Compatibilidad entre contratos** (`isTypeAssignable`, usada al encadenar artefactos):
`INTEGER → DECIMAL` sí; `DECIMAL → INTEGER` no (perdería precisión); `ENUM → STRING` sí;
`STRING → ENUM` no.

---

## 3. Restricciones configurables

Definidas en `constraints.types.ts`, evaluadas por `constraint-engine.ts`.

| Grupo | Restricciones |
| --- | --- |
| Rango | `min`, `max`, `exclusiveMin`, `exclusiveMax` |
| Longitud | `minLength`, `maxLength` |
| Cardinalidad | `minItems`, `maxItems`, `unique`, `itemType` |
| Numéricas | `precision`, `scale` |
| Forma | `pattern`, `format` (EMAIL, UUID, ISO_COUNTRY, ISO_CURRENCY, URL, PHONE, IBAN) |
| Dominio | `allowedValues` |
| Dependencias | `dependsOn`, `conditional` (obligatoriedad y restricciones condicionales) |
| Acotadas | `byCountry`, `byProduct`, `byEnvironment`, `byTenant`, `byContractVersion` |

### Configuración desde el frontend, validación en el backend

El editor (`ConstraintEditor.tsx`) ofrece solo las restricciones que aplican al tipo y
permite probar un valor de ejemplo. Esa comprobación es **orientativa**: el backend
reevalúa siempre, con el mismo motor, antes de cualquier ejecución. El frontend nunca es
la fuente autoritativa.

### Restricciones acotadas por ambiente

Un mismo contrato puede ser más estricto en PROD:

```json
{
  "min": 0,
  "byEnvironment": [{ "match": ["PROD"], "constraints": { "max": 500 } }]
}
```

En DEV un valor de 900 pasa; en PROD lo rechaza `ABOVE_MAXIMUM`.

### Obligatoriedad condicional

```json
{
  "conditional": [
    { "whenField": "tipo", "operator": "EQUALS", "value": "EMPRESA", "required": true }
  ]
}
```

Los valores por defecto se aplican **antes** de validar, para que una regla condicional
vea el contrato completo y el resultado no dependa del orden de las variables.

---

## 4. Variables intermedias (`INTERMEDIATE`)

### Por qué no cuelgan del catálogo global

§2.1 exige que una intermedia **no aparezca en catálogos generales de variables
reutilizables**. Si colgara de `decision_variable_definition` aparecería en el catálogo
por construcción. Por eso vive en su propia tabla, con unicidad
`(artifactVersionId, code)` en vez de `(tenantId, code)`.

`DependencyDto` rechaza explícitamente `usageType: 'INTERMEDIATE'` con un mensaje que
apunta al mecanismo correcto.

### Definición

Cada intermedia declara: código, nombre, descripción, tipo, **nodo productor**, nodos
consumidores autorizados, valor inicial opcional, restricciones, nulabilidad, estrategia
de actualización (`SINGLE_WRITE` / `OVERWRITE` / `ACCUMULATE`), clasificación de
sensibilidad y política de traza.

### Ciclo de vida

```
NOT_AVAILABLE ──(el productor escribe)──> COMPUTED ──(un nodo la lee)──> CONSUMED
                                              │
                                        (OVERWRITE/ACCUMULATE)
                                              ▼
                                           UPDATED
```

El ámbito (`IntermediateScope`) se crea al empezar `execute()` y se descarta al terminar.
Vive en el estado de la ejecución, **no en el servicio**: el servicio es un singleton
compartido entre peticiones y ahí una intermedia sobreviviría a su ejecución.

### Validación estática: dominancia, no alcanzabilidad

`graph-intermediate.validator.ts` calcula los **dominadores** del grafo por iteración de
punto fijo. Un nodo puede leer `intermediate.x` solo si su productor está en TODOS los
caminos desde START hasta él.

Una simple búsqueda de alcanzabilidad diría que basta con que exista *un* camino que pase
por el productor, y dejaría pasar este grafo roto:

```
START ──> CALC (crea dti) ──┐
   └────> OTRA ─────────────┴──> USA (lee dti)   ← por la rama OTRA, dti no existe
```

Se rechaza con `INTERMEDIATE_READ_BEFORE_WRITE`. Con `initialValue` declarado, la
variable está disponible desde el arranque y el mismo grafo pasa.

### Errores que el motor impide

| Código | Qué evita |
| --- | --- |
| `INTERMEDIATE_NOT_DECLARED` | Referencia a una intermedia inexistente |
| `INTERMEDIATE_READ_BEFORE_WRITE` | Lectura antes de su creación |
| `INTERMEDIATE_WRITE_UNAUTHORIZED` | Escritura desde un nodo que no es el productor |
| `INTERMEDIATE_READ_UNAUTHORIZED` | Lectura desde un nodo no autorizado |
| `INTERMEDIATE_ALREADY_WRITTEN` | Segunda escritura con política `SINGLE_WRITE` |
| `INTERMEDIATE_VALUE_INVALID` | Valor que incumple el tipo o las restricciones |
| `INTERMEDIATE_NAME_COLLISION` | Colisión con una variable del contrato público |
| `INTERMEDIATE_NEVER_WRITTEN` | Declarada pero sin productor ni valor inicial |
| `OUTPUT_SOURCE_INTERMEDIATE_MISSING` | Salida que mapea una intermedia inexistente |

Además, `INTERMEDIATE_UNUSED` es una **advertencia**: la variable se crea y nadie la
consume, señal habitual de lógica muerta.

### Espacio de nombres propio

Las expresiones leen `intermediate.<code>`, nunca `<code>` a secas. Así una expresión no
puede leer `dti` creyendo que es una entrada del contrato.

---

## 5. Contrato de salida explícito

La salida final **no se infiere del último nodo**. Cada campo declara su origen en
`decision_output_contract_field`:

| Campo | Qué declara |
| --- | --- |
| `sourceKind` | `NODE` / `EXPRESSION` / `INTERMEDIATE` / `CONSTANT` / `REFERENCE` |
| `sourceRef` | Clave de nodo, expresión, código de intermedia, literal o `nodeKey:outputCode` |
| `valueMapping` | Traducción de valores internos a valores publicados |
| `absenceReasons` | Motivos válidos de ausencia (solo campos opcionales) |
| `sensitivityClass` / `tracePolicy` | Qué se puede ver y dónde |

### Validaciones antes de publicar

1. Todo campo obligatorio tiene origen declarado — `REQUIRED_OUTPUT_WITHOUT_SOURCE`
2. El origen existe en el grafo — `OUTPUT_SOURCE_NODE_MISSING`
3. El tipo producido coincide — `OUTPUT_SOURCE_TYPE_MISMATCH`
4. No hay campos duplicados — `OUTPUT_CONTRACT_DUPLICATE`
5. No hay mapeos ambiguos — el mismo código no puede declararse dos veces
6. Ninguna intermedia se expone sin mapeo explícito
7. Un campo sensible con traza `FULL` genera advertencia — `OUTPUT_SENSITIVE_IN_TRACE`
8. Todo nodo terminal produce las salidas obligatorias — `TERMINAL_PATH_MISSING_REQUIRED_OUTPUT`
9. Los campos opcionales documentan sus motivos de ausencia
10. Los casos sembrados verifican el contrato (ver `contract-demo-seed.spec.ts`)

Un `RESULT` en modo `SCRIPT` o `REFERENCE` resuelve sus salidas en ejecución, así que la
regla 8 no se le aplica estáticamente: se comprueba en tiempo de ejecución con
`REQUIRED_OUTPUT_MISSING`.

### Compatibilidad

El contrato explícito es **opcional**. Un artefacto sin él sigue validando (advertencia
`OUTPUT_CONTRACT_NOT_DECLARED`), de modo que nada de lo ya publicado se rompe. Solo los
artefactos que lo declaran obtienen las diez comprobaciones.

---

## 6. Estado de variables por nodo

Cada paso de la traza incluye `variableState`:

```jsonc
{
  "nodeKey": "CALCULAR_DTI",
  "inputs": [{ "code": "ingreso_mensual", "state": "VALID", "value": 2000 }],
  "intermediatesBefore": [{ "code": "dti", "state": "NOT_AVAILABLE" }],
  "intermediatesAfter": [
    {
      "code": "dti",
      "state": "COMPUTED",
      "value": 0.2,
      "consumedByNodeKeys": ["EVALUAR"],
      "createdAtStepIndex": 1
    }
  ],
  "intermediatesCreated": ["dti"],
  "intermediatesUpdated": [],
  "outputs": [{ "code": "decision_afordabilidad", "state": "NOT_AVAILABLE" }]
}
```

Estados posibles: `NOT_AVAILABLE`, `AVAILABLE`, `VALID`, `INVALID`, `COMPUTED`,
`UPDATED`, `CONSUMED`, `SKIPPED`, `ERROR`, `REDACTED`.

### Momento de creación (§3.1)

`createdAtStepIndex` es el índice (base 0) del **paso de esta misma traza** que le dio valor
por primera vez. En una traza larga es lo que permite saltar del valor al nodo que lo produjo
en vez de leerla entera.

- Una **reescritura** (`OVERWRITE`/`ACCUMULATE`) actualiza el valor pero **no** mueve el
  índice: lo que interesa es cuándo apareció, no cuándo se tocó por última vez.
- **Ausente** en dos casos que no son lo mismo, y por eso no se colapsan en un `0`: la
  variable sigue en `NOT_AVAILABLE`, o nació con `initialValue` y ya existía antes de que se
  ejecutara ningún nodo.
- Es un índice y no una marca de tiempo a propósito: un reloj haría que dos ejecuciones
  idénticas produjeran trazas distintas.

El ciclo de vida completo está en `../plantuml/24_ciclo_vida_variable_intermedia.puml`.

### Quién cuenta como consumidor

La vista legible expone cada intermedia como un **getter**, no como un valor copiado. Así
el "nodo consumidor" que acaba en la traza es el que realmente leyó la variable, y no
todo nodo para el que se construyó un contexto.

### Seguridad de la visualización

- Los valores de variables sensibles se persisten como hash HMAC, nunca en claro.
- `tracePolicy` decide qué se ve: `FULL`, `MASKED` (`*****67`), `REDACTED` (`null`),
  `EXCLUDED`.
- El panel del frontend enmascara de nuevo por clase de sensibilidad, aunque el backend
  hubiera enviado el valor: defensa en profundidad.

---

## 7. Referencia rápida de la API

| Operación | Endpoint |
| --- | --- |
| Guardar grafo con intermedias y contrato de salida | `PUT /v1/artifact-versions/{id}/graph` |
| Validar (incluye §2.3 y §4) | `POST /v1/artifact-versions/{id}/validate` |
| Vista de contrato completo | `vw_artifact_variable_contract` |

El cuerpo de `PUT .../graph` acepta `intermediates[]` y `outputContract[]` además de
`dependencies`, `conditions`, `actions`, `nodes` y `edges`.

---

## 8. Pruebas que respaldan este documento

| Archivo | Qué fija |
| --- | --- |
| `test/constraint-engine.spec.ts` | Tipos, restricciones, ejes acotados, condicionales |
| `test/intermediate-scope.spec.ts` | Ciclo de vida completo de una intermedia |
| `test/graph-contract-validators.spec.ts` | Dominancia, autorizaciones, contrato de salida |
| `test/engine-intermediate-properties.spec.ts` | Propiedades sobre el motor real (fast-check) |
| `test/contract-demo-seed.spec.ts` | El demo sembrado coincide con la ejecución real |
