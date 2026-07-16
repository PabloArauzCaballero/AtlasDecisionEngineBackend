# Ejemplos API

## Headers de gestión

```http
x-api-key: <MANAGEMENT_API_KEY>
x-tenant-id: 1
x-principal-id: analyst.pablo
x-roles: RISK_ANALYST,QA_ANALYST
```

## Listar artefactos

```bash
curl http://localhost:3000/v1/artifacts \
  -H "x-api-key: $MANAGEMENT_API_KEY" \
  -H 'x-tenant-id: 1' \
  -H 'x-principal-id: analyst.pablo' \
  -H 'x-roles: RISK_ANALYST'
```

## Ejecutar aprobación

```json
{
  "requestId": "origination-20260712-001",
  "idempotencyKey": "origination-20260712-001",
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
}
```

## Ejecutar revisión manual por fraude

Cambie únicamente:

```json
{ "fraud_signal": true }
```

## Consultar la evidencia

Use el `executionId` devuelto:

```bash
curl http://localhost:3000/v1/audit/executions/1 \
  -H "x-api-key: $MANAGEMENT_API_KEY" \
  -H 'x-tenant-id: 1' \
  -H 'x-principal-id: auditor.demo' \
  -H 'x-roles: AUDITOR'
```
