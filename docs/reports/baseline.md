# Línea base

Estado del repositorio al comenzar el trabajo de documentación y separación de procesos, con
salida real de cada comando. Sirve para poder comparar el «después» con algo verificable.

**Fecha:** 2026-07-31 · **Commit del grafo analizado:** `50f9f7ce9dd5d37a626926f3e4f99c886b5002e9`

## Inventario del sistema

| Aspecto | Valor |
| --- | --- |
| Framework | NestJS 11 (Node 22) |
| Gestor de paquetes | Yarn 1.x, lockfile fijado |
| ORM y motor | Prisma 6 + `@prisma/adapter-pg` · PostgreSQL 16 |
| Caché y coordinación | Redis 7 (`ioredis`) |
| Mensajería | Outbox transaccional + bus en proceso; **sin broker externo** |
| Autenticación | API key (registro en BD), JWT (JWKS), proveedor de identidad |
| Pruebas | Jest; unitarias, integración y e2e |
| Observabilidad | `pino`, `prom-client`, OpenTelemetry |
| Módulos de dominio | 24 |
| Entidades persistentes | 68 |
| Endpoints HTTP | 108 operaciones en 96 rutas |
| Códigos de error de dominio | 163 |
| Variables de entorno declaradas | 105 |
| Migraciones | Escritas a mano, aplicadas con `migrate deploy` |

## Puertas ejecutadas

| Puerta | Comando | Resultado |
| --- | --- | --- |
| Formato | `yarn format:check` | ✅ |
| Tipos | `yarn typecheck` | ✅ |
| Compilación | `yarn build` | ✅ |
| Pruebas | `yarn test` | ✅ 81 suites · 648 pruebas · 2 saltadas |
| Extremo a extremo | `yarn test:e2e` | ✅ 12 suites · 62 pruebas |
| Humo | `node scripts/smoke.mjs` | ✅ 5/5 contra instancia real |
| Compose | `docker compose config` | ✅ |

Los 2 saltados son deliberados: casos de socket Unix del sidecar, no aplicables en Windows.

## Grafo de conocimiento

| Métrica | Valor |
| --- | --- |
| Nodos | 2724 |
| Relaciones | 6056 |
| Comunidades | 295 |
| Ciclos entre módulos de dominio | **0** |
| Nodos huérfanos | 15 (configuración y documentos sueltos) |
| Ficheros del grafo ausentes en disco | **0** |

Detalle en [auditoría Graphify](graphify-audit.md).

## Estado documental de partida

| Área | Estado inicial |
| --- | --- |
| Contrato de API | Solo en tiempo de ejecución, con Swagger; **sin artefacto versionado** |
| Gobierno del contrato | Inexistente |
| Portal técnico | Inexistente; documentos sueltos en `docs/` |
| Arquitectura C4 | Parcial (PlantUML) |
| ADR | Uno (ADR-0011) |
| Catálogo de datos | Inexistente como documento |
| Catálogo de eventos | Inexistente como documento |
| Modelo de amenazas | Inexistente |
| Runbooks | 4 (operación, contratos, campos calculados, QA) |
| Matriz de trazabilidad | Inexistente |
| CI/CD documental | Inexistente |

## Hallazgos con impacto encontrados en esta fase

| # | Hallazgo | Naturaleza |
| --- | --- | --- |
| B1 | El worker de corridas de prueba **no tenía interruptor**: se arrancaba en todo proceso que cargara su módulo | Operacional |
| B2 | Los tres trabajos de fondo corrían en cada réplica de API, compitiendo por su pool de conexiones | Operacional |
| B3 | El contrato de API no existía como artefacto: no se podía gobernar ni generar clientes | Documental |
| B4 | 217 errores de linting estructural en el contrato generado por primera vez | Documental |
| B5 | Dos operaciones compartían `operationId` (`/health` y `/health/live`) | Defecto de contrato |
| B6 | 72 operaciones sin esquema del cuerpo de respuesta | Deuda de contrato |

B1–B5 quedaron corregidos. B6 quedó **registrado con trinquete**: no puede crecer. Ver
[análisis de brechas](documentation-gap-analysis.md).

## Riesgos iniciales identificados

| Riesgo | Estado |
| --- | --- |
| Nadie ejecuta los trabajos de fondo tras separar procesos | Mitigado: registro explícito, `role` en la sonda, alerta propuesta |
| El grafo de conocimiento se desactualiza | Mitigado: la auditoría detecta la divergencia; los catálogos se generan del código |
| La documentación envejece | Mitigado: se genera y se valida en CI |
| Dos pruebas sensibles a la carga | Documentado; no deben entrar en un gate bloqueante |
