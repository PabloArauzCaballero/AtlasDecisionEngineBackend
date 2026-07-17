# Ejemplos API

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

```bash
curl -X POST http://localhost:3000/v1/decisions/BNPL_CREDIT_DECISION \
  -H "content-type: application/json" \
  -H "x-api-key: $RUNTIME_API_KEY" \
  -H "x-tenant-id: 1" \
  -d '{
    "requestId": "origination-20260716-001",
    "idempotencyKey": "origination-20260716-001",
    "subjectReference": "consumer-01923",
    "environmentCode": "PROD",
    "variables": {
      "kyc_status": "VERIFIED",
      "consent_active": true,
      "age": 30,
      "fraud_signal": false,
      "bureau_score": 760,
      "monthly_income": 8000,
      "requested_amount": 2500
    },
    "context": {
      "channel": "MOBILE_APP",
      "merchantId": "merchant-001"
    }
  }'
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

## Consultar eventos por fecha

```bash
curl "http://localhost:3000/v1/audit/events?from=2026-07-01T00:00:00.000Z&to=2026-07-31T23:59:59.999Z" \
  -H "x-api-key: $MANAGEMENT_API_KEY" \
  -H "x-tenant-id: 1"
```
