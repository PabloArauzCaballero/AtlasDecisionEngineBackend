# Plan de migración, rollback y despliegue

Migración progresiva **expand → migrate → switch → contract**. Nunca se migran todos los
módulos a la vez, y la implementación anterior no se retira hasta que la nueva esté
validada.

## Estado por fases

| Fase | Contenido | Estado |
| --- | --- | --- |
| **Expand** | Puertos, registro, router, fábrica, errores, dos clientes, salud, métricas | ✅ Completa |
| **Migrate** | `audit-query` migrado a puerto; el resto sin tocar | ✅ Completa |
| **Switch** | Interruptor `DATA_READ_ROUTING_ENABLED`, rollback probado | ✅ Disponible, **apagado por defecto** |
| **Contract** | Retirar accesos directos módulo a módulo | ⏳ En curso, con orden declarado |

## Compatibilidad garantizada

Con `DATABASE_WRITE_URL`, `DATABASE_READ_URL` y `DATA_ROUTING_RULES` vacías y
`DATA_READ_ROUTING_ENABLED=false`, el comportamiento es **idéntico** al anterior:

- `DATABASE_URL` sigue siendo la única variable de base de datos obligatoria.
- Un solo pool, porque las huellas coinciden y el registro reutiliza la conexión.
- `PrismaService` conserva su nombre, su símbolo de inyección y su superficie: los 30
  módulos que lo inyectan no cambiaron ni una línea.
- Toda lectura vuelve al primario, así que ninguna consulta cambia de origen.

Lo que sí cambia sin configuración alguna: el arranque valida más cosas, hay métricas
nuevas y existe `/health/data-sources`.

## Orden de migración de los módulos restantes

Por riesgo ascendente, un módulo por PR, cada uno con su suite de contrato:

1. **`views`, `traceability`** — solo lectura, sin transacciones. Mismo patrón que el
   piloto. Ganancia inmediata: sus consultas pueden ir a la réplica.
2. **`notifications`, `variables`** — lectura primero, escritura después.
3. **`artifacts`, `graph`, `manual-review`, `testing`, `qa-lab`** — puertos de comandos con
   `TransactionManager`.
4. **`deployments`, `governance`, `runtime`** — los últimos, porque son el camino de
   decisión y el de aprobación. Se migran cuando el patrón esté rodado, no antes.

**No se migran**: `outbox-relay` y `seeding`. Manipulan el mecanismo de persistencia en sí
—`FOR UPDATE SKIP LOCKED`, bloqueos consultivos, `pg_notify`— y envolverlos en un puerto
agnóstico del motor escondería el acoplamiento tras una interfaz que solo PostgreSQL podría
implementar. Queda declarado en el [inventario](source-inventory.md).

## Activar la separación de rutas

```bash
# 1. Aprovisionar los roles (idempotente, verificado contra el motor)
yarn db:provision:dev

# 2. Declarar la conexión de lectura
#    DATABASE_READ_URL=postgresql://atlas_reader:<secreto>@host:5432/atlas_decision?schema=public

# 3. Comprobar que el arranque reconoce dos conexiones
curl -s localhost:3000/health/data-sources | jq '.connections'

# 4. Encender el interruptor
#    DATA_READ_ROUTING_ENABLED=true

# 5. Verificar que la lectura viaja por la ruta nueva
curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/v1/audit/events?pageSize=1 >/dev/null
curl -s localhost:3000/metrics -H "X-Metrics-Token: $METRICS_TOKEN" \
  | grep 'atlas_database_operation_total{.*connection="postgres-read"'
```

## Checklist de despliegue

- [ ] `prisma migrate deploy` con el rol elevado.
- [ ] Aprovisionar roles para que los `GRANT` alcancen las tablas nuevas.
- [ ] Verificar que el escritor puede insertar y el lector no.
- [ ] Desplegar con `DATA_READ_ROUTING_ENABLED=false`.
- [ ] Comprobar `/health/data-sources`: todas las conexiones `up`.
- [ ] Comprobar que `atlas_database_connection_failures_total` está a cero.
- [ ] Encender el interruptor en un solo entorno y observar una ventana completa.
- [ ] Vigilar `atlas_database_fallback_total`: si sube, la ruta de lectura está enferma.
- [ ] Comparar la latencia `atlas_database_operation_duration_ms` entre las dos conexiones.

## Checklist de rollback

Por orden de coste, de menor a mayor:

| Síntoma | Acción | Coste |
| --- | --- | --- |
| Lecturas lentas o incoherentes | `DATA_READ_ROUTING_ENABLED=false` | Reinicio, **sin desplegar** |
| Réplica caída y fallback ruidoso | `DATABASE_READ_URL=` (vacía) | Reinicio; vuelve al Escenario A |
| Rol lector mal aprovisionado | Reejecutar `yarn db:provision:dev` | Sin reinicio |
| Regla de enrutamiento equivocada | `DATA_ROUTING_RULES=` (vacía) | Reinicio; vuelve a las reglas base |
| Problema en la capa completa | Revertir el commit | Despliegue |

Los cuatro primeros no tocan código. Esa es la razón de que el interruptor exista.

## Deuda técnica declarada

1. **30 módulos siguen inyectando `PrismaService`.** Deliberado; el orden está arriba.
2. **Dos clientes de Prisma en memoria** cuando lectura y escritura comparten pool. Cuesta
   memoria de proceso, no conexiones; se aceptó a cambio de que la guardia de solo lectura
   sea real y comprobable en los dos escenarios.
3. **`AuditReadModel` es opaco** (`Record<string, unknown>`) para las proyecciones que el
   módulo sirve sin inspeccionar. Tiparlas con el payload generado por Prisma metería el
   ORM en el puerto; tiparlas a mano duplicaría el esquema. Se revisará cuando exista una
   segunda implementación real sobre otro motor.
4. **El fallback solo cubre la ruta de lectura.** Una escritura no se reintenta en otra
   conexión, y no debe: no hay a dónde ir sin romper la atomicidad.

## Documentos relacionados

- [Superficie de persistencia](architecture.md)
- [Inventario de fuentes de datos](source-inventory.md)
- [Pruebas y evidencia](testing-and-evidence.md)
- [ADR-0029](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/adr/ADR-0029-polyglot-persistence-read-write.md)
