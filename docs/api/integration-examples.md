# Ejemplos de integración

Ejemplos reales contra la API. Sustituya credenciales y códigos por los suyos.

## 1. Pedir una decisión

```bash
curl -X POST "$BASE_URL/v1/decisions/BNPL_CREDIT_DECISION" \
  -H "content-type: application/json" \
  -H "x-api-key: $RUNTIME_API_KEY" \
  -H "x-tenant-id: 1" \
  -d '{
    "requestId": "sol-2026-000123",
    "idempotencyKey": "sol-2026-000123",
    "subjectReference": "cliente-4711",
    "environmentCode": "PROD",
    "variables": {
      "ingreso_mensual": 2500.50,
      "deuda_mensual": 400.00
    }
  }'
```

Respuesta (abreviada):

```json
{
  "executionId": "8891",
  "outcome": "APPROVED",
  "output": { "decision": "APROBADO", "limite": 1500 },
  "reasons": [
    { "code": "DTI_ACEPTABLE", "message": "La relación deuda/ingreso está dentro de política" }
  ]
}
```

!!! tip "Derive la clave de su solicitud"
    `idempotencyKey` debe salir de **su** identificador de solicitud, no de un aleatorio por
    intento. Un UUID nuevo en cada reintento anula la protección y produce dos decisiones.

## 2. Reintentar con seguridad

```bash
# Exactamente la misma llamada: devuelve la MISMA ejecución, no una decisión nueva.
```

Reintente ante `429` y `503` respetando `retry-after`. Ante `409`, otro proceso tiene la clave:
espere y vuelva a intentar.

## 3. Simular sin persistir

```bash
curl -X POST "$BASE_URL/v1/simulations/BNPL_CREDIT_DECISION" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-tenant-id: 1" \
  -d '{
    "requestId": "sim-1",
    "environmentCode": "TEST",
    "variables": { "ingreso_mensual": 900, "deuda_mensual": 700 },
    "compareWithProduction": true
  }'
```

Con `compareWithProduction` se ejecutan **las mismas entradas ya resueltas** contra el
artefacto activo en PROD y la respuesta trae un bloque `productionComparison`. Nada se
persiste.

## 4. Recorrer la auditoría sin agotar la memoria

```bash
curl "$BASE_URL/v1/audit/events/cursor?pageSize=100" \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: 1"
# → { "items": [...], "nextCursor": "MTIzNDU2" }

curl "$BASE_URL/v1/audit/events/cursor?pageSize=100&cursor=MTIzNDU2" \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: 1"
```

## 5. Verificar la cadena de auditoría

```bash
curl "$BASE_URL/v1/audit/chain/verify" \
  -H "authorization: Bearer $TOKEN" -H "x-tenant-id: 1"
# → { "valid": true, ... }
```

`valid: false` es un incidente de integridad: consulte el
[runbook de operación](../runbooks/OPERATIONS.md) y **no** intente «reparar» hashes.

## 6. Manejar errores

```python
response = session.post(url, json=payload, headers=headers)
if response.status_code >= 400:
    problem = response.json()
    code = problem["title"]              # estable: compare CONTRA ESTO
    message = problem["error"]["message"] # legible: puede cambiar sin aviso
    request_id = problem["requestId"]     # cítelo al reportar la incidencia
```

## 7. Generar un cliente

```bash
yarn docs:openapi:generate    # openapi/openapi.json desde la aplicación real
yarn docs:openapi:bundle      # documento resuelto en un solo fichero
```

Los nombres de las funciones del cliente salen de `operationId`. Fije su generador a
`API_VERSION`, no a `BUILD_VERSION`.
