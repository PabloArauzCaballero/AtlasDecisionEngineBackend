# Ejemplos API

Estos ejemplos existen para que una integración de negocio pueda probarse sin inferir autoridad,
idempotencia o persistencia. A nivel de sistema complementan OpenAPI con secuencias y límites que
afectan el significado de una respuesta.

## Autenticación de gestión con API key

La credencial debe existir en el registro de clientes de integración. La identidad, los roles y los tenants permitidos se cargan desde PostgreSQL.

```http
x-api-key: <MANAGEMENT_API_KEY>
x-tenant-id: 1
```

No envíe `x-principal-id` ni `x-roles`: no forman parte del contrato y no otorgan autoridad.

Para un cliente autorizado en un único tenant, `x-tenant-id` puede omitirse. Un cliente multi-tenant debe seleccionar uno de sus tenants autorizados.

## Autenticación con bearer token

```http
Authorization: Bearer <JWT_O_ACCESS_TOKEN>
```

El backend obtiene subject, tenant y roles de claims o del perfil verificado por el proveedor de identidad.

## Listar artefactos

```bash
curl http://localhost:3000/v1/artifacts \
  -H "x-api-key: $MANAGEMENT_API_KEY" \
  -H "x-tenant-id: 1"
```

## Ejecutar una decisión

La ruta runtime exige una credencial de audiencia `runtime`.
El artefacto demo valida un contrato amplio de KYC, fraude, crédito, capacidad de pago y AML; el
solicitante sintético completo y sin PII vive en `smoke/demo-applicant.json` del repositorio.
El siguiente ejemplo usa `jq` para incorporarlo sin mantener una copia parcial que terminaría en
`VARIABLE_MISSING_OR_INVALID` (422):

```bash
jq --arg requestId "origination-20260716-001" '{
  requestId: $requestId,
  idempotencyKey: $requestId,
  subjectReference: "consumer-synthetic-01923",
  environmentCode: "PROD",
  variables: .,
  context: {channel: "MOBILE_APP", merchantId: "merchant-001"}
}' smoke/demo-applicant.json | curl -X POST http://localhost:3000/v1/decisions/BNPL_CREDIT_DECISION \
  -H "content-type: application/json" \
  -H "x-api-key: $RUNTIME_API_KEY" \
  -H "x-tenant-id: 1" \
  --data-binary @-
```

Repetir exactamente el request con la misma clave devuelve la respuesta persistida. Cambiar payload o ambiente con la misma clave devuelve conflicto.

## Forzar revisión manual por fraude

Use el mismo request y cambie:

```json
{
  "fraud_signal": true
}
```

## Consultar evidencia

Use el `executionId` devuelto por el runtime:

```bash
curl http://localhost:3000/v1/audit/executions/1 \
  -H "x-api-key: $MANAGEMENT_API_KEY" \
  -H "x-tenant-id: 1"
```

La credencial de gestión necesita uno de los roles permitidos por la ruta, por ejemplo `AUDITOR` o `COMPLIANCE`.

## Previsualizar una decisión por SSE

La operación es exclusiva de gestión, exige `LIVE_EXECUTION_STREAM_ENABLED=true` y rechaza PROD.
No crea evidencia durable: para una decisión de negocio real use `/v1/decisions/:artifactCode`.

```bash
curl -N -G http://localhost:3000/v1/live-executions/stream \
  -H "x-api-key: $MANAGEMENT_API_KEY" \
  -H "x-tenant-id: 1" \
  --data-urlencode "artifactCode=BNPL_CREDIT_DECISION" \
  --data-urlencode "environmentCode=TEST" \
  --data-urlencode 'variables={"age":30,"bureau_score":760}' \
  --data-urlencode "requestId=preview-20260727-001"
```

## Ejecutar una suite sin evidencia ambigua

`POST /v1/test-suites/:suiteId/runs` acepta `compiledArtifactId` para fijar el artefacto evaluado.
`baselineCompiledArtifactId` está reservado y actualmente devuelve
`BASELINE_COMPARISON_NOT_SUPPORTED` (422); cada caso debe declarar `expectedResult` hasta que el
modelo persista comparaciones entre compilados.

## Consultar eventos por fecha

```bash
curl "http://localhost:3000/v1/audit/events?from=2026-07-01T00:00:00.000Z&to=2026-07-31T23:59:59.999Z" \
  -H "x-api-key: $MANAGEMENT_API_KEY" \
  -H "x-tenant-id: 1"
```
