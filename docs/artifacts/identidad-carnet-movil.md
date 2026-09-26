# IDENTIDAD_CARNET_MOVIL 1.2.0 · identidad con la bitácora del alta

Verifica la identidad de quien se registra desde la app: llama al worker de identidad (lee el
carnet, comprueba que lo sea y compara su retrato con la selfie) y aplica la política de aceptación.
Desde la **1.2.0** (2026-09-18) recibe además **cómo se hizo el alta**.

- Definición: [`scripts/lib/identidad-carnet-movil.definicion.json`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/scripts/lib/identidad-carnet-movil.definicion.json)
- Publicación por la API de gestión: [`scripts/identidad-carnet-movil.mjs`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/scripts/identidad-carnet-movil.mjs)
- Ejecutada con el motor real: [`test/identidad-carnet-movil.spec.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/test/identidad-carnet-movil.spec.ts)
- Quien la llama: `AtlasBackend/src/modules/mobile-identity/mobile-identity.service.ts`

## De dónde sale

La 1.1.1 la sembró `seed.system` el 2026-08-23 en la base de DEV y **no existía en el repositorio**:
un cambio suyo no se podía revisar en un PR, y TEST (Contabo) no tenía ninguna versión. La 1.2.0 es
esa versión exportada de DEV (siete nodos, seis aristas, tres condiciones) más lo que sigue.

## Qué entra de nuevo: nueve variables opcionales

AtlasBackend resume la bitácora de toques y tiempos de la app (`onboarding_behavior_summaries`,
`behavior-summary-v1`) y la manda como `identidad_comportamiento_*`: disponible, segundos totales,
segundos en la fase de identidad, pegado en campos de identidad, correcciones sobre lo leído por el
OCR, tasa de errores, captura interrumpida (cámara abierta y la app al fondo), altas abandonadas
antes, y `bot_score` (0-1). **Todas opcionales**: sin bitácora —app vieja, cola perdida— viajan en
`null` y la decisión es exactamente la de la 1.1.1. Ausencia = menos evidencia, nunca en contra.

## Qué cambia en el grafo

Tres derivaciones a revisión humana (cola `IDENTIDAD`, prioridad 40), evaluadas **después** de los
dos rechazos del worker y **antes** de la aprobación:

| Arista | Condición | Motivo |
|---|---|---|
| `E_MECANICO` | pegado en carnet **y** 0 correcciones **y** fase de identidad < 40 s | `COMPORTAMIENTO_IDENTIDAD_MECANICO` |
| `E_CAPTURA` | la app pasó a segundo plano con la cámara abierta | `CAPTURA_INTERRUMPIDA` |
| `E_AUTOMATIZADO` | `bot_score ≥ 0,7` | `COMPORTAMIENTO_AUTOMATIZADO` |

Ninguna rechaza: **el comportamiento escala, no niega**. Y el rechazo del worker manda sobre
cualquier señal (`ID-MECANICO-Y-NO-COINCIDE-RECHAZA`). La evidencia del caso lleva las cifras de la
bitácora para quien lo revise. Salida nueva: `identidad_senal_comportamiento` (`NINGUNA` o la señal).

## Los diez casos

`ID-HUMANO-VERIFICA`, `ID-SIN-BITACORA-VERIFICA` (regresión de la 1.1.1), `ID-MECANICO-REVISA`,
`ID-CAPTURA-INTERRUMPIDA-REVISA`, `ID-BOT-069-VERIFICA`, `ID-BOT-070-REVISA` (el corte),
`ID-NO-COINCIDE-RECHAZA`, `ID-DOC-INVALIDO-RECHAZA`, `ID-DUDOSO-REVISA`,
`ID-MECANICO-Y-NO-COINCIDE-RECHAZA`. La suite `IDENTIDAD-DESENLACES` es bloqueante.

## Dos cortes, dos canales: de dónde sale cada umbral

Hay DOS sitios que deciden «¿es la misma persona?», con cortes distintos y que no se enteran uno del
otro. Confundirlos es como se acaba calibrando uno y creyendo que se calibró el otro.

| Canal | Quién decide | Corte | Dónde se cambia |
|---|---|---|---|
| **Móvil** (la app del cliente → `POST /mobile/identity-verifications` → este artefacto) | El **grafo** de esta definición, sobre lo que devuelve el worker | Su propio corte: parecido ≥ **0,82** y evidencia del documento ≥ **0,7**, en la condición `IDENTIDAD_CONFIRMADA` (`scripts/lib/identidad-carnet-movil.definicion.json`); no dependen del entorno | Una **versión nueva del artefacto**, con sus dos firmas en el portal del Motor |
| **Directo al worker** (el trabajo `identity-verification` de `/v1/workers`, sin pasar por el grafo) | El motor de decisión del worker (`identity-decision.engine.ts`) | `IDENTITY_MATCH_THRESHOLD` (aceptar) e `IDENTITY_REVIEW_THRESHOLD` (rechazar por debajo) | Variables de entorno del servicio del Motor (Coolify) |

Estado a **2026-09-25**: `IDENTITY_MATCH_THRESHOLD` e `IDENTITY_REVIEW_THRESHOLD` están **ausentes** en
las variables de entorno (`docker-compose.yml` dejó de inyectarlas: ver `.env.example`). Sin ellas, todo
veredicto del worker sale `REVIEW_REQUIRED` con `THRESHOLD_PROFILE_MISSING` y cae en la cola humana: es
el comportamiento seguro y honesto, no una avería. Los únicos valores de referencia (0,8824 / 0,7789)
se calibraron con rostros sintéticos y **rechazarían a un titular real** (0,693 con carnet y selfie
auténticos), así que no hay que copiarlos. **Ponerlos es de Pablo** (son variables del host); este
documento no propone cifras: salen de `scripts/calibrar-identidad.mjs --documento-selfie` sobre casos
reales.

**Ojo: el corte del grafo NO sustituye al del worker, se le suma.** La única arista que aprueba
(`APROBAR`, vía `IDENTIDAD_CONFIRMADA`) exige que el veredicto del worker (`result.decision`) sea
`VERIFIED` **y además** que el parecido y la evidencia pasen 0,82 / 0,7; y el rechazo del canal móvil
(`IDENTIDAD_NO_COINCIDE`) sólo salta con el `NOT_VERIFIED` del worker. Las llamadas del grafo no pasan
umbrales al worker: los toma del entorno. Consecuencia práctica hoy: mientras las variables falten, el
canal móvil tampoco puede aprobar ni rechazar solo —todo cae por `REVISAR` a la cola `IDENTIDAD`—, y
cuando existan, el corte efectivo de aprobación móvil será el **más estricto** de los dos
(`max(IDENTITY_MATCH_THRESHOLD, 0,82)` sobre el parecido).

**Si se calibra, se cambian los dos en la misma tanda**: las variables de entorno (las lee el worker
para los dos canales) y, si el corte del grafo debe moverse, una versión nueva de este artefacto con dos
firmas. Calibrar sólo uno deja a los dos canales con criterios distintos para la misma persona.

## Cómo se publica

```
MANAGEMENT_API_KEY=… node scripts/identidad-carnet-movil.mjs --base http://127.0.0.1:3020
```

crea (o reutiliza) el artefacto y sus variables, escribe el grafo, compila, corre la suite y manda
la versión a revisión. Aprobar es de dos personas en el portal; después,
`--deploy <versionId> --environments DEV,TEST`. En un entorno **sin ningún artefacto** —TEST de
Contabo el 2026-09-18— el primer despliegue se siembra como se sembró DEV
(`scripts/sembrar-despliegue.mjs`): deployment + binding con `deployed_by = seed.system`, sólo si
no existe binding para ese ambiente. A partir de ahí, todo cambio pasa por gobierno.
