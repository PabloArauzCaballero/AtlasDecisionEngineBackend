# IDENTIDAD_CARNET_MOVIL 1.2.0 · identidad con la bitácora del alta

Verifica la identidad de quien se registra desde la app: llama al worker de identidad (lee el
carnet, comprueba que lo sea y compara su retrato con la selfie) y aplica la política de aceptación.
Desde la **1.2.0** (2026-09-18) recibe además **cómo se hizo el alta**.

- Definición: [`scripts/lib/identidad-carnet-movil.definicion.json`](../../scripts/lib/identidad-carnet-movil.definicion.json)
- Publicación por la API de gestión: [`scripts/identidad-carnet-movil.mjs`](../../scripts/identidad-carnet-movil.mjs)
- Ejecutada con el motor real: [`test/identidad-carnet-movil.spec.ts`](../../test/identidad-carnet-movil.spec.ts)
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
