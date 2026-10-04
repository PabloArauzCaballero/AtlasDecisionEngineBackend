# Solicitud del titular: corregir un dato o borrar la cuenta

Artefacto `PRIVACIDAD_SOLICITUD_TITULAR`, de tipo `DATA_SUBJECT_RIGHTS`. Decide qué pasa con una
solicitud de la persona sobre sus propios datos: **aceptarla**, **rechazarla** por una imposibilidad
objetiva o mandarla a **revisión humana**. Ante cualquier duda, la decisión es de una persona.

## Por qué existe

En Bolivia no hay una ley general de protección de datos, pero el derecho existe: la Constitución
(art. 130) deja a cualquiera exigir ante un juez que se **rectifiquen o eliminen** sus datos. A la
vez, la Ley 393 (art. 34.III) y el DS 4904 (art. 18) obligan a conservar 10 años las operaciones y
la diligencia debida. Decidir a mano, solicitud por solicitud, es lento y desigual; decidir con una
regla escondida en el backend no se puede auditar. Este artefacto pone el criterio en un sitio con
versión, casos de prueba y dos firmas.

## Lo que decide

Se evalúa de arriba abajo y **la primera regla que aplica manda**. Si ninguna aplica, la salida por
defecto del nodo `DECIDIR` es la revisión humana.

**Borrar la cuenta**

| # | Si… | Decide | Motivo | Acción |
| --- | --- | --- | --- | --- |
| B1 | fraude abierto, o reclamo/caso de soporte abierto | revisión humana | `DSR_CASO_ABIERTO` | — |
| B2 | contacto o dispositivo nuevos en 7 días, o sin PIN confirmado | revisión humana | `DSR_POSIBLE_ROBO_DE_CUENTA` | — |
| B3 | ya hay un borrado en curso | rechaza | `DSR_YA_EN_CURSO` | — |
| B4 | saldo, préstamo activo, mora o pago por conciliar | rechaza | `DSR_BORRADO_CON_DEUDA` | — |
| B5 | extracto bancario en revisión | revisión humana | `DSR_PROCESO_EN_CURSO` | — |
| B6 | cuenta bloqueada, suspendida o cerrada | revisión humana | `DSR_ESTADO_DE_CUENTA` | — |
| B7 | operó con crédito o verificó identidad | acepta | `DSR_BORRADO_CON_RETENCION` | `CERRAR_Y_ANONIMIZAR` |
| B8 | nunca operó ni verificó identidad | acepta | `DSR_BORRADO_TOTAL` | `BORRAR_TODO` |

**Corregir un dato**

| # | Si… | Decide | Motivo | Acción |
| --- | --- | --- | --- | --- |
| R1 | fraude abierto o contacto cambiado en 7 días | revisión humana | `DSR_POSIBLE_ROBO_DE_CUENTA` | — |
| R2 | el dato es el teléfono o el correo | rechaza | `DSR_USAR_AUTOSERVICIO` | `AUTOSERVICIO` |
| R3 | nombre, apellido, nacimiento o documento | revisión humana | `DSR_CAMBIO_DE_IDENTIDAD` | — |
| R4 | ocupación, empleador o ingreso | revisión humana | `DSR_AFECTA_CREDITO` | — |
| R5 | un dato fuera de la lista | revisión humana | `DSR_CAMPO_NO_CATALOGADO` | — |
| R6 | tercera corrección del mismo dato en un año | revisión humana | `DSR_CAMBIOS_REPETIDOS` | — |
| R7 | domicilio, con identidad verificada, PIN confirmado y sin dispositivo nuevo | acepta | `DSR_CORRECCION_BAJO_RIESGO` | `CORREGIR` |
| R8 | el resto | revisión humana | `DSR_SIN_CRITERIO_AUTOMATICO` | — |

Tres decisiones de diseño que no se ven en la tabla:

1. **Sólo se rechaza por imposibilidad objetiva** (deuda, duplicada, autoservicio). Atlas acompaña
   cada rechazo con «Pedir que lo revise una persona»: una decisión automática se anuncia como tal y
   se puede revisar.
2. **Teléfono y correo se rechazan, no se derivan**: ya tienen su camino seguro, con un código al
   contacto nuevo. Por esta vía alguien se saltaría esa verificación.
3. **Aceptar un borrado no es borrarlo todo.** Quien operó o verificó identidad se cierra y se
   anonimiza lo borrable; lo que la ley obliga a guardar se retiene 10 años desde el cierre y no se
   usa para nada más. Decidir no es ejecutar: el ejecutor está en AtlasBackend.

## Entradas

Ninguna es un dato personal: booleanos, contadores, el saldo y el **código** del dato a corregir.
El valor nuevo de una corrección vive cifrado en AtlasBackend y no sale de allí.

| Variable | Tipo |
| --- | --- |
| `dsr_tipo` | `RECTIFICACION` / `BORRADO` |
| `dsr_cuenta_operativa`, `dsr_identidad_verificada`, `dsr_pin_confirmado` | BOOLEAN |
| `dsr_contacto_cambiado_7d`, `dsr_dispositivo_nuevo_7d`, `dsr_fraude_abierto`, `dsr_caso_abierto` | BOOLEAN |
| `dsr_solicitudes_iguales_abiertas`, `dsr_prestamos_activos`, `dsr_cuotas_en_mora`, `dsr_pagos_en_conciliacion` | INTEGER |
| `dsr_saldo_pendiente` | CURRENCY |
| `dsr_tuvo_credito`, `dsr_extracto_en_revision` | BOOLEAN |
| `dsr_campo` | código de la lista cerrada (`NINGUNO` en un borrado) |
| `dsr_cambios_del_campo_365d` | INTEGER |

Salidas: `dsr_decision`, `dsr_motivo`, `dsr_accion`, `dsr_reevaluar_credito` (la corrección toca un
dato de la línea) y `dsr_senales_riesgo` (cuántas señales de cuenta robada traía).

## Por qué `DATA_SUBJECT_RIGHTS`

Sin tipo, un artefacto es `ORIGINATION` y producción le exige publicar una probabilidad de
incumplimiento (`ECONOMIC_CONTRACT_NO_PD`). Una solicitud de privacidad no origina crédito: lo
honesto es decirlo en el esquema, no inventar un contrato económico. El tipo se añadió al enum en
la migración `20261004120000_decision_kind_data_subject_rights` y `POST /v1/artifacts` lo acepta en
`decisionKind`.

## Dónde vive y cómo se publica

- Definición: `scripts/lib/privacidad-solicitud-titular.definicion.json`.
- Guion: `scripts/privacidad-solicitud-titular.mjs` (idempotente, `--dry-run`, `--deploy`).
- Prueba: `test/privacidad-solicitud-titular.spec.ts`, con el validador, el compilador y el motor
  reales; además de los 32 casos, comprueba sobre 600 solicitudes al azar que ninguna combinación
  acepta lo que la política reserva a una persona.

Publicar sigue `docs/runbooks/artefactos-en-un-entorno-nuevo.md`: el guion lo deja en revisión, dos
personas lo firman (QA y riesgo, ninguna la autora) y una tercera lo despliega. Se publica en
**sombra**: AtlasBackend guarda lo que decidió y una persona sigue cerrando cada solicitud hasta que
el acuerdo medido (≥ 30 solicitudes, ≥ 95 % de acuerdo, ningún «aceptar» que la persona rechazó)
respalde darle autoridad. Cuando AtlasBackend empiece a pedirlo, entra en la lista por defecto de
`scripts/verificar-artefactos-publicados.mjs`.
