# Enrutamiento de lectura y escritura

Un controlador nunca elige conexión. Declara su módulo y si la operación lee o escribe, y
las reglas —cargadas del entorno y validadas al arrancar— deciden el resto.

## Variables

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `DATABASE_URL` | *(obligatoria)* | Conexión de siempre. Sigue bastando por sí sola |
| `DATABASE_WRITE_URL` | `DATABASE_URL` | Ruta de escritura, si se quiere separar del valor histórico |
| `DATABASE_READ_URL` | la de escritura | Ruta de lectura |
| `DATABASE_READ_POOL_MAX` | `DATABASE_POOL_MAX` | Pool propio de la ruta de lectura |
| `DATA_READ_ROUTING_ENABLED` | `false` | Interruptor de la separación. Apagado, todo vuelve al primario |
| `ENABLE_PRIMARY_READ_FALLBACK` | `true` | Servir desde el primario si la lectura no responde |
| `DATA_ROUTING_RULES` | *(vacío)* | Reglas por módulo, en JSON, fusionadas sobre las base |

Con las tres URL vacías el sistema se comporta **exactamente** como antes de este cambio:
una sola conexión, un solo pool, ninguna diferencia observable.

## Detección de conexiones equivalentes

Antes de abrir un pool, el registro compara una huella saneada:

```text
motor | proveedor | host:puerto | base | esquema | usuario | tls
```

La contraseña **no participa**: rotarla no debe abrir un segundo pool idéntico, y la huella
se imprime en logs, métricas y en la sonda pública. El usuario **sí** participa: dos URL
iguales salvo el rol son conexiones distintas a propósito, y colapsarlas anularía la
separación de privilegios que es el objetivo del ejercicio.

Cuando las huellas coinciden, `postgres-read` y `postgres-write` quedan registradas como el
**mismo objeto**: un solo pool, dos nombres lógicos. La sonda sigue reportando las dos
rutas, porque quien la lee conoce dos.

## Escenarios soportados

| Escenario | Configuración | Resultado |
| --- | --- | --- |
| **A · Misma conexión** | ambas URL vacías o idénticas | Un pool reutilizado. Sin duplicación |
| **B · Dos roles, mismo servidor** | `DATABASE_READ_URL` con `atlas_reader` | Dos pools, dos privilegios. **Recomendado en desarrollo** |
| **C · Primario y réplica** | `DATABASE_READ_URL` en otro host | Escrituras solo al primario, lectura eventual, fallback configurable |
| **D · Motores distintos** | regla de módulo hacia otra conexión registrada | El motor debe declarar las capacidades que el módulo exige |
| **E · Proveedores distintos** | URL de proveedores distintos | El proveedor se infiere del host y ajusta pooling/TLS; el adaptador del motor no se duplica |
| **F · Políglota por módulo** | `DATA_ROUTING_RULES` | Ver [persistencia políglota](polyglot.md) |

## Reglas base

Declaradas en `src/common/persistence/routing/routing-rules.ts`:

| Módulo | Lectura | Escritura | Consistencia | Por qué |
| --- | --- | --- | --- | --- |
| `default` | `postgres-read` | `postgres-write` | `strong` | Todo lo no declarado |
| `runtime` | `postgres-write` | `postgres-write` | `read-after-write` | El camino de decisión lee lo que acaba de escribir |
| `governance` | `postgres-write` | `postgres-write` | `read-after-write` | Aprobaciones y segregación de funciones |
| `audit-query` | `postgres-read` | `postgres-write` | `eventual` | Consultas, informes, paneles |
| `views` | `postgres-read` | `postgres-write` | `eventual` | Modelos de lectura del portal |
| `traceability` | `postgres-read` | `postgres-write` | `eventual` | Recorridos de trazabilidad |

Un override parcial no borra lo que no menciona:

```env
DATA_ROUTING_RULES={"views":{"consistency":"strong"}}
```

deja `views.read` y `views.write` como estaban.

## Cómo se resuelve una lectura

```text
consistency = ruta.consistency ?? regla.consistency

eventual            → conexión de lectura
read-after-write    → primario  (upgradedToPrimary = true)
strong + réplica    → primario  (upgradedToPrimary = true)
strong + mismo servidor, otro rol → conexión de lectura
```

La distinción que importa **no** es «hay dos conexiones» sino «hay dos servidores». Dos
roles distintos contra la misma base ven exactamente los mismos datos, así que ahí una
lectura fuerte es legítima y no hay razón para cargar el primario. Una réplica —otro host,
otro puerto u otra base— va por detrás, y servir desde ella una lectura declarada fuerte
sería afirmar una consistencia que no existe.

`DataSourceRouterService.isReplica()` es quien hace esa distinción, comparando host, puerto
y base de las dos huellas.

## Cómo se resuelve una escritura

Siempre `postgres-write`. No hay configuración que lo cambie por accidente: el router
**rechaza al arrancar** cualquier regla que mande una escritura a una conexión registrada
como de solo lectura, y la ruta de lectura rechaza toda operación de escritura antes de
emitir consulta alguna.

## Interruptor y rollback

`DATA_READ_ROUTING_ENABLED=false` fuerza `read-after-write` en toda lectura, es decir,
devuelve el sistema al primario. Es el rollback de esta migración: **una variable, sin
desplegar código**. El plan completo está en [plan de migración](migration-plan.md).

## Ver el enrutamiento vigente

```bash
curl -s http://localhost:3000/health/data-sources | jq
```

```json
{
  "status": "up",
  "connections": {
    "postgres-write": { "status": "up", "role": "write", "engine": "postgresql", "latencyMs": 2 },
    "postgres-read":  { "status": "up", "role": "read",  "engine": "postgresql", "latencyMs": 1 },
    "redis-cache":    { "status": "up", "role": "read-write", "engine": "redis", "detail": "redis" }
  },
  "routing": {
    "default":     { "read": "postgres-read",  "write": "postgres-write", "consistency": "strong" },
    "audit-query": { "read": "postgres-read",  "write": "postgres-write", "consistency": "eventual" },
    "runtime":     { "read": "postgres-write", "write": "postgres-write", "consistency": "read-after-write" }
  }
}
```

Ni host, ni usuario, ni base, ni cadena de conexión: la sonda es pública.

## Documentos relacionados

- [Superficie de persistencia](architecture.md)
- [Roles y privilegios PostgreSQL](postgres-roles.md)
- [Consistencia, transacciones y fallos](consistency-and-failure.md)
- [Variables de entorno](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/getting-started/environment-variables.md)
