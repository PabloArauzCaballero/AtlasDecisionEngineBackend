---
title: Verificación — {{date}}
tags:
  - evidencia
  - verificacion
---

# Verificación — {{date}}

- **Alcance:** <qué cambio o qué release se verifica>
- **Rama / commit:** <referencia exacta>
- **Ejecutado por:** <persona>

Este documento es evidencia fechada: describe lo que se comprobó hoy, no el estado permanente
del sistema. No se reescribe más adelante.

## Entorno

Infraestructura aislada y desechable, nunca la base compartida.

```bash
POSTGRES_PORT=<libre> REDIS_PORT=<libre> POSTGRES_DB=<propia> \
  docker compose -p <proyecto-propio> up -d postgres redis
```

| Componente | Versión / referencia |
| --- | --- |
| Node |  |
| PostgreSQL |  |
| Redis |  |

## Resultados

| Criterio | Comando | PASS / FAIL | Evidencia |
| --- | --- | --- | --- |
| Esquema válido | `yarn prisma:validate` |  |  |
| Cadena de migraciones | `prisma migrate deploy` |  |  |
| Tipos | `yarn typecheck` |  |  |
| Build | `yarn build` |  |  |
| Unit + integración | `yarn test` |  |  |
| Extremo a extremo | `yarn test:e2e` |  |  |
| Smoke | `yarn smoke` |  |  |
| Contrato OpenAPI | `yarn docs:openapi:check` |  |  |
| Documentación | `yarn docs:validate` |  |  |

Sin salida real no hay `PASS`. Pegue la salida literal debajo de cada gate relevante.

## Salidas

```text
<salida literal>
```

## Límites de esta corrida

Qué no se pudo verificar y **el dato externo exacto que faltó** — no una descripción vaga. Un
límite documentado es información; un límite omitido es una afirmación falsa.

## Conclusión

Qué queda demostrado, qué queda pendiente y qué decisión habilita.
