# Publicar todos los artefactos de una vez

Un entorno del Motor no decide hasta que alguien publica sus artefactos, y cada artefacto tiene su
guion con sus banderas. Este runbook es el camino corto: **un comando que los recorre todos**, que se
puede repetir como una semilla y que no toca lo que ya está hecho.

La historia de por qué hace falta está en
[Artefactos en un entorno nuevo](artefactos-en-un-entorno-nuevo.md).

## Lo único que no es automático

**Las dos firmas.** Cada versión la aprueban dos personas distintas en el portal del Motor
(`QA_ANALYST` y `RISK_APPROVER`, ninguna la autora). El guion publica, deja todo en revisión y
después despliega lo aprobado; no firma ni crea aprobadores de máquina, porque eso anula el control.

Por eso son tres pasos y no uno:

| Paso | Quién | Qué corre |
|---|---|---|
| 1. Publicar | Quien tenga la clave de gestión | `publicar-todos-los-artefactos.mjs` |
| 2. Firmar | Dos personas, en el portal | — |
| 3. Desplegar | Quien tenga la credencial del `RELEASE_MANAGER` | `publicar-todos-los-artefactos.mjs --deploy-aprobadas` |

## Paso a paso

Todos los comandos se corren desde la raíz de `AtlasDecisionEngineBackend`. `<url>` es la base del
Motor del entorno y `<ENTORNOS>` sus ambientes separados por coma (TEST de Contabo sólo tiene
`STAGING`).

1. **Ver el estado** (sólo lectura, no corre ningún guion):

   ```sh
   MANAGEMENT_API_KEY=… node scripts/publicar-todos-los-artefactos.mjs --base <url> --environments <ENTORNOS> --estado
   ```

2. **Ensayar**: corre cada guion con `--dry-run`. Lee del Motor, no escribe.

   ```sh
   MANAGEMENT_API_KEY=… node scripts/publicar-todos-los-artefactos.mjs --base <url> --environments <ENTORNOS> --dry-run
   ```

3. **Publicar**: crea lo que falta, escribe el grafo, compila, corre la suite bloqueante y manda cada
   versión a revisión.

   ```sh
   MANAGEMENT_API_KEY=… node scripts/publicar-todos-los-artefactos.mjs --base <url> --environments <ENTORNOS>
   ```

4. **Firmar** en el portal del Motor: dos personas por versión. La tabla final del paso 3 dice qué
   versiones esperan firma.

5. **Desplegar lo aprobado**, con la credencial del `RELEASE_MANAGER` (la de gestión da 403 por
   separación de funciones):

   ```sh
   MANAGEMENT_API_KEY=<la del RELEASE_MANAGER> node scripts/publicar-todos-los-artefactos.mjs --base <url> --environments <ENTORNOS> --deploy-aprobadas
   ```

   Despliega sólo las versiones en `APPROVED` y lista las que todavía no lo están. Se puede repetir
   a medida que entran las firmas.

6. **Verificar** que el entorno decide, no sólo que el catálogo los lista:

   ```sh
   MANAGEMENT_API_KEY=… node scripts/verificar-artefactos-publicados.mjs --base <url> --exigir-despliegue --environments <ENTORNOS>
   ```

   Sale 0 cuando cada artefacto exigido tiene despliegue activo en cada entorno.

## Cómo leer la tabla

Cada corrida termina con una fila por artefacto: resultado, código, versión más alta y motivo.

| Resultado | Qué significa |
|---|---|
| `publicado` / `desplegado` | El guion del artefacto corrió y salió bien. |
| `ensayado` | Lo mismo, con `--dry-run`. |
| `haría: …` | Con `--estado`: lo que correría sin la bandera. |
| `sin tocar` | No hacía falta, o le toca a una persona. El motivo lo dice. |
| `FALLÓ` | El guion salió con error. Los demás se corrieron igual y la corrida sale 1. |

Cuando la versión más alta no es la que decide, el motivo termina con «sigue decidiendo la versión
id N en ENTORNO»: el artefacto no dejó de decidir, sólo hay una versión nueva a medio camino.

Motivos de `sin tocar` y qué hacer:

| Motivo | Qué hacer |
|---|---|
| `ya decide` | Nada. |
| `en revisión: faltan las dos firmas` | Firmar en el portal. |
| `aprobada: falta desplegarla` | Paso 5. |
| `en CHANGES_REQUESTED / REJECTED / SUSPENDED / RETIRED` | Lo resuelve una persona en el portal; el guion no pisa una decisión humana. |
| `su guion no la continúa` | La versión quedó en un estado que ese guion no sabe retomar: revisarla en el portal. |
| `su guion no publica versiones nuevas` | Con `--nueva-version`: ese artefacto no tiene ese camino en su guion. |

## Banderas

