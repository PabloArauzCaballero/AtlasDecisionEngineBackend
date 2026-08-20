# Semillas de DESARROLLO

Nada de esta carpeta corre solo, ni en un despliegue, ni en CI, ni al arrancar la
aplicación. Son guiones que se invocan a mano contra una base de desarrollo.

La siembra de verdad es otra cosa y vive fuera de aquí:

| | Qué | Dónde |
| --- | --- | --- |
| **BOOTSTRAP** | El catálogo mínimo sin el cual una instalación no opera. Corre SIEMPRE, en todos los ambientes. | `src/modules/seeding/` vía [`../seed.ts`](../seed.ts) |
| **MOCKUP** | Artefactos de demostración con despliegues ACTIVOS. Sólo donde se pide. | idem, tras `SEED_INCLUDE_MOCKUP` |
| **Esto** | Escenarios sueltos para mirar una pantalla concreta, y datos de prueba. | esta carpeta, a mano |

Estaban sueltos junto a `seed.ts`, que es el fichero que ejecuta el Job de producción, y
`qa-bank-statement.fixture.ts` —un extracto bancario de prueba de 405 líneas— vivía dentro
de `src/modules/seeding/data/`, de modo que se compilaba en la imagen que se despliega
aunque su único consumidor fuera un guion de mano. Un dato de prueba mezclado con los datos
mínimos acaba, tarde o temprano, sembrado en una base real.

| Guion | Para qué |
| --- | --- |
| `seed-chain-example.ts` | Un algoritmo padre que referencia a un hijo, para ver «Abrir algoritmo» en el editor. |
| `seed-statement-worker-decision.ts` | Ejecuta el demo del worker de extractos contra un PDF real (o el sintético de la fixture). |
| `deploy-demo-all-envs.ts` | Despliega el demo BNPL también en los ambientes no productivos, que es donde miran el Simulador y la Ejecución en Vivo. |
| `qa-bank-statement.fixture.ts` | Extracto bancario sintético de QA Bank. No es una semilla: es el dato de entrada del guion de arriba. |

Todos resuelven el tenant con `resolveBootstrapTenantId()`, el mismo que la siembra real:
leen `BOOTSTRAP_TENANT_ID` (o `SEED_TENANT_ID` como sinónimo). Cuando cada guion leía su
propia variable, escribían en un tenant cuyo catálogo estaba en otro.

```bash
npx ts-node --transpile-only prisma/dev-seeds/seed-chain-example.ts
npx ts-node --transpile-only prisma/dev-seeds/deploy-demo-all-envs.ts
npx ts-node --transpile-only prisma/dev-seeds/seed-statement-worker-decision.ts [--pdf <ruta>]
```
