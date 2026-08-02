# Kubernetes reference manifests

This folder exists so the business can review the minimum operational controls before a release,
while platform teams still retain ownership of the target cluster. At system level these manifests
encode the API workload, migration ordering, health probes, scaling and network boundaries; they
are reference inputs, not a production accreditation.

Replace `REGISTRY`, `RELEASE_ID`, image tags and the permissive namespace selectors. Create `atlas-decision-secrets` externally with `DATABASE_URL` (using the non-superuser `atlas_app` role), `REDIS_URL`, `JWT_JWKS_URL`, `JWT_ISSUER`, `AUDIT_HASH_SECRET`, `AUDIT_HASH_KEY_ID`, `METRICS_TOKEN` and any provider credentials. During audit-key rotation, also inject `AUDIT_HASH_PREVIOUS_SECRETS`. Do not commit those values.

## Dos cargas de trabajo, una imagen

`deployment.yaml` (API) y `worker-deployment.yaml` (trabajos de fondo) despliegan la **misma
imagen** con distinto arranque y distinto `WORKER_ROLE`; publicar dos imágenes permitiría que
una corriera código más viejo que la otra sobre el mismo esquema.

| Carga | `WORKER_ROLE` | Arranque | Sirve | Escala por |
| --- | --- | --- | --- | --- |
| `atlas-decision-api` | `API` (del ConfigMap) | `node dist/main.js` | Decisiones y gestión, puerto 3000 | Tráfico y p95 |
| `atlas-decision-worker` | `WORKER` (sobrescrito en el Deployment) | `node dist/worker.js` | Solo sondas, puerto 3001 | Profundidad de la cola del outbox y de corridas |

El worker se escala de forma independiente: relay, worker de corridas y purga reclaman su
trabajo con `FOR UPDATE SKIP LOCKED` más un lease que caduca, así que N réplicas no duplican
nada. Use `Recreate` y no `RollingUpdate`: dos generaciones compitiendo por las mismas filas
no aportan disponibilidad, y el periodo de gracia ya drena los trabajos en vuelo.

Los tres trabajos corren bajo un orquestador central (`src/common/jobs`, documentado en
[`docs/worker-orchestration.md`](../../docs/worker-orchestration.md)) que retrocede su
sondeo al ralentí y despierta de inmediato por `pg_notify` cuando la API escribe trabajo
nuevo — de ahí que `network-policy.yaml` permita el puerto 5432 en el egress del worker: esa
conexión de escucha es tan necesaria como el pool de Prisma para que el worker procese algo.

Métricas para dimensionarlo: `atlas_outbox_pending` (si sube de forma sostenida, el despacho
no da abasto), `atlas_outbox_dead_total` (requiere atención de un operador, no más réplicas),
`atlas_job_runs_total{job,outcome}` y `atlas_job_last_success_timestamp_seconds{job}` (un
trabajo que dejó de correr, no solo el que falla). Todas se raspan en `/metrics` del propio
worker — `worker-deployment.yaml` ya anota `prometheus.io/scrape`.

Run the migration Job and wait for completion before applying the Deployment. The templates are deliberately conservative but are not a substitute for the cluster's ingress, service mesh, TLS, secret manager, backup and observability standards.

The reference deployment uses JWT mode and stdout logging. If a hybrid deployment needs API keys, provision integration clients through a separate controlled seed/administration Job; do not put bootstrap keys or scopes in this ConfigMap.
