# Verificación del expediente del comercio (KYB)

Artefacto `PARTNER_KYB_REVIEW`. Decide si un comercio puede empezar a operar: aprueba el
expediente completo y sin señales, manda a revisión manual el que exige criterio humano, y
rechaza el que no cubre los requisitos que impiden cobrar.

## Por qué existe

El expediente del comercio ya sabía decir qué le faltaba —matrícula, representante con su poder,
sucursal, los dos QR—, pero esa lista vivía dentro del backend de altas y no se ejecutaba en
ninguna parte. No había artefacto, así que no había versión, ni traza, ni ejecución que enseñar,
ni forma de mover un umbral sin tocar código. Decidir si un comercio puede cobrar dinero de sus
clientes es exactamente la clase de decisión que este motor existe para gobernar.

## Lo que decide, y lo que no

| Desenlace | Cuándo | Motivo publicado |
| --- | --- | --- |
| `RECHAZADO` | Falta al menos un requisito duro | `KYB_REQUISITOS_INCOMPLETOS` |
| `REVISION_MANUAL` | Completo, pero con señales operativas | `KYB_SENALES_OPERATIVAS` |
| `APROBADO` | Completo y sin señales | `KYB_COMPLETO` |

**No aprueba lo que exige criterio humano.** Un expediente completo con el correo sin verificar,
sin ninguna sucursal declarada o abierto hace demasiado tiempo sale a `REVISION_MANUAL`: la
aprobación de un comercio la firma una persona, y lo que el artefacto aporta es decirle a esa
persona qué mirar y por qué.

## Entradas

Son booleanas a propósito y no «el documento» en sí: lo que el motor decide es si el requisito
está cubierto. Quién guarda la evidencia —con su hash y su trazabilidad— es el expediente en
AtlasBackend. Copiar aquí el número de matrícula o la cuenta bancaria sería duplicar datos
personales del comercio en un segundo sitio para no usarlos.

| Variable | Tipo | Qué significa |
| --- | --- | --- |
| `kyb_tiene_matricula` | BOOLEAN | La empresa declaró su matrícula de comercio |
| `kyb_representante_acreditado` | BOOLEAN | Hay representante **y** su poder está subido |
| `kyb_qr_negocio` | BOOLEAN | QR del negocio registrado |
| `kyb_qr_bancario` | BOOLEAN | QR de cobro registrado: a qué cuenta va el dinero |
| `kyb_correo_verificado` | BOOLEAN | El correo del expediente respondió al código |
| `kyb_sucursales` | INTEGER | Cuántos locales declaró |
| `kyb_antiguedad_dias` | INTEGER | Días desde que se abrió el expediente |

## Las dos reglas que lo hacen útil

1. **Los requisitos duros no se compensan.** Los cuatro primeros se suman en la intermedia
   `requisitos_faltantes`, y cualquiera que falte rechaza — por impecable que esté todo lo demás.
   Sin esta regla, un expediente perfecto salvo el QR bancario podría aprobarse: habilitar a
   cobrar a un comercio que no ha dicho a qué cuenta va el dinero.
2. **Las señales nunca aprueban solas.** `senales_operativas` cuenta el correo sin verificar, la
   ausencia de sucursales y la antigüedad por encima de 120 días. No bloquean, pero desvían a una
   persona.

El umbral de antigüedad (120 días) es lo primero que hay que recalibrar con expedientes reales:
está en `DIAS_PARA_CONSIDERAR_ANTIGUO`, en el grafo.

## Dónde vive

El grafo se fue con el resto de las semillas en `c4084c9` y volvió al repositorio como guiones que
van por la API de gestión (`1ce53cc`). Hoy hay dos piezas, una por versión:

| Pieza | Qué hace | Prueba que la ejecuta |
| --- | --- | --- |
| `scripts/partner-kyb-review.mjs` + `scripts/lib/partner-kyb-review.definicion.json` | Crea desde cero la versión base, la que está desplegada (REVISAR como `RESULT`). Sirve para un Motor nuevo (TEST en Contabo) | `test/partner-kyb-review.spec.ts` |
| `scripts/kyb-revision-manual.mjs` | Prepara la versión siguiente: clona la vigente y cambia SÓLO el nodo REVISAR a `MANUAL_REVIEW` | `test/kyb-revision-manual.spec.ts` |

`test/partner-kyb-manual-review.spec.ts` es anterior: reconstruye el grafo a mano y compara las dos
formas de REVISAR. Sigue siendo válida como explicación del defecto.

Las dos pruebas de guion ejecutan el guion de verdad contra un Motor de gestión en miniatura,
validan cada cuerpo con los DTO reales, compilan lo escrito con el validador y el compilador del
Motor y corren la suite bloqueante con el ejecutor real. Los desenlaces esperados **no** están
escritos a ojo: un documento que afirma «este expediente se aprueba» y un motor que lo rechaza es
peor que no tener el artefacto, porque enseña una decisión que en producción no ocurre.

## Que la derivación a revisión ABRA el caso

