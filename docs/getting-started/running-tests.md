# Ejecutar las pruebas

```bash
yarn test:unit          # sin base de datos — bucle rápido de desarrollo
yarn test               # todas: unitarias + integración (requiere Postgres y Redis)
yarn test:e2e           # extremo a extremo contra infraestructura real
yarn test:cov           # con cobertura
yarn smoke              # humo contra una instancia ya en marcha
```

!!! danger "Una suite «saltada» no es una suite verde"
    El hallazgo más caro de este repositorio fue exactamente ese: tres suites que ejercitan el
    aislamiento por tenant leían un `DATABASE_URL` indefinido y **se auto-saltaban en silencio**.
    `yarn test` salía verde sin haber ejecutado nunca los guardianes de RLS. Se corrigió cargando
    `.env` desde `jest.config.js` (`setupFiles`). Trate un «skipped» inesperado como una señal de
    fallo, no como ruido.

## Qué necesita cada capa

| Capa | Infraestructura | Ficheros |
| --- | --- | --- |
| Unitarias | ninguna | `test/*.spec.ts` |
| Integración | Postgres | `test/*.integration.spec.ts` |
| Extremo a extremo | Postgres + Redis | `test/e2e/*.e2e-spec.ts` (`test/jest-e2e.json`) |
| Humo | una instancia en marcha | `scripts/smoke.mjs` |

Las e2e usan `createTestApp()` y los clientes de `test/e2e/support/`, y limpian sus datos en un
`globalTeardown` común, no por especificación.

## Base de datos compartida: dos trampas conocidas

1. **No asuma «la primera página».** Una base de desarrollo de larga vida acumula artefactos de
   corridas anteriores; filtre por código en vez de leer la página 1.
2. **Los identificadores de tenant deben ser únicos por corrida.** `decision_audit_event` es
   append-only y no se puede limpiar, así que una corrida reverificaría los restos de la
   anterior. Use `uniqueTenantId(namespace)` de `test/support/unique-tenant.ts`.

## Pruebas sensibles a la carga

Dos pruebas fallan de forma intermitente cuando toda la suite corre a la vez y pasan aisladas.
No son fallos funcionales, pero **no deben entrar en un gate que bloquee un despliegue** sin
des-flakearlas antes:

| Prueba | Qué asume |
| --- | --- |
| `test/sidecar-concurrency.spec.ts` | Un umbral de reloj de pared con ~5 % de margen |
| Frontend `calculated-field-calls.test.tsx` | Un `findByRole` que agota su espera bajo carga |

Ver [estrategia de pruebas](../testing/strategy.md).
