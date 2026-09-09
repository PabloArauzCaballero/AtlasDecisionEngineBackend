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

**El grafo NO está en este repositorio.** Se fue con el resto de las semillas en `c4084c9`
(«Mover las semillas del repositorio a una rama de PostgreSQL»), así que un cambio suyo no se puede
revisar en un pull request: vive como filas en la base de semillas. Esta página describía tres
archivos —`partner-kyb.graph.ts`, `partner-kyb.seed.ts` y `test/partner-kyb-seed.spec.ts`— que
llevan borrados desde entonces.

Lo que sí existe y es auditable:

- **La prueba que lo ejecuta con el motor real**: `test/partner-kyb-manual-review.spec.ts`.
  Reproduce la forma del grafo —las dos intermedias, las dos condiciones, las cuatro salidas— y
  comprueba cada desenlace contra el ejecutor, no de palabra. Es lo más cerca que se puede estar
  hoy de revisar este artefacto en un PR.
- **El guion que publica una versión nueva**: `scripts/kyb-revision-manual.mjs`, que va por la API
  de gestión con los mismos permisos y la misma auditoría que un cambio hecho a mano.

Los desenlaces esperados **no** están escritos a ojo: la prueba los ejecuta contra el motor y falla
si difieren. Un documento que afirma «este expediente se aprueba» y un motor que lo rechaza es peor
que no tener el artefacto, porque enseña una decisión que en producción no ocurre.

## Que la derivación a revisión ABRA el caso

Los tres desenlaces eran nodos `RESULT`, incluido el que se llama `REVISION_MANUAL`. Un `RESULT` no
abre nada: el caso en `decision_manual_review_case` sólo se crea desde un nodo `MANUAL_REVIEW`.
Medido contra el motor local el 2026-09-08, un expediente completo con el correo sin verificar
devolvía `outcome: REVISION_MANUAL` y **`manualReview: null`** — derivado a una persona que no tenía
dónde verlo.

```bash
MANAGEMENT_API_KEY=… node scripts/kyb-revision-manual.mjs [--dry-run]
```

Convierte `REVISAR` en un nodo `MANUAL_REVIEW` con cola propia `MERCHANT_KYB` —no `CREDIT_REVIEW`,
que mezclaría expedientes de comercio con solicitudes de crédito en la bandeja de otro equipo—,
prioridad 80, SLA de cuatro horas y la evidencia con las siete entradas y las dos intermedias.
Conserva `mode: MAPPING`, así que quien llama recibe las mismas salidas. Es idempotente.

**El guion se para antes de desplegar, y es deliberado.** Desplegar exige la versión aprobada, y las
dos aprobaciones llevan `separationOfDuties`: quien crea una versión no puede aprobarla. El guion la
crea, así que aprobar desde aquí —con la llave de gestión, que tiene todos los roles— sería
exactamente la puerta trasera que ese control cierra. Deja la versión compilada y enviada a
revisión, y dice qué falta y quién puede hacerlo. Una vez aprobada por dos personas distintas:

```bash
MANAGEMENT_API_KEY=… node scripts/kyb-revision-manual.mjs --deploy <versionId>
```

Desplegar escribe además el `decision_runtime_binding`: sin él, ejecutar responde
`ACTIVE_DEPLOYMENT_NOT_FOUND` aunque la versión esté compilada y desplegada.

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
