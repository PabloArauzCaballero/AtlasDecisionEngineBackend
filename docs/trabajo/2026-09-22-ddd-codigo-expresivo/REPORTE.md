# Reporte — Auditoría DDD: Reversión y suspensión de despliegue

- Fecha: 2026-09-22 · Plan: [PLAN.md](./PLAN.md) · Rama: dev
- Estado H2: **HECHO** · Avance: 3/3 microtareas HECHO.

## Completado en H1

| ID | Qué se logró | Comando | Resultado |
|---|---|---|---|
| H1.S1.M1 | Entrada `src/modules/deployments/deployment.controller.ts` y propietario `src/modules/deployments/deployment.service.ts` localizados | inspección de rutas y símbolos | rutas presentes |
| H1.S1.M2 | Referencia del flujo | `PATH=/opt/homebrew/opt/node@22/bin:$PATH yarn test test/deployment-resolver.spec.ts` | 1 suite; 1/1 prueba pasa; no cubre rollback/suspend |

## Ejecución H2

El resolver exige `isActive: true` y `deploymentStatus: ACTIVE`. La prueba de integración toma un binding real, suspende su despliegue dentro de una transacción y comprueba que el runtime deja de resolverlo aunque el binding siga apuntando a él; luego revierte y verifica el estado original.

**Evidencia:** Prueba unitaria dirigida: 2/2; integración con PostgreSQL local y migraciones al día: 5/5; suite unitaria completa: 227 suites pasan, 2 omitidas; 2337 pruebas pasan, 3 omitidas; `yarn typecheck` y `yarn lint`: 0. La prueba del contrato PostgreSQL de auditoría que fallaba con la base apagada pasó 18/18 tras iniciarla.

## Límites y resultado del gate

La integración ejerce el estado de suspensión y el resolver real en PostgreSQL; no invoca el endpoint HTTP ni el servicio de suspensión para evitar alterar un despliegue existente. La transacción del test se revierte y comprueba que el despliegue queda activo al final. El contenedor PostgreSQL local se devolvió al estado detenido en que estaba antes de esta pasada.

## Decisión

Se conserva el contrato observado y se evita introducir reglas de negocio sin respaldo. Los cambios de producto y las pruebas de esta pasada se describen arriba; las limitaciones pendientes permanecen explícitas.
