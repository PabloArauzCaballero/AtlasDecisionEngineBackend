# Kubernetes reference manifests

Replace `REGISTRY`, `RELEASE_ID`, image tags and the permissive namespace selectors. Create `atlas-decision-secrets` externally with `DATABASE_URL`, `REDIS_URL`, `JWT_JWKS_URL`, `JWT_ISSUER`, `AUDIT_HASH_SECRET`, `METRICS_TOKEN` and any provider credentials. Do not commit those values.

Run the migration Job and wait for completion before applying the Deployment. The templates are deliberately conservative but are not a substitute for the cluster's ingress, service mesh, TLS, secret manager, backup and observability standards.

The reference deployment uses JWT mode and stdout logging. If a hybrid deployment needs API keys, provision integration clients through a separate controlled seed/administration Job; do not put bootstrap keys or scopes in this ConfigMap.
