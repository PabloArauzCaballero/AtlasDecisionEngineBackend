# Plan — DDD y código expresivo: Reversión y suspensión de despliegue

- Fecha: 2026-09-22 · Repo: AtlasDecisionEngineBackend (backend) · Predecesor: ninguno en esta pasada
- Resultado observable de esta pasada: flujo, regla, evidencia y próxima comprobación definidos sin modificar producto.
- Kill-test: si no se puede seguir `src/modules/deployments/deployment.controller.ts` → `src/modules/deployments/deployment.service.ts`, el diagnóstico no está completo.

## Alcance

- IN: `src/modules/deployments/deployment.controller.ts`, `src/modules/deployments/deployment.service.ts`, contrato y prueba de referencia del flujo.
- OUT: migraciones, cambios de API, UX o reglas no confirmadas; resto del repo.
- Ambigüedad registrada: Transición irreversible y decisiones en producción: no cambiar semántica sin confirmar el contrato.

## H1 — Diagnóstico y referencia

**CA:** Dado el flujo existente, cuando se inspeccionan entrada, decisión y resultado, entonces la regla tiene un propietario y una prueba de referencia identificables.
**DoD:** inspección de los archivos citados y `PATH=/opt/homebrew/opt/node@22/bin:$PATH yarn test test/deployment-resolver.spec.ts` con el resultado literal del reporte.
**Estado:** HECHO

### H1.S1 — Rastrear y probar

**CA:** Dado el checkout actual, cuando se sigue el flujo, entonces se distingue regla de coordinación. **DoD:** rutas y símbolos reales registrados abajo. **Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD (comando de verificación) | Estado |
|---|---|---|---|---|
| H1.S1.M1 | Localizar entrada y propietario | Ambas rutas existen y se identificó la regla | `test -f 'src/modules/deployments/deployment.controller.ts' && test -f 'src/modules/deployments/deployment.service.ts'` → salida 0 | HECHO |
| H1.S1.M2 | Fijar referencia | El chequeo dirigido termina con salida 0 | `PATH=/opt/homebrew/opt/node@22/bin:$PATH yarn test test/deployment-resolver.spec.ts` → 1 suite; 1/1 prueba pasa; no cubre rollback/suspend | HECHO |

**Regla observada:** Revertir exige despliegue activo y anterior; las operaciones por ambiente se serializan.

## H2 — Próxima capacidad acotada

**CA:** Dado el contrato confirmado, cuando se ejerce la condición límite del flujo, entonces el resultado visible o persistido coincide con la regla y un rechazo no produce efecto parcial.
**DoD:** prueba de comportamiento dirigida, verificación de contrato y recorrido real si se modifica código; reporte con salida literal.
**Estado:** HECHO

### H2.S1 — Confirmar semántica antes de refactorizar

**CA:** La condición límite tiene resultado esperado documentado. **DoD:** prueba dirigida y revisión del contrato vigente. **Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD (comando de verificación) | Estado |
|---|---|---|---|---|
| H2.S1.M1 | Ejecutar o ampliar la prueba de integración de suspensión y binding activo para confirmar que el runtime deja de resolver el despliegue suspendido. | Hay un caso verificable y no cambia reglas hipotéticas | `PATH=/opt/homebrew/opt/node@22/bin:$PATH yarn test test/deployment-invariants.integration.spec.ts --silent` → 5/5; cambio revertido dentro de la transacción | HECHO |

## Riesgos y bloqueos previstos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Transición irreversible y decisiones en producción: no cambiar semántica sin confirmar el contrato. | Resultado o contrato falso | Confirmar con código, contrato y prueba antes de editar producto |

## Decisión de diseño

El propietario observado es `src/modules/deployments/deployment.service.ts`. No se introduce una capa DDD nueva por nombre. Una refactorización futura necesitará mostrar una llamada más clara y la misma semántica en la entrada real, con prueba roja antes de cambiar implementación. Si la comprobación H2 demuestra que el diseño actual ya protege la regla, se registra como DESCARTADO el cambio de código.
