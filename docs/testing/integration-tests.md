# Pruebas de integración

```bash
yarn test:integration    # solo *.integration.spec.ts — requiere PostgreSQL
```

## Qué demuestran

Lo que **ninguna prueba unitaria puede demostrar**: que el motor de base de datos aplica lo que
el código supone.

| Suite | Invariante que fija |
| --- | --- |
| `tenant-rls-isolation.integration.spec.ts` | Las políticas RLS aíslan de verdad, conectando como `atlas_app` |
| `tenant-rls-views.spec.ts` | Las vistas del modelo de lectura también aíslan |
| `governance-sod.integration.spec.ts` | Segregación de funciones: 20 casos, todos los guardianes |
| `deployment-invariants.integration.spec.ts` | Invariantes de despliegue |
| `idempotency-lease.integration.spec.ts` | El lease bloquea mientras vive y libera al vencer |
| `governance-scenarios.integration.spec.ts` | Los cuatro escenarios sembrados se rechazan con su código |
| `outbox-notifications.integration.spec.ts` | El outbox llega a la bandeja sin duplicar |

## Por qué RLS no se puede probar con un mock

Un mock devolvería lo que el autor de la prueba espera. La pregunta real es si **PostgreSQL**
filtra, y eso solo lo responde PostgreSQL — conectado como el rol correcto.

!!! danger "Estas suites se auto-saltaron durante meses"
    Leían un `DATABASE_URL` indefinido porque Jest no cargaba `.env`. `yarn test` salía verde sin
    haber ejecutado **nunca** los guardianes de aislamiento. Corregido con `setupFiles` en
    `jest.config.js`. Trate un «skipped» inesperado como fallo.

## Datos de prueba compartidos

Una base de desarrollo de larga vida acumula datos de corridas anteriores. Dos reglas:

1. **Identificadores de tenant únicos por corrida** (`uniqueTenantId(namespace)`) donde se escriba auditoría — no se puede limpiar lo que es append-only.
2. **Nunca asuma «la primera página»**: filtre por código.

## Concurrencia

`FOR UPDATE SKIP LOCKED` con lease se prueba forzando la caducidad (escribiendo la fecha en el
pasado), **no** esperando. Una prueba que espera un lease real falla cuando la máquina va
lenta, y su fallo no dice nada sobre el código.

## Escribir una nueva

1. Nómbrela `*.integration.spec.ts` para que entre en el filtro correcto.
2. Use un tenant único si escribe auditoría.
3. Limpie lo que **sí** se puede limpiar, en orden de dependencias.
4. Compruebe el comportamiento del **motor**, no el del código: si un mock bastaría, es una prueba unitaria.
