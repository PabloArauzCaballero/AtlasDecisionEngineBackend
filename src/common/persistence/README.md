# `common/persistence`

Superficie de acceso a datos: puertos sin infraestructura, registro de conexiones,
enrutamiento declarativo entre lectura y escritura, fábrica de adaptadores y errores
normalizados.

Decisión y alternativas: [ADR-0029](../../../docs/adr/ADR-0029-polyglot-persistence-read-write.md).
Manual completo: [superficie de persistencia](../../../docs/data/persistence/architecture.md).

## Qué hay aquí

| Carpeta | Responsabilidad |
| --- | --- |
| `ports/` | Vocabulario y contratos. **No importa Prisma, `pg` ni nada del driver** |
| `connections/` | Pools, huellas saneadas, ciclo de vida, salud |
| `routing/` | Reglas declarativas y resolución módulo → conexión |
| `factory/` | Asas de lectura y escritura, validadas al construir el adaptador |
| `adapters/postgres/` | Ejecución, fallback declarado, transacciones, métricas |
| `errors/` | Jerarquía tipada y traducción de SQLSTATE |
| `health/` | `/health/data-sources` y muestreo de pools |

Los dos clientes viven en `common/prisma/`: `prisma.service.ts` (escritura, nombre y
superficie de siempre), `prisma-read.service.ts` (lectura, rechaza escrituras) y
`tenant-rls.ts`, el proxy de tenancy que ambos comparten.

## Cómo se usa desde un módulo

Un módulo de dominio **no** inyecta un cliente ni nombra una conexión. Declara un puerto y
lo liga a un adaptador:

```ts
// ports/mi-dominio-read.port.ts — sin Prisma, sin SQL
export const MI_READ_PORT = Symbol('MiDominioReadPort');
export interface MiDominioReadPort {
  buscarPorTenant(tenantId: bigint): Promise<CountedRows<MiLectura>>;
}

// adapters/postgres-mi-dominio-read.adapter.ts — la única capa que habla Prisma
@Injectable()
export class PostgresMiDominioReadAdapter implements MiDominioReadPort {
  private readonly reads: ReadAdapterHandle;

  constructor(factory: PersistenceAdapterFactory) {
    // Si la ruta del módulo no ofrece lo que se pide, el contenedor NO levanta.
    this.reads = factory.createReadAdapter({
      module: 'mi-dominio',
      engine: 'postgresql',
      requires: ['rowLevelSecurity'],
    });
  }

  buscarPorTenant(tenantId: bigint) {
    return this.reads.run('buscarPorTenant', async (client) => { /* … */ });
  }
}

// mi-dominio.module.ts — una línea decide la implementación
providers: [
  PostgresMiDominioReadAdapter,
  { provide: MI_READ_PORT, useExisting: PostgresMiDominioReadAdapter },
]
```

Para escribir, `WritePathService` ofrece `run()` y `execute()` (transacción interactiva).
El `TransactionContext` es opaco a propósito: se puede pasar a otro puerto, pero no permite
emitir consultas por cuenta propia.

El ejemplo real y completo es el módulo piloto: `src/modules/audit-query/`.

## Invariantes que no se deben romper

1. **`ports/` no importa infraestructura.** Es lo que permite que la suite de contrato la
   supere una implementación en memoria.
2. **`postgres-admin` no se registra.** Una conexión administrativa alcanzable por
   inyección acaba inyectada en un caso de uso ordinario.
3. **La huella no lleva la contraseña.** Se imprime en logs, métricas y en la sonda pública.
4. **Ningún fallback es silencioso.** Log estructurado + `atlas_database_fallback_total`.
5. **El mensaje del driver no sube.** Va en `cause`, para observabilidad interna.
6. **Toda transacción va por la ruta de escritura.** Validado al arrancar y en el cliente.
7. **Las etiquetas de métrica son catálogos cerrados del código**, nunca entrada del
   llamante.

## Pruebas

`test/persistence-*.spec.ts` y `test/decision-audit-read-port.contract.spec.ts` no necesitan
base de datos: construir un `Pool` no abre sesión y los rechazos ocurren antes de emitir
consulta. `test/postgres-role-privileges.integration.spec.ts` sí la necesita, con los roles
aprovisionados por `yarn db:provision:dev`.
