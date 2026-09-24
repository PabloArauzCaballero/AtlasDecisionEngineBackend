# Decisiones de política tomadas al implementar el plan de cumplimiento

Cada entrada dice qué se decidió, qué alternativa se descartó, qué rol debe ratificarlo y cómo se
cambia. Los valores por defecto son **conservadores**: fallan cerrado o mandan a revisión humana;
ninguno aprueba de forma implícita. Roles del plan: M = responsable motor, C = responsable Core,
R = negocio/riesgo/finanzas, J = legal/privacidad.

## P-09 · Sujeto y base habilitante exigibles (B11)

### D-09.1 Tabla finalidad → base habilitante (ratifica **J**)

| Situación de la versión desplegada | Requisito que exige el motor | Si falta |
| --- | --- | --- |
| Declara `enablingBasisPolicy` | Lo declarado: por finalidad, bases aceptadas y, opcionalmente, versiones del texto | Lo declarado (`REVIEW` por omisión, o `BLOCK`) |
| No declara política, origina crédito (`CREDIT_ORIGINATION`) y declara `legalBasis = CONSENT` | `credit_underwriting` con base `CONSENT` **únicamente** | `REVIEW` |
| No declara política, origina crédito y declara otra `legalBasis` (p. ej. `CREDIT_PROTECTION`) | `credit_underwriting` con esa base **o** `CONSENT` | `REVIEW` |
| No declara nada, origina crédito y el ambiente es de producción | `credit_underwriting` con `CREDIT_PROTECTION`, `CONTRACT` o `CONSENT` | `ENABLING_BASIS_UNDECLARED_ORIGINATION` (por omisión `REVIEW`) |
| Cualquier otro caso (no origina, o sandbox sin declaración) | Ninguno | — |

- `credit_underwriting` es la finalidad que el core ya registra (`CREDIT_DECISION_PURPOSE`). No se
  inventó un código nuevo.
- **No** se impone consentimiento como única base en todos los procesos: sólo donde el artefacto
  declara `CONSENT`. La evaluación crediticia se ampara por defecto en protección del crédito o
  contrato, como ya documentaba el core.
- Motivos distinguibles por finalidad: `SUBJECT_REFERENCE_MISSING`, `NO_BASIS_RECORDED`
  (ausente), `PURPOSE_NOT_COVERED` (hay registros, no para esta finalidad), `BASIS_NOT_ACCEPTED`,
  `VERSION_NOT_ACCEPTED`, `NOT_YET_GRANTED`, `EXPIRED`, `REVOKED`.
- Un permiso REGISTRADO revocado, vencido o todavía no vigente sigue bloqueando con 403
  `SUBJECT_CONSENT_INVALID` aunque la decisión no lo necesite (control anterior, no se relaja).
- **Alternativa descartada:** exigir `CONSENT` siempre. Rechazada porque el plan lo prohíbe y
  porque dejaría al motor sin poder decidir sobre un préstamo vivo tras una revocación de una
  finalidad opcional.
- **Ratificación pendiente (J):** la tabla anterior, las bases aceptadas por finalidad y si alguna
  finalidad opcional (extracto bancario, buró, biometría) debe exigirse por defecto en algún
  artefacto. Hasta entonces rige esta tabla.

### D-09.2 Qué hace «REVIEW» (ratifica **R** y **J**)

Con base ausente y política `REVIEW`, el grafo **no se ejecuta** (ejecutarlo sería tratar el dato
sin base). Se escribe una ejecución `NO_DECISION` sin variables de entrada, con un error por
finalidad, y se responde **422** con `status: NO_DECISION`, `reasonCodes[0].code =
ENABLING_BASIS_MISSING`, `adverseAction: false`. Es la misma forma que el `NO_DECISION` por
variables: el core la lee como revisión, nunca como aprobación ni como rechazo crediticio. La
respuesta queda en la caché de idempotencia: tras registrar la base hay que decidir con una
clave nueva. `BLOCK` responde 403 `ENABLING_BASIS_INVALID`.

**Alternativa descartada:** ejecutar el grafo y marcar la decisión. Rechazada porque procesa el
dato sin base.

### D-09.3 Sujeto no materializado y réplica de bases (ratifica **C**)

- `POST /v1/risk-governance/consents` y `/revoke` **materializan** el titular si el motor aún no
  lo conoce (antes: `SUBJECT_NOT_FOUND`). El core debe registrar la base **antes** de la primera
  decisión.
