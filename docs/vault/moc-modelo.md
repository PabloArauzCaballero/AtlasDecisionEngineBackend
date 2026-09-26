---
title: MOC — Modelo
tags:
  - moc
  - modelo
  - datos
---

# Mapa de contenido — Modelo

Qué representa la plataforma antes de hablar de cómo lo ejecuta: el vocabulario del dominio, las
entidades persistidas y los contratos que hacen que una decisión sea reproducible.

← [Inicio](inicio.md)

## 1. Vocabulario y reglas del dominio

| Nota | Qué fija |
| --- | --- |
| [Glosario](../business/glossary.md) | El significado exacto de artefacto, versión, nodo, variable, ejecución. |
| [Contexto de negocio](../business/business-context.md) | Qué problema resuelve y para quién. |
| [Reglas de negocio](../business/business-rules.md) | Invariantes que el motor debe respetar. |
| [Actores y roles](../business/actors-and-roles.md) | Quién puede diseñar, aprobar, desplegar y consultar. |
| [Casos de uso](../business/use-cases.md) | Catálogo completo por etapa de vida, con sus actores reales y sus cadenas de inclusión. |
| [Capacidades](../business/capabilities.md) · [Flujos críticos](../business/critical-workflows.md) | Qué hace el sistema de punta a punta. |

## 2. Contratos de variables

El núcleo del modelo. Ninguna validación vive solo en el frontend: el motor de restricciones
reevalúa siempre antes de ejecutar.

- [Contratos de variables](../variable-contracts.md) — tipos canónicos, compatibilidad,
  restricciones configurables, variables intermedias con ámbito por ejecución y contrato de
  salida explícito.
- [Módulo de variables](../modules/variables.md) — la superficie real que expone el backend.
- [ADR-0011 — Extensiones de contrato](../adr/ADR-0011-contract-extensions.md) — por qué el
  contrato se extendió y qué se rechazó.
- Diagramas: [taxonomía de variables y contratos](../plantuml/23_taxonomia_variables_y_contratos.puml)
  · [ciclo de vida de una variable intermedia](../plantuml/24_ciclo_vida_variable_intermedia.puml)
  · [catálogo, linaje y snapshot](../plantuml/16_catalogo_variables_linaje_y_snapshot.puml)

Las variables intermedias no cuelgan del catálogo global: viven en su propia tabla, se
referencian como `intermediate.<code>` y su validez se valida estáticamente por dominancia en el
grafo. La salida final tampoco se infiere del último nodo: es un contrato explícito.

## 3. Lógica declarada por el analista

| Nota | Qué modela |
| --- | --- |
| [Campos calculados y QA Lab](../calculated-fields.md) | Catálogo cerrado de operaciones, guardián de código y contrato de retorno obligatorio. |
| [Salidas configurables](../CONFIGURABLE_OUTPUTS.md) | Contratos `RESULT`, mapeos y ejecución aislada. |
| [Árboles de decisión anidados](../nested-decision-trees.md) | Reutilización de políticas aprobadas por referencia versionada. |
| [Código a flujo](../code-to-flow-specification.md) | Conversión de reglas existentes en grafos gobernables. |
| [Guía del editor de flujo](../flowchart-user-guide.md) | El contrato que consume el editor visual. |

Módulos implicados: [grafo](../modules/graph.md) · [artefactos](../modules/artifacts.md) ·
[campos calculados](../modules/calculated-fields.md) · [librerías](../modules/libraries.md) ·
[árboles anidados](../modules/nested-trees.md) · [QA Lab](../modules/qa-lab.md).

## 4. Persistencia

| Nota | Qué documenta |
| --- | --- |
| [Arquitectura de datos](../data/data-architecture.md) | Cómo se organiza el almacenamiento y por qué. |
| [Catálogo de entidades](../data/entity-catalog.md) | Generado del esquema de Prisma — 75 modelos. |
| [Relaciones entre entidades](../data/relationships.md) | Los 75 modelos agrupados en 18 clústeres de dominio, cada uno con su diagrama y sus reglas de borrado. |
| [Restricciones e índices](../data/constraints-and-indexes.md) | Integridad referencial y accesos previstos. |
| [Migraciones](../data/migrations.md) | Estrategia aditiva y expand-contract. |
| [Semillas](../data/seeds.md) · [Retención](../data/retention.md) · [Clasificación](../data/classification.md) | Datos de arranque, ciclo de vida y sensibilidad. |
| [Respaldo y restauración](../data/backup-and-restore.md) | Qué se puede recuperar y en cuánto tiempo. |

Diagramas: [modelo relacional](../plantuml/01_modelo_relacional_motor_decision_atlas.puml) ·
[modelo de clases del dominio](../plantuml/02_modelo_clases_dominio_y_servicios.puml) ·
[privacidad, retención y minimización](../plantuml/19_privacidad_retencion_y_minimizacion.puml).

La regla que gobierna cualquier cambio aquí es
[base de datos y migraciones](../design-rules/80-database.md).

## 5. Del modelo a la ejecución

Una vez fijado el modelo, el recorrido continúa en
[arquitectura](moc-arquitectura.md): cómo una petición atraviesa el motor, qué se ejecuta en
segundo plano y qué evidencia queda.
