# Runbook de restore (ensayo P-17)

Qué hacer para restaurar la base del motor desde un volcado y **demostrar** que quedó igual, sin
reenviar efectos ya entregados. Complementa [Recuperación ante desastres](disaster-recovery.md)
(objetivos RTO 4 h / RPO 15 min adoptados por ADR-0024, pendientes de ratificar por negocio) y
[Reversión](rollback.md).

!!! warning "Lo que este runbook NO cubre todavía (BLOCKED)"
    RPO/RTO **ratificados** por S y R · restore de los objetos de MinIO (imágenes de identidad,
    extractos) · credenciales efectivas del entorno · ejecución por alguien **distinto del autor**.
    El ensayo de abajo es local y sintético.

## 1. Ensayo automatizado (local, sintético)

```bash
yarn build
bash scripts/ops/restore-drill.sh            # PREFIX, PG_PORT, REDIS_PORT, API_PORT configurables
```

Hace, y falla con código ≠ 0 si algo no cuadra:

1. Base ORIGEN migrada; artefacto `BNPL_CREDIT_DECISION` provisionado por la batería e2e (gobierno
   de dos firmas y despliegue a PROD).
2. Ciclo por la API compilada: ~900 decisiones, consentimiento otorgado y otro revocado, 20 créditos
   (`/v1/outcomes/facilities`) y 10 desenlaces (`/v1/outcomes/batch`).
3. Outbox con los tres estados: DISPATCHED (reales), 40 PENDING y 5 DEAD (sintéticos por SQL, como
   `scripts/load-test.sh`).
4. `scripts/ops/engine-reconciliation.sql` sobre el ORIGEN → `pg_dump -Fc` → base nueva →
   `pg_restore --exit-on-error` → la misma conciliación sobre la RESTAURADA; `diff` vacío.
5. La API arranca contra la RESTAURADA: el relay despacha exactamente los PENDING; los DISPATCHED
   conservan intentos y fecha, los DEAD siguen DEAD.

### Resultado medido — 2026-09-24, SHA `70cddc2`, Mac de desarrollo (Apple M5, Docker Desktop)

| Medida | Valor |
|---|---|
| Volcado (`pg_dump -Fc`) | 270 ms, 971 KB |
| Restore (`CREATE DATABASE` + `pg_restore`) | 993 ms |
| **RTO del ensayo** (restore + conciliación) | **1,15 s** — sólo la base; no incluye reponer secretos, arrancar servicios ni MinIO |
| Conciliación | 57 controles idénticos: conteos y md5 de 19 tablas (ejecuciones, pasos, variables, idempotencia, sujetos, consentimientos, créditos, ventanas, desenlaces, outbox, eventos procesados, notificaciones, auditoría…), desenlaces por estado, créditos por moneda, estados del outbox y secuencia |
| Datos | 930 ejecuciones, 959 eventos de auditoría, 20 créditos, 10 desenlaces (6 GOOD / 4 BAD), 3 consentimientos (1 revocado) |
| Outbox tras restaurar | 40/40 PENDING despachados en 124 ms; 5 DISPATCHED y 5 DEAD sin tocar; 0 eventos nuevos |
| Claves con más de una ejecución | 0 |

El volumen es de un ensayo, no de producción: el RTO real crece con el tamaño de la base y se mide
en la prueba periódica con una copia real (sección 3).

## 2. Restore real (procedimiento)

1. **Aislar.** Restaurar en una base NUEVA, nunca encima de la de producción. Detener el worker y
   dejar la API sin tráfico hasta el paso 5.
2. **Restaurar.** `pg_restore -d <base_nueva> --exit-on-error <volcado>` (o `scripts/restore.sh`,
   que pide confirmación escribiendo el nombre de la base).
3. **Reponer secretos.** `AUDIT_HASH_SECRET` debe ser el MISMO con el que se escribió la cadena de
   auditoría; si no, la verificación de la cadena falla sin relación aparente con el restore.
4. **Conciliar.** Ejecutar `scripts/ops/engine-reconciliation.sql` contra la copia y contra la
   última conciliación registrada del origen (o contra el origen si sigue vivo). Toda diferencia
   se investiga antes de abrir tráfico.
5. **Outbox.** Antes de arrancar el worker, anotar los estados:
   `SELECT status, count(*) FROM decision_outbox_event GROUP BY 1`. El relay sólo toma PENDING;
   DISPATCHED y DEAD no se reenvían solos. Un DEAD se revisa y se reenvía a mano, nunca en bloque.
   La entrega es *at-least-once*: un PENDING que ya se había entregado antes del volcado se
   entregará otra vez y lo absorbe `decision_processed_event` del consumidor.
6. **Idempotencia.** Las reservas `PROCESSING` del volcado tienen arrendamiento de 60 s: al vencer,
   el reintento del cliente las retoma y decide una vez (medido en P-16, caída de Postgres).
7. **Humo.** Readiness, una decisión de humo y la verificación de la cadena de auditoría.
8. **Registrar** el tiempo real de cada paso: es el RTO medido.

## 3. Pendiente (BLOCKED, con dueño)

| Qué | Dueño |
|---|---|
| Ratificar RPO/RTO (hoy adoptados por ADR-0024) con la carga y el tamaño reales | S + R |
| Restore de MinIO (imágenes de identidad y extractos) y verificación de huellas SHA-256 | S + J |
| Credenciales efectivas del entorno (base, MinIO, secreto de auditoría) recuperables | S |
| Ejecución del runbook por una persona distinta del autor | S |
| Retención por conjunto de datos (propuesta en `docs/compliance/decisions.md`, ## P-17) | J |

## 4. Rollback de migraciones

Política: **corrección hacia adelante** (`docs/compliance/decisions.md`, D-17.1). Prisma no tiene
`down`; toda migración desde el 2026-09-24 es aditiva y lo exige
`test/migrations-forward-only.spec.ts`. Revertir la IMAGEN no requiere tocar el esquema. La
migración `20260924120000_enabling_basis_and_output_policy_range` no se revierte: sus columnas
guardan bajo qué base habilitante y qué versión de consentimiento se decidió.