- Sin `subjectReference` una política que exige base no se puede satisfacer
  (`SUBJECT_REFERENCE_MISSING`); con referencia pero sin fila en el motor, la exposición es cero
  pero lo pedido se compara con el límite, y no hay bases registradas.
- Réplicas fuera de orden: un alta con `grantedAt` ≤ revocación vigente, o anterior al alta
  vigente, es `409 CONSENT_GRANT_REPLAYED`; una revocación con `revokedAt` anterior a un alta
  posterior es `409 CONSENT_REVOCATION_STALE`; una revocación sin registro previo deja una
  **lápida** revocada. Entre dos revocaciones vale la más temprana. El core debe tratar esos 409
  como terminales (la réplica ya está superada), no reintentarlos.
- `RevokeConsentDto.revokedAt` (opcional) permite fechar la revocación cuando el motor estuvo
  caído. `RecordConsentDto.consentVersion` (opcional) guarda la versión del texto.
- Credenciales: no se amplía ningún scope de runtime. Las bases se registran por el plano de
  gestión (roles `COMPLIANCE`/`OPERATIONS`), como ya hacía el core.

### D-09.4 Riesgo de despliegue (decide **M** con **C**)

Con `ENABLING_BASIS_UNDECLARED_ORIGINATION=REVIEW` por omisión, toda decisión de originación en
un ambiente de producción cuyo titular no tenga `credit_underwriting` registrado sale
`NO_DECISION`. El core actual registra esa base **después** de la primera decisión, así que hasta
que cambie ese orden los solicitantes nuevos irán a revisión. Volver al comportamiento anterior es
explícito y visible: `ENABLING_BASIS_UNDECLARED_ORIGINATION=ALLOW_LEGACY`.

## P-10 · Salidas económicas inválidas y frescura desconocida (B13, B14)

### D-10.1 Salida económica fuera de rango (ratifica **R**)

Una salida fuera del rango de su rol (PD/LGD fuera de [0,1], importes negativos o no finitos,
plazo fuera de [1,600], tasa fuera de [0,10]) o del rango de la POLÍTICA declarado en el contrato
de salida (`policyMinValue`/`policyMaxValue`, nuevo), o un `limit` de primer nivel negativo o no
finito, produce: ejecución escrita con el resultado completo del grafo, estado `NO_DECISION`, un
error `ECONOMIC_OUTPUT` por salida, sin caso de revisión manual; respuesta **422** `NO_DECISION`
con `ECONOMIC_OUTPUT_INVALID` (categoría `TECHNICAL`, `adverseAction: false`) y sin `output`.
No se añadió ningún valor nuevo al contrato: `NO_DECISION` ya existía y el core ya lo trata como
revisión. **Alternativa descartada:** 200 con un estado nuevo `REVIEW_REQUIRED`; rechazada porque
un consumidor que sólo mire `outcome` seguiría viendo el `APPROVED` del grafo.

### D-10.2 Frescura (ratifica **R**)

| Caso | Política |
| --- | --- |
| Sello futuro (más de 60 s por delante del reloj de la decisión) o ilegible | Nunca «sin fecha»: la política de la variable (`REJECT` rechaza con `VARIABLE_TIMESTAMP_FUTURE`/`_INVALID`, `DEGRADE` marca, `IGNORE` anota), haya SLA o no |
| Variable crítica (`FAIL`/`FAIL_CLOSED` → `REJECT`) sin sello o sin SLA positivo | Frescura DESCONOCIDA: `FRESHNESS_UNKNOWN_POLICY` (por omisión `DEGRADE`: se decide marcada; `REJECT`: `NO_DECISION`; `MEASURE`: sólo anota) |
| Variable crítica cuyo origen esperado es la propia petición (`expectedOrigin = REQUEST`) | No aplica frescura desconocida (lo declarado al pedir es cierto al pedir) |
| Dato vencido (antigüedad > SLA) | Como antes: `REJECT` rechaza con `VARIABLE_STALE`, `DEGRADE` marca |
| Variable no crítica sin sello o sin SLA | Como antes: se anota |

- Corrección de un defecto: `freshnessPolicyOf` comparaba con `'FAIL'` y las dependencias escriben
  `'FAIL_CLOSED'`, así que el `REJECT` era inalcanzable. Ahora `FAIL_CLOSED` es crítica.
