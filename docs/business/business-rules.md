# Reglas de negocio invariantes

Reglas que el sistema aplica **siempre**, en el servidor, y que ninguna configuración relaja.
Cada una indica dónde se aplica y qué la cubre.

## Gobierno

| # | Regla | Dónde | Cobertura |
| --- | --- | --- | --- |
| G1 | Solo un borrador es editable | `artifact.service.ts` | `VERSION_IMMUTABLE` |
| G2 | El autor no puede aprobar su propia versión | `governance.service.ts` | `governance-sod.integration.spec.ts` |
| G3 | Los pasos de aprobación se resuelven en orden | `governance.service.ts` | idem |
| G4 | Un mismo principal no vota dos veces el mismo paso | `governance.service.ts` | idem |
| G5 | `PLATFORM_ADMIN` sustituye a un rol exigido, pero **solo** en identidades firmadas | `roles.guard.ts` | `api-key-privilege-escalation.spec.ts` |

## Contratos de datos

| # | Regla | Dónde |
| --- | --- | --- |
| C1 | Una entrada no declarada en el contrato **nunca** entra al motor | `variable-resolution.service.ts` |
| C2 | Los valores por defecto se aplican antes de validar, para que una regla condicional vea el contrato completo | idem |
| C3 | Una versión de variable es inmutable; estrechar el contrato exige comprobación de compatibilidad | `variable.service.ts` |
| C4 | Un valor sensible se persiste como HMAC, no como SHA-256 desnudo | `variable-resolution.service.ts` |
| C5 | La salida no se infiere del último nodo: si no está en el contrato de salida, no se publica | `graph-output-contract.validator.ts` |

!!! note "Por qué HMAC y no SHA-256"
    Los valores sensibles suelen ser de baja entropía (una edad, un documento, un booleano).
    Un SHA-256 desnudo se revierte por fuerza bruta o tablas arcoíris. El HMAC introduce un
    secreto que hace irreversible el hash almacenado.

## Ejecución

| # | Regla | Dónde |
| --- | --- | --- |
| E1 | La ejecución está acotada por `MAX_EXECUTION_STEPS` | `execution-engine.service.ts` |
| E2 | Una intermedia solo la escribe su nodo productor | `intermediate-scope.ts` |
| E3 | Un valor de intermedia que incumple su contrato **aborta**, no degrada | idem |
| E4 | La cadena de artefactos está acotada en número, tiempo, tamaño y memoria retenida | `chain-budget.ts` |
| E5 | Un ciclo entre artefactos se detecta antes de ejecutar | `cycle-detector.ts` |
| E6 | La política `missingData` de un campo calculado solo absorbe errores de datos, nunca una avería del sandbox | `MISSING_DATA_ERROR_CODES` |

!!! danger "E6 es una regla de seguridad de negocio"
    Si un sandbox caído se convirtiera en «devuelve el valor por defecto», una avería técnica
    se transformaría en una decisión de crédito silenciosamente incorrecta.

## Idempotencia y evidencia

| # | Regla | Dónde |
| --- | --- | --- |
| I1 | La misma clave de idempotencia devuelve la misma ejecución | `idempotency.service.ts` |
| I2 | Ejecución, evidencia y evento de auditoría se confirman en una sola transacción | `execution-writer.service.ts` |
| I3 | La cadena de auditoría es append-only: el rol de aplicación tiene revocados `UPDATE` y `DELETE` | migración `20260717070000_audit_append_only` |
| I4 | La retención de auditoría no puede significar borrado; solo archivado | consecuencia de I3 |

## Aislamiento

| # | Regla | Dónde |
| --- | --- | --- |
| T1 | Toda tabla con ámbito de tenant lleva RLS con el mismo GUC `app.tenant_id` | migraciones de RLS |
| T2 | El runtime conecta como rol **no** superusuario | `DATABASE_URL` → `atlas_app` |
| T3 | Un llamante nunca declara su identidad ni sus roles | `authentication.guard.ts` |
| T4 | El código importado se ejecuta aislado; `IN_PROCESS` está prohibido en producción | `env.schema.ts` + `ScriptNodeRunnerService` |
