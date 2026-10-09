# Artefactos del Motor en un entorno nuevo

## Qué pasó

El 2026-09-28 el Motor de TEST publicaba un solo artefacto, `IDENTIDAD_CARNET_MOVIL`. AtlasBackend
apuntaba crédito a `ATLAS_BNPL_UNDERWRITING`, riesgo a `RIESGO_ONBOARDING_CLIENTE` y comercios a
`PARTNER_KYB_REVIEW`, que allí no existían. Cada decisión de esos tres tipos moría con
`ACTIVE_DEPLOYMENT_NOT_FOUND` y las alta/aprobaciones caían a heurísticas del código, sin versión ni
aprobación. Nada avisó: las variables de entorno estaban puestas y el despliegue salió en verde. Sólo
la pantalla «Motor de decisiones» del portal lo mostraba («No existe en el motor»).

**Causa:** un artefacto no viaja con el despliegue. Las migraciones crean el ambiente y el de
identidad; el resto se publica aparte, con guiones, y luego lo firman dos personas. Un entorno nuevo
(o uno limpiado) arranca sin ellos.

## Regla

**Un entorno no está listo para decidir hasta que `verificar-artefactos-publicados.mjs` sale en 0 y
cada artefacto tiene despliegue activo.** «La variable `DECISION_ENGINE_*_ARTIFACT` está puesta» no
prueba nada.

## Pasos, en orden

**El camino corto es un solo comando por paso:**
[Publicar todos los artefactos de una vez](publicar-todos-los-artefactos.md). Lo de abajo es lo
mismo, artefacto por artefacto, para cuando hace falta tocar uno solo.

1. **Verificar** (sólo lectura):
   `MANAGEMENT_API_KEY=… node scripts/verificar-artefactos-publicados.mjs --base <url del Motor>`
   Sale 1 y lista cuáles FALTAN; sale 2 si el catálogo no se pudo leer o llegó vacío.
2. **Publicar** cada faltante (crea o reutiliza el artefacto, escribe el grafo, compila, corre la
   suite bloqueante y lo manda a revisión). Primero `--dry-run`:
   - Crédito: `node scripts/atlas-underwriting-v2.mjs`
   - Riesgo: `node scripts/riesgo-onboarding-cliente.mjs`
   - Comercio (KYB): `node scripts/partner-kyb-review.mjs`
   - Privacidad (solicitudes del titular): `node scripts/privacidad-solicitud-titular.mjs` — necesita un
     Motor con la migración `20261004120000_decision_kind_data_subject_rights`; ver
     [su página](../artifacts/privacidad-solicitud-titular.md).
3. **Firmar**: dos personas distintas (QA_ANALYST y RISK_APPROVER, ninguna la autora) aprueban la
   versión en el portal del Motor. No se crean aprobadores de máquina ni se autoaprueba desde un
   guion: anula el control.
4. **Desplegar** con la credencial del RELEASE_MANAGER (la de gestión da 403 por separación de
   funciones): `node scripts/<guion>.mjs --deploy <versionId> --environments <ENTORNOS>`.
   Sin despliegue y binding activo el Motor sigue respondiendo `ACTIVE_DEPLOYMENT_NOT_FOUND`
   aunque el catálogo ya lo liste.
5. **Volver a verificar** y comprobar en el portal que la columna «En el motor» dice «Existe en el
   motor».

## Trampas medidas en TEST (2026-09-29)

- El Motor de TEST (Contabo) sólo tiene el ambiente `STAGING`: publicar y desplegar allí lleva
  `--environments STAGING`; con el valor por defecto (`DEV,TEST`) el guion avisa y no despliega.
- `atlas-underwriting-v2.mjs` publica una versión nueva de crédito; en un entorno sin
  `ATLAS_BNPL_UNDERWRITING` se corre con `--crear` y esa definición pasa a ser la v1.
- Un `SUPER_ADMIN` de Core llega al Motor como `PLATFORM_ADMIN` y, por defecto, no firma. Firman
  `QA_ENGINEER` (→ `QA_ANALYST`) y `RISK_MANAGER` (→ `RISK_APPROVER`), dos personas que no sean la autora.
  Sólo con `GOVERNANCE_ADMIN_CAN_SIGN_ANY_STEP=true` (TEST/DEV) firma un paso cuyo rol no tiene, y la
  auditoría lo marca como `PLATFORM_ADMIN_WILDCARD`.

## Qué mirar si vuelve a pasar

- El portal: Configuración → Motor de decisiones. Rojo = el catálogo del Motor no trae ese código.
- Producción no se puede publicar con las semillas de dev: cada artefacto va por estos guiones para
  que pase por revisión, auditoría y aprobación.