- La respuesta añade `degradedInputs` y `freshnessUnknown` (códigos de variables críticas de
  frescura desconocida). **El core no debe originar con `freshnessUnknown` no vacío** (P-10,
  último punto del plan); hoy el core no envía `variableMetadata`, así que toda variable crítica
  con fuente declarada saldrá desconocida hasta que lo haga.
- **Alternativa descartada:** `REJECT` por omisión para frescura desconocida. Rechazada porque,
  sin sellos del core, pararía toda la originación; `DEGRADE` + bloqueo en quien concede cumple el
  plan sin esconder nada. Se endurece con `FRESHNESS_UNKNOWN_POLICY=REJECT`.

### D-10.3 Reloj inyectado

Un único instante por petición (`DECISION_CLOCK`, por omisión el reloj del sistema) para la
vigencia de la base, la frescura (incluido qué es «futuro»), el vencimiento de la decisión, las
ventanas de observación y el plazo del caso de revisión.

## P-11 · Exposición concurrente y circuito de desenlaces (B15), lado motor

### D-11.1 El motor no reserva; publica y caduca (ratifica **R** y **C**)

El dueño de la concesión es el core. El motor sigue leyendo la exposición de `credit_facility` sin
reservar (dos decisiones simultáneas que caben por separado pasan las dos: está reproducido en
`test/exposure-reservation.integration.spec.ts`). Lo que añade, aditivo:

- `exposure`: `{limitCode, currencyCode, maxValue, enforced, currentExposure, requestedAmount,
  remainingBeforeDecision, remainingAfterDecision}` del límite `SUBJECT_TOTAL` más estrecho
  (o `null` sin límites activos). Ahora se publica también con límites no `enforced`.
- `decisionValidUntil`: `now + DECISION_VALIDITY_SECONDS` (por omisión **259200 s = 72 h**, igual que `CREDIT_DECISION_VALIDITY_HOURS` de Core; a ratificar por R), sólo en
  `SUCCEEDED`; `null` en cualquier otro estado. Una réplica idempotente devuelve el MISMO valor.
- El valor por defecto de una hora lo ratifica **R**; es configurable.

### D-11.2 Registro de créditos y desenlaces (ratifica **R**)

- `POST /v1/outcomes/facilities`: idempotente por `(tenant, externalReference)`. Un reenvío con
  la misma decisión de origen actualiza sólo los datos del desembolso y vuelve `duplicate: true`;
  citando OTRA decisión u otro titular es `FACILITY_REFERENCE_CONFLICT` y no se reasigna nada.
  Sólo se admiten decisiones `SUCCEEDED` (`EXECUTION_NOT_DECIDED` si no). Cada fila en su propia
  transacción: un fallo de escritura vuelve como `FACILITY_REGISTRATION_FAILED` y el lote sigue.
- `POST /v1/outcomes/batch`: un desenlace idéntico a uno ya observado (misma etiqueta, importe y
  método de inferencia) se acepta como `duplicate: true` **sin reescribir, sin mover `observedAt`
  y sin contar en la métrica**; uno distinto para la misma ventana es `OUTCOME_CONFLICT`. La
  ventana se cierra también en los reenvíos si seguía abierta. **Alternativa descartada:** que el
  reenvío sobrescriba (comportamiento anterior): reescribía evidencia en silencio y volvía a contar.
- Una corrección legítima de un desenlace ya observado necesita un proceso explícito que hoy no
  existe (pendiente, **R**).

## P-16 · Rendimiento propio del runtime (B18)

### D-16.1 Límite operativo inicial: 4 decisiones concurrentes por réplica (ratifican **S** y **R**)

Medido en un Mac de desarrollo compartido (`docs/observability/06-engine-benchmark-2026-09-24.md`):
con 4 en vuelo por proceso el p95 sostenido es 174 ms (objetivo inicial p95 < 500 ms, **a
ratificar**); con 8 sube a 575 ms sostenido y la CPU del proceso se clava. Se propone operar el
piloto con **4 concurrentes por réplica** y escalar con réplicas. **Alternativa descartada:**
extrapolar la cifra de Core o la de una máquina de desarrollo a producción. El SLO real y la
carga esperada los acuerdan S y R en el entorno objetivo (B18-SLO, BLOCKED).

### D-16.2 El banco mide la capacidad con el limitador por cliente elevado

