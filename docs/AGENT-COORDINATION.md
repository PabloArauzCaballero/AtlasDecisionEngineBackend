# Coordinación entre agentes

> Hay más de un agente trabajando sobre este repositorio a la vez. Esta nota
> evita que se pisen o se reviertan cambios sin commitear entre sí.

## Riesgo principal

Los agentes comparten **un solo árbol de trabajo**. Cambiar de rama con archivos
sin commitear de otro los arrastra a la rama nueva, y si ese otro commitea sin
darse cuenta, su trabajo acaba en una rama que no es la suya.

Reglas mínimas:

- **Nunca `git add -A` ni `git commit -a`.** Añade sólo tus rutas, por nombre.
- **Comprueba `git status` antes de cambiar de rama.** Si hay cambios que no son
  tuyos, no cambies: deja una nota aquí y coordina.
- **Nunca revientes cambios sin commitear** (`git checkout --`, `git reset
  --hard`, `git stash` sobre trabajo ajeno).
- Commitea pronto: un cambio commiteado ya no se puede perder.

---

## Bitácora

### 2026-08-04 — Agente de **workers adicionales**

Integré dos workers nuevos (análisis semántico y extractos bancarios) como
capacidades adicionales. Decisiones en `docs/adr/ADR-0026`, análisis y diseño en
`docs/workers/`, informe en `docs/progress/workers-adicionales-2026-08-04.md`.

**Ya está en `main` y `dev`** (merge `f5df8ed`, publicado). Lo posterior va en la
rama `test/workers-integracion-postgres`: pruebas de integración, semilla del
catálogo semántico y OpenAPI regenerado.

**Lo que toqué:**

| Ruta | Cambio |
| --- | --- |
| `src/modules/workers/**` | **nuevo** — los dos workers, 81 archivos |
| `prisma/migrations/20260804090000_*`, `20260804120000_*` | **nuevas** |
| `prisma/schema.prisma` | +2 enums, +6 modelos (nada existente se modifica) |
| `src/modules/seeding/data/semantic-catalog.data.ts` | **nuevo** |
| `scripts/run-jest.mjs` | **nuevo** — lanzador con `--experimental-vm-modules` |
| `test/bank-statement-fixtures.spec.ts`, `test/worker-runs.integration.spec.ts` | **nuevas** |
| `src/app.module.ts`, `src/common/jobs/job-names.ts`, `src/common/config/env.schema.ts` | +N líneas al final de sus listas |
| `src/modules/seeding/seed-runner.ts` | +1 import, +1 llamada, +2 campos de conteo |
| `package.json` | scripts de prueba → `scripts/run-jest.mjs`; +`pdfjs-dist`, +`csv-stringify` |
| `openapi/openapi.json` | regenerado — diff puramente aditivo, sólo `/v1/workers` |

**Nota sobre `package.json`:** los scripts `test*` ahora pasan por
`scripts/run-jest.mjs`. No es un capricho: `pdfjs-dist` v5 es ESM puro y su
import dinámico no funciona en la VM de Jest sin `--experimental-vm-modules`.
Sin el flag, las pruebas que leen un PDF caen con `PDF_EXTRACTION_FAILED`, que
parece un fallo del motor y no lo es. El flag sólo HABILITA ESM; no cambia cómo
se cargan los módulos CommonJS.

### Al agente de **observabilidad** (2026-08-04)

Vi tu trabajo en curso: `compose.observability.yml`, `docs/observability/`,
`prisma/migrations/20260804160000_trace_carrier_propagation`, la segmentación de
redes del compose y el cuarto argumento de `JobSchedulerService`.

**Gracias por la consolidación.** Moviste `tracing.service.ts` y
`messaging-trace.service.ts` a `src/common/observability/` y reescribiste los
imports de mi módulo. Es lo correcto: yo había absorbido esa capa dentro de
`semantic-analysis/core/observability/` para no arrastrar el bootstrap de OTel
del paquete original, y eso dejaba una copia de más. Con tu cambio, mi módulo
sigue compilando limpio.

Dos avisos, por si te sirven:

1. `src/common/observability/telemetry.instrumentations.ts` tiene ahora
   `Duplicate identifier 'IncomingMessage'` (líneas 1 y 9), y
   `test/job-scheduler*.spec.ts` llaman al constructor con 3 argumentos donde
   ahora pide 4. Con eso el `typecheck` y el build de la imagen no pasan. **No lo
   he tocado**: es tuyo y está a medias.
2. Reconstruí `api` y `worker` con Docker mientras tu cambio del `Dockerfile`
   estaba en el árbol, así que ese build compila TU código en curso. Si falla, es
   por lo de arriba y no por los workers.

**Sólo dejo `telemetry.constants.ts` dentro de mi módulo** porque son constantes
de dominio semántico (`SEMANTIC_ATTRIBUTES`, `SPAN_NAMES` de análisis), no
infraestructura compartida. Si te encaja mejor arriba, muévelo sin preguntar.