| Bandera | Efecto |
|---|---|
| `--base <url>` | Motor del entorno. También `DECISION_ENGINE_BASE_URL`. |
| `--environments A,B` | Ambientes. Obligatoria con `--deploy-aprobadas`; al publicar define dónde se exige «ya decide». |
| `--tenant <id>` | Por defecto `1`. |
| `--estado` | Sólo la tabla. |
| `--dry-run` | Corre cada guion en seco. |
| `--solo A,B` | Sólo esos códigos (incluye los de demostración si se nombran). |
| `--solo-exigidos` | Sólo los que AtlasBackend necesita para decidir. |
| `--incluir-demo` | También los de demostración. |
| `--nueva-version` | Publica la definición del repo como versión nueva de los que ya deciden. |
| `--deploy-aprobadas` | Despliega las versiones aprobadas en vez de publicar. |

Códigos de salida: `0` nada falló, `1` falló algún guion, `2` no se pudo leer el Motor o faltan
argumentos.

## Qué artefactos recorre

La lista vive en `scripts/lib/artefactos.manifiesto.json` y es la única: la leen este guion y el
verificador.

| Código | Guion | Exigido | Notas |
|---|---|---|---|
| `IDENTIDAD_CARNET_MOVIL` | `identidad-carnet-movil.mjs` | sí | Las migraciones ya lo crean. |
| `ATLAS_BNPL_UNDERWRITING` | `atlas-underwriting-v2.mjs` | sí | En un entorno vacío se crea con `--crear`; el guion lo pone solo. |
| `RIESGO_ONBOARDING_CLIENTE` | `riesgo-onboarding-cliente.mjs` | sí | |
| `PARTNER_KYB_REVIEW` | `partner-kyb-review.mjs` | sí | |
| `PRIVACIDAD_SOLICITUD_TITULAR` | `privacidad-solicitud-titular.mjs` | no | Necesita la migración `20261004120000_decision_kind_data_subject_rights`. |
| `ATLAS_RECALIFICACION_CAPACIDAD` | `recalificacion-capacidad-pago.mjs` | no | |
| `EXTRACTO_CAPACIDAD_PAGO` | `extracto-capacidad-pago.mjs` | no | Demostración: sólo con `--incluir-demo` o `--solo`. |

«Exigido» quiere decir que AtlasBackend lo pide por defecto y sin él una decisión muere con
`ACTIVE_DEPLOYMENT_NOT_FOUND`. El verificador comprueba los exigidos; con `--todos`, también los
demás salvo los de demostración.

## Añadir un artefacto nuevo

1. Su definición en `scripts/lib/<nombre>.definicion.json` y su guion en `scripts/<nombre>.mjs`, con
   las mismas banderas que los demás (`--base`, `--tenant`, `--environments`, `--dry-run`,
   `--deploy <versionId>`).
2. Una fila en `scripts/lib/artefactos.manifiesto.json`.
3. Una fila en la tabla de arriba.

`test/publicar-todos-los-artefactos.spec.ts` falla si existe una definición sin fila en el
manifiesto, así que el paso 2 no se puede olvidar.

Campos de una fila del manifiesto:

| Campo | Para qué |
|---|---|
| `codigo` | El `artifactCode`; tiene que coincidir con el de la definición. |
| `guion`, `definicion` | Nombres de archivo en `scripts/` y `scripts/lib/`. |
| `decide` | Una frase para personas. |
| `variableDeAtlasBackend` | La variable `DECISION_ENGINE_*_ARTIFACT` que lo apunta, o `null`. |
| `exigido` | Si el verificador lo pide por defecto. |
| `demo` | Si queda fuera salvo que se pida. |
| `banderasAlCrear` | Lo que el guion necesita cuando el artefacto no existe. |
| `banderasNuevaVersion` | Lo que necesita para publicar una versión nueva; `null` si no sabe. |
| `estadosQueReanuda` | Estados de versión que el guion sabe continuar sin duplicar nada. |
| `requisito` | Aviso que se imprime antes de correrlo, o `null`. |

## Trampas

- **`--nueva-version` con crédito siempre clona.** `atlas-underwriting-v2.mjs` no compara la
  definición del repo con la desplegada: si se pide versión nueva y nada cambió, queda una versión
  idéntica esperando firmas. Usar `--solo` con los códigos que de verdad cambiaron.
- **Publicado no es desplegado.** Tras el paso 3 el catálogo ya lista los artefactos y el portal
  dice «Existe en el motor», pero sin las firmas y el paso 5 el Motor sigue sin decidir. El paso 6
  con `--exigir-despliegue` es el que lo distingue.
- **Identidad sembrada.** Un entorno inicializado con `sembrar-despliegue.mjs` deja la versión de
  identidad en `COMPILED` con despliegue activo; el guion la cuenta como «ya decide».
- **Producción no usa semillas de base.** Va por este mismo camino para que cada artefacto pase por
  revisión, auditoría y aprobación.
