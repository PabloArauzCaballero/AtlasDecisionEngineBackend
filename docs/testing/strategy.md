# Estrategia de pruebas

## Principio

**No se declara `PASS` sin la salida real del runner.** Ni «debería pasar», ni «pasó antes».

## Capas

| Capa | Qué demuestra | Infraestructura | Comando |
| --- | --- | --- | --- |
| Unitaria | Lógica de un componente aislado | Ninguna | `yarn test:unit` |
| Integración | Varios componentes contra una base real | PostgreSQL | `yarn test:integration` |
| Extremo a extremo | Un flujo completo por HTTP | PostgreSQL + Redis | `yarn test:e2e` |
| Contrato | El contrato publicado describe la API real | — | `yarn docs:openapi:check`, `docs:openapi:lint` |
| Propiedades | Invariantes sobre entradas generadas | Ninguna | Dentro de `yarn test` |
| Humo | Una instancia real responde | Instancia en marcha | `yarn smoke` |

## Estado actual, con salida real

```
Test Suites: 87 passed, 87 total
Tests:       2 skipped, 692 passed, 694 total   (yarn test)

Test Suites: 13 passed, 13 total
Tests:       67 passed, 67 total                 (yarn test:e2e)
```

Los 2 saltados son deliberados: casos de socket Unix del sidecar, no aplicables en Windows.

## Lecciones que moldearon esta estrategia

!!! danger "Una suite saltada no es una suite verde"
    Tres suites que ejercitan el aislamiento por tenant leían un `DATABASE_URL` indefinido y se
    **auto-saltaban en silencio**. `yarn test` salía verde sin haber ejecutado nunca los
    guardianes de RLS. Se corrigió cargando `.env` desde `jest.config.js`.

!!! warning "Una prueba no puede depender del reloj de pared"
    Las pruebas de lease usaban esperas reales, y un viaje lento a la base convertía «sigue
    retenido» en una reclamación legítima. Ahora fuerzan la caducidad escribiendo la fecha en el
    pasado. Además son ~10× más rápidas.

    La misma lección se aplicó a la concurrencia del sidecar. Afirmaba `cuatro < una × 2.5`, un
    cociente de tiempos que mide también la carga de la máquina: fallaba por ~5 % de margen sin
    ninguna regresión. Ahora comprueba **solapamiento de intervalos** — si el servidor ejecutara
    en serie, ningún par podría solaparse por rápido o lento que fuera el equipo. Un fallo que no
    dice nada sobre el código es peor que no tener la prueba.

!!! warning "Los identificadores de tenant deben ser únicos por corrida"
    `decision_audit_event` es append-only: una corrida reverificaba los restos de la anterior y
    fallaba en suites distintas cada vez. `uniqueTenantId(namespace)` lo resolvió.

## Qué exige una feature nueva

1. Unitaria del núcleo de su lógica.
2. Si toca decisión o persistencia, **una e2e que la ejercite de punta a punta**.
3. Si añade un endpoint, aparece en el contrato y en su catálogo automáticamente.
4. Si añade configuración, se declara en el esquema (o se ignorará en silencio).

## Cobertura donde importa

No se persigue un porcentaje global. Se persigue cobertura **en el camino de decisión y en los
guardianes**: motor de ejecución, evaluador de expresiones, validadores de grafo, resolución de
variables y gobierno están al 90–100 % de sentencias.

## Pruebas sensibles a la carga

| Prueba | Qué asumía | Estado |
| --- | --- | --- |
| `sidecar-concurrency.spec.ts` | Umbral de reloj con ~5 % de margen | **Corregida**: ahora prueba el solapamiento de intervalos, que no depende de la velocidad del equipo |
| Frontend `calculated-field-calls.test.tsx` | `findByRole` con espera acotada | Pendiente; vive en el repositorio del portal |

Regla general: antes de meter en un gate bloqueante una prueba que mide tiempo, pregúntese si
su fallo diría algo sobre el código o solo sobre la máquina.