Los tres desenlaces eran nodos `RESULT`, incluido el que se llama `REVISION_MANUAL`. Un `RESULT` no
abre nada: el caso en `decision_manual_review_case` sólo se crea desde un nodo `MANUAL_REVIEW`.
Medido contra el motor local el 2026-09-08, un expediente completo con el correo sin verificar
devolvía `outcome: REVISION_MANUAL` y **`manualReview: null`** — derivado a una persona que no tenía
dónde verlo. AtlasBackend guarda entonces `manual_review_case_code` vacío, su sincronización
(`sync_partner_kyb_reviews`) no tiene nada que consultar y el expediente se queda `under_review`
indefinidamente (hallazgo A12, proceso P-16).

```bash
MANAGEMENT_API_KEY=… node scripts/kyb-revision-manual.mjs [--dry-run]
```

Convierte `REVISAR` en un nodo `MANUAL_REVIEW` con cola propia `MERCHANT_KYB` —no `CREDIT_REVIEW`,
que mezclaría expedientes de comercio con solicitudes de crédito en la bandeja de otro equipo—,
prioridad 80, SLA de cuatro horas y la evidencia con las siete entradas y las dos intermedias.
Conserva `mode: MAPPING`, así que quien llama recibe las mismas salidas: AtlasBackend lee el
desenlace de `kyb_decision` (sigue siendo `REVISION_MANUAL`) y ahora recibe además
`manualReview.caseCode`. El resto del grafo —umbrales, condiciones, aristas, contrato de salida— no
cambia, y la prueba lo compara nodo a nodo contra la base.

La suite bloqueante son los **nueve** casos de la versión base; los que terminan en revisión
afirman además `outcome: MANUAL_REVIEW`, que sólo un nodo `MANUAL_REVIEW` produce. Es idempotente.

`MERCHANT_KYB` no avisa por callback (`RUTA_DE_CALLBACK_POR_COLA`): AtlasBackend trae la resolución
por tirón cada 5 minutos (`GET /v1/manual-reviews/:caseCode`).

**El guion se para antes de aprobar, y es deliberado.** Desplegar exige la versión aprobada, y las
dos aprobaciones llevan `separationOfDuties`: quien crea una versión no puede aprobarla. El guion la
crea, así que aprobar desde aquí —con la llave de gestión, que tiene todos los roles— sería
exactamente la puerta trasera que ese control cierra. No se crean aprobadores de máquina. Deja la
versión compilada y enviada a revisión; las dos firmas (QA_ANALYST y RISK_APPROVER) las ponen dos
personas distintas desde el portal del Motor (Gobierno → Revisiones). Una vez aprobada, una tercera
credencial (RELEASE_MANAGER) la despliega:

```bash
MANAGEMENT_API_KEY=… node scripts/kyb-revision-manual.mjs --deploy <versionId> --environments DEV,TEST
```

Desplegar escribe además el `decision_runtime_binding`: sin él, ejecutar responde
`ACTIVE_DEPLOYMENT_NOT_FOUND` aunque la versión esté compilada y desplegada.

### Los expedientes que ya están colgados

Desplegar la versión nueva **no** arregla los expedientes que ya recibieron `REVISION_MANUAL` sin
caso: su ejecución ya ocurrió y no abrió nada. Siguen `under_review` con `manual_review_case_code`
nulo. Dos salidas, ambas desde AtlasBackend:

- **Volver a verificarlos** con la versión nueva: `POST /api/v1/operations/partners/:partnerId/kyb-review`
  (permiso `partner.kyb.request`, admite `under_review`) con una `x-idempotency-key` NUEVA. La
  ejecución nueva abre el caso en `MERCHANT_KYB`, AtlasBackend guarda su código y la sincronización
  lo recoge. El ERP no puede pedirlo desde su pantalla: un caso suyo en `REVISION_MANUAL` ya no
  admite verificación.
- **Decidirlos a mano** en el portal admin (`decide`): sólo se permite mientras el expediente NO
  tiene caso del Motor, que es justo su situación. Queda con procedencia `DECISION_MANUAL_PORTAL`.

## Quién lo ejecuta

AtlasBackend, con el tipo de decisión `partner`. Lo dispara el envío del expediente
(`POST /api/v1/partner-onboarding/:partnerId/submit`) y, desde fuera,
`POST /api/v1/operations/partners/:partnerId/kyb-review`, que usan operaciones y el ERP. Las dos
llaman a la misma función: es lo que impide que existan dos formas de decidir lo mismo. Con el motor
caído, Atlas responde 503 y el expediente queda como estaba — no se decide en local.

## Ejecutarlo

```bash
curl -X POST http://127.0.0.1:3020/v1/decisions/PARTNER_KYB_REVIEW \
  -H "x-api-key: $RUNTIME_API_KEY" -H 'Content-Type: application/json' \
  -d '{"requestId":"kyb-expediente-7","idempotencyKey":"kyb-7-1","environmentCode":"DEV",
       "subjectReference":"partner-7",
       "variables":{"kyb_tiene_matricula":false,"kyb_representante_acreditado":false,
                    "kyb_qr_negocio":false,"kyb_qr_bancario":true,"kyb_correo_verificado":true,
                    "kyb_sucursales":1,"kyb_antiguedad_dias":20}}'
```

La ejecución queda en el portal (Ejecuciones) con su traza paso a paso, y desde ahí se descarga
como informe PDF.
