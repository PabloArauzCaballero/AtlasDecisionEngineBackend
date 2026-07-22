---
paths:
  - "src/**/*.ts"
---

# Rendimiento

- Paginación: usa `paginationArgs`/`pageResult` de `common/http/pagination`. Para
  feeds que crecen sin cota (auditoría), recorre por cursor/keyset en lotes, no
  `findMany` sobre toda la tabla (evita OOM y DoS barato).
- No abras transacciones de base de datos alrededor de I/O de red (resolución de
  variables externas, ejecución de scripts): resuelve primero, persiste después.
- Cachea lecturas caras tenant-scoped con `CacheService` (Redis), siempre con el
  tenant en la clave.
- Acota la ejecución: `MAX_EXECUTION_STEPS`, timeouts de script y de árboles
  anidados (`NESTED_TREE_*`), tamaños máximos de fuente importada.
