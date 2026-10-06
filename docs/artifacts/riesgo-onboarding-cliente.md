# RIESGO_ONBOARDING_CLIENTE 2.0.0 · riesgo del alta con reglas propias de fraude

Decide si el alta de un cliente sigue adelante o la mira una persona. **Nunca rechaza.**

- Definición: [`scripts/lib/riesgo-onboarding-cliente.definicion.json`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/scripts/lib/riesgo-onboarding-cliente.definicion.json)
- Publicación por la API de gestión: [`scripts/riesgo-onboarding-cliente.mjs`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/scripts/riesgo-onboarding-cliente.mjs)
- Ejecutada con el motor real: [`test/riesgo-onboarding-cliente.spec.ts`](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/test/riesgo-onboarding-cliente.spec.ts)
- Quien la llama: `AtlasBackend/src/modules/risk/` (`risk-policy-features.ts` arma las variables).

## De la 1.0.0 a la 2.0.0

La 1.0.0 era la heurística de AtlasBackend escrita como artefacto: sin documento o sin consentimiento,
a una persona; con ambos, sigue si `total_score ≥ 65`. Todo lo que el Motor sabía del alta eran diez
puntajes que el backend calculaba a partir de tres hechos.

La 2.0.0 conserva eso **sin cambios** y añade reglas PROPIAS sobre lo que AtlasBackend ya guarda de
cada alta: el dispositivo y la IP con que la persona inició sesión, el ritmo con que rellenó los
formularios y la agenda que trae.

## Quince entradas nuevas, todas opcionales

| Variable | Qué es |
|---|---|
| `device_emulator`, `device_rooted` | lo que dicen los snapshots del dispositivo |
| `location_mocked_pings` | posiciones que el sistema operativo marcó como simuladas |
| `device_shared_customers` | otras cuentas vinculadas al mismo dispositivo |
| `ip_customers_24h` | otras cuentas con sesión desde la misma IP pública en 24 h |
| `session_devices` | dispositivos distintos usados durante el alta |
| `behavior_bot_score` | heurística de automatización de la bitácora (0-1) |
| `rhythm_strong_signals`, `rhythm_medium_signals` | señales del cronómetro del alta |
| `contacts_available`, `contacts_total`, `contacts_days_since_last_new`, `contacts_signals` | la agenda: si se compartió, cuántos contactos, días desde el último contacto nuevo y cuántas señales de forma |
| `fraud_flags_strong`, `fraud_flags_medium` | el recuento del propio backend, como contraste |

Sin ellas —un backend anterior, un cliente sin agenda ni rastro— viajan en `null` y la decisión es
exactamente la de la 1.0.0. **Ausencia = menos evidencia, nunca en contra.**

## Cuatro derivaciones a una persona

Se evalúan **después** de la evidencia faltante y **antes** del umbral:

| Arista | Condición | Motivo | Prioridad de cola |
|---|---|---|---|
| `E_DISPOSITIVO_NO_CONFIABLE` | emulador **o** alguna posición simulada | `DEVICE_NOT_TRUSTED` | 95 |
| `E_DISPOSITIVO_O_RED_COMPARTIDOS` | dispositivo en ≥ 2 cuentas más **o** ≥ 8 cuentas desde la IP en 24 h **o** ≥ 3 dispositivos en el alta | `SHARED_DEVICE_OR_NETWORK` | 90 |
| `E_COMPORTAMIENTO_AUTOMATIZADO` | `behavior_bot_score ≥ 0,7` **o** alguna señal fuerte de ritmo | `AUTOMATED_BEHAVIOR` | 85 |
| `E_SENALES_ACUMULADAS` | `senales_medias ≥ 2` | `ACCUMULATED_FRAUD_SIGNALS` | 75 |

`senales_medias` es un intermedio: root + dispositivo compartido con UNA cuenta + 4 a 7 cuentas desde
la IP + señales medias de ritmo + señales de la agenda. Cada una tiene una explicación inocente
frecuente —un teléfono con root de un aficionado, la IP de la operadora, una agenda corta de un
teléfono nuevo—; dos a la vez ya no son casualidad.

Ninguno de los cuatro motivos es adverso: son un «lo mira una persona», no una negativa.

## Lo que hay que saber de los cortes

**No están medidos contra altas reales.** Son valores de partida (2 cuentas por dispositivo, 8 por IP,
3 dispositivos, 0,7, 2 señales). Por eso derivan y no rechazan. La evidencia del caso lleva todas las
cifras para que quien revise las vea y para poder contar, corte por corte, cuántas veces la persona
confirmó la sospecha. Mover un corte es una versión nueva con dos firmas.

Bolivia sale a internet por CGNAT: decenas de personas legítimas comparten IP con su operadora. De
ahí que la ráfaga fuerte sea 8 y que 4-7 sólo cuente como señal media
(`RIESGO-IP-OPERADORA-7-APRUEBA`).

## Los veintiún casos

Los seis de la 1.0.0, intactos, y quince nuevos: persona normal, emulador, ubicación simulada,
dispositivo en tres cuentas, ráfaga de IP, IP de operadora (no deriva), tres dispositivos, bot en el
corte y justo debajo, ritmo sobrehumano, una señal media (no deriva), dos señales medias, ritmo + IP,
agenda no compartida (no cuenta en contra) y emulador sin identidad (manda la evidencia faltante).
La suite `RIESGO-DESENLACES` es bloqueante.

## Publicarla sobre un entorno que ya decide con la 1.0.0

`node scripts/riesgo-onboarding-cliente.mjs --nueva-version --environments STAGING` clona la versión
desplegada —que sigue decidiendo—, escribe el grafo nuevo en el clon y lo deja en revisión de dos
personas (`QA_ANALYST` y `RISK_APPROVER`, ninguna la autora). Sin la bandera, el guion se comporta
como antes.
