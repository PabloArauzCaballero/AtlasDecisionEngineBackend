# Ejecutar las pruebas

```bash
yarn test:unit          # sin base de datos — bucle rápido de desarrollo
yarn test               # todas: unitarias + integración (requiere Postgres y Redis)
yarn test:e2e           # extremo a extremo contra infraestructura real
yarn test:cov           # con cobertura
yarn smoke              # humo contra una instancia ya en marcha
yarn smoke:full         # smoke integral: toda la superficie, por tipo de usuario
```

El [smoke integral](smoke-integral.md) es otra cosa que los tres primeros: no fija
comportamiento, comprueba que un sistema **ya desplegado** responde como su contrato dice,
ruta por ruta y rol por rol.

!!! danger "Una suite «saltada» no es una suite verde"
    El hallazgo más caro de este repositorio fue exactamente ese: tres suites que ejercitan el
    aislamiento por tenant leían un `DATABASE_URL` indefinido y **se auto-saltaban en silencio**.
    `yarn test` salía verde sin haber ejecutado nunca los guardianes de RLS. Se corrigió cargando
    `.env` desde `jest.config.js` (`setupFiles`). Trate un «skipped» inesperado como una señal de
    fallo, no como ruido.

## En contenedores, sin instalar nada

Las órdenes de arriba exigen Node, Yarn y una base de datos en la máquina. La alternativa no
necesita ninguna de las tres, y usa **su propia** base efímera:

```bash
docker compose -f compose.test.yml run --rm integration   # unitarias + integración
docker compose -f compose.test.yml run --rm e2e           # extremo a extremo
docker compose -f compose.test.yml down -v
```

Es un proyecto de Compose **distinto** (`name: atlas-decision-test`), no una superposición del
de desarrollo. La diferencia importa: compartir el proyecto habría significado compartir los
volúmenes, y correr la batería habría escrito sobre la base de desarrollo de quien la lanza.

PostgreSQL corre ahí sobre `tmpfs` y con `fsync=off`, `full_page_writes=off` y
`synchronous_commit=off`. No es un atajo: estos datos **no deben** sobrevivir a un corte, así
que pagar el coste de garantizarlo solo alargaría la suite.

`JOB_SCHEDULER_ENABLED=false` en ese entorno a propósito. Un orquestador vivo durante una
prueba que no lo ejercita reclama filas por debajo y convierte un fallo determinista en uno
intermitente.

## Qué necesita cada capa

| Capa | Infraestructura | Ficheros |
| --- | --- | --- |
| Unitarias | ninguna | `test/*.spec.ts` |
| Integración | Postgres | `test/*.integration.spec.ts` |
| Extremo a extremo | Postgres + Redis | `test/e2e/*.e2e-spec.ts` (`test/jest-e2e.json`) |
| Humo | una instancia en marcha | `scripts/smoke.mjs` |
| Privilegios PostgreSQL | Postgres **con los roles aprovisionados** | `test/postgres-role-privileges.integration.spec.ts` |

La última se salta —y lo declara— mientras no existan las dos conexiones separadas, porque
lo que comprueba es que el rol lector **no puede escribir** y eso exige ejecutar la
escritura de verdad:

```bash
yarn db:provision:dev
DATABASE_WRITE_URL=postgresql://atlas_writer:…@localhost:5432/atlas_decision?schema=public \
DATABASE_READ_URL=postgresql://atlas_reader:…@localhost:5432/atlas_decision?schema=public \
  npx jest --runInBand test/postgres-role-privileges.integration.spec.ts
```

El resto de la capa de persistencia (`test/persistence-*.spec.ts` y la suite de contrato del
puerto de auditoría) corre sin base de datos: construir un `Pool` no abre sesión y los
rechazos ocurren antes de emitir consulta. Detalle en
[pruebas y evidencia](../data/persistence/testing-and-evidence.md).

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