`RATE_LIMIT_RUNTIME_REQUESTS=100000` sólo en el banco, para medir el runtime y no el limitador;
el escenario «limitador» mide el valor por omisión (1.500/min = 25 decisiones/s por cliente) y
reporta sus 429 aparte. Ningún valor por omisión cambia.

## P-17 · Restore, rollback y retención (B19)

### D-17.1 Rollback = corrección hacia adelante (ratifica **S**)

Prisma no tiene `down`. Toda migración desde el 2026-09-24 debe ser **aditiva** (columnas nulables
o con DEFAULT, tablas, índices, CHECK que las filas existentes ya cumplen) y no reescribir ni borrar
datos; lo exige `test/migrations-forward-only.spec.ts`. Así, revertir la APLICACIÓN a la versión
anterior no requiere tocar el esquema. Para deshacer el efecto de una migración se escribe otra
migración nueva. **Nunca** se revierte `20260924120000_enabling_basis_and_output_policy_range`
borrando columnas: `consent_version` y `enabling_basis_policy` son la evidencia de bajo qué base y
texto se decidió. **Alternativa descartada:** escribir `down` manuales que borren columnas.

### D-17.2 Ensayo de restore local (lo aprobado sigue BLOCKED)

`scripts/ops/restore-drill.sh` ensaya el restore en local y lo concilia; el runbook está en
`docs/operations/restore-runbook.md`. RPO/RTO **aprobados**, restore de objetos de MinIO,
credenciales efectivas del entorno y la ejecución por alguien distinto del autor quedan
**BLOCKED** con dueño **S** (y **J** para lo que toca datos personales).

### D-17.3 Retención por conjunto de datos — PROPUESTA a ratificar por **J**

Valores **propuestos**, conservadores y configurables; ninguno está aprobado ni implementado como
borrado salvo donde se indica «vigente». No son una afirmación sobre la ley aplicable: **J** fija
los plazos. Todo conjunto admite *legal hold* (una retención legal suspende cualquier borrado).

| Conjunto | Dónde vive | Hoy (vigente) | Propuesta | Tras el plazo | Nota |
|---|---|---|---|---|---|
| Evidencia de identidad (carnet, selfie) | MinIO + huellas en Postgres | Sin plazo (decisión del 2026-09-11, `test/conservacion-indefinida.spec.ts`) | Vida del crédito + 5 años, o sin plazo si J lo mantiene | Borrado del objeto; se conserva la huella SHA-256 | Cambiarlo exige tocar la prueba que lo fija |
| Extractos bancarios (PDF y lectura) | MinIO / Postgres | Sin barrido | 5 años desde la decisión | Borrado del original; se conserva el resumen usado en la decisión | Datos financieros de terceros |
| Decisiones (ejecución, variables, pasos, motivos) | Postgres | Sin barrido | Vida del crédito + 10 años | Anonimizar `subject_*`; conservar agregados | Evidencia de la decisión automatizada |
| Consentimientos y bases habilitantes | `subject_consent` | Sin barrido | Mientras exista el tratamiento + 5 años desde la revocación | Conservar la revocación como prueba | Nunca borrar antes que la decisión que justifican |
| Créditos y desenlaces | `credit_facility`, `decision_outcome_observation` | Sin barrido | Vida del crédito + 10 años | Anonimizar | Base del monitoreo de modelos |
| Idempotencia del runtime | `decision_runtime_idempotency` | 24 h + gracia 24 h (`RUNTIME_IDEMPOTENCY_RETENTION_GRACE_HOURS`, vigente) | Mantener | Borrado | No contiene la decisión, sólo su respuesta |
| Outbox / eventos procesados | `decision_outbox_event`, `decision_processed_event` | Sin barrido | DISPATCHED: 90 días; DEAD: hasta resolverlo + 90 días | Borrado | El hecho vive en su tabla de dominio |
| Auditoría (cadena con hash) | `decision_audit_event`, `decision_access_audit` | Sin barrido | 10 años | Archivo frío, nunca borrado parcial (rompe la cadena) | |
| Análisis semántico (glosas) | Postgres | Minimiza a 30 d, auditoría 90 d (vigente) | Mantener | — | |
| Logs de aplicación y trazas | Collector / almacenamiento de logs | Según el destino | 30 días (logs), 7 días (trazas) | Borrado | Sin PII por política (`04-data-privacy-policy.md`) |
