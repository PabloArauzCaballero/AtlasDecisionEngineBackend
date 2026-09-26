---
title: Módulo — <nombre>
tags:
  - modulo
---

# Módulo — <nombre>

## Qué resuelve

Una o dos frases en lenguaje de negocio: qué capacidad aporta y a qué rol sirve. Si no se puede
escribir sin nombrar clases, el módulo probablemente no tiene una responsabilidad clara.

## Superficie

| Endpoint | Roles | Idempotente | Descripción |
| --- | --- | --- | --- |
|  |  |  |  |

El catálogo de endpoints del portal se genera del contrato OpenAPI; esta tabla solo destaca lo
que un lector necesita para orientarse.

## Modelo de datos

| Tabla | Ámbito de tenant | RLS | Notas |
| --- | --- | --- | --- |
|  |  |  |  |

## Invariantes

Lo que debe seguir siendo cierto después de cualquier cambio. Por ejemplo: el motor falla cerrado
ante una entrada faltante; la acción y su auditoría se persisten en la misma transacción.

## Dependencias

- Módulos de los que depende:
- Módulos que dependen de él:
- Colaboraciones opcionales pasadas como argumento de llamada, no como dependencia de
  constructor (evita ciclos).

## Eventos emitidos y consumidos

| Evento | Dirección | Semántica de entrega |
| --- | --- | --- |
|  |  |  |

## Configuración

Variables de entorno que gobiernan su comportamiento y sus límites.

## Pruebas

- Unitarias: `src/modules/<nombre>/**/*.spec.ts`
- E2E: `test/e2e/<nombre>*.e2e-spec.ts`
- Qué camino crítico cubre el e2e y qué queda deliberadamente fuera.

## Límites conocidos

Lo que hoy no hace, para que nadie lo asuma.
