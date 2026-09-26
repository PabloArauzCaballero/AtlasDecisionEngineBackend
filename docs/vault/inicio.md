---
title: Inicio de la bóveda
tags:
  - moc
  - inicio
---

# ATLAS Decision Platform — bóveda de documentación

Motor de decisión **gobernado** para crédito, riesgo y fraude. Un analista diseña un algoritmo en
un editor visual; la plataforma lo valida, lo compila a un artefacto inmutable, lo somete a
aprobaciones con segregación de funciones, lo despliega por ambiente y ejecuta cada decisión
dejando evidencia reproducible y auditable.

Esta carpeta `docs/` es a la vez el origen del portal técnico y una **bóveda de Obsidian**: el
mismo contenido, dos formas de recorrerlo. Cómo conviven, en [README de la bóveda](README.md).

## Mapas de contenido

| Mapa | Qué encontrará |
| --- | --- |
| [Modelo](moc-modelo.md) | Dominio, entidades, contratos de variables, salidas configurables. |
| [Arquitectura](moc-arquitectura.md) | Módulos, ciclo de una petición, eventos, trabajo de fondo. |
| [Reglas, prompts y skills](moc-reglas-y-prompts.md) | Cómo se decide qué cambio es aceptable y cómo se trabaja aquí. |
| [Seguridad y operación](moc-seguridad-y-operacion.md) | Aislamiento, auditoría, despliegue, observabilidad, runbooks. |
| [Decisiones y evidencia](moc-decisiones-y-evidencia.md) | ADR, informes fechados, gobierno documental. |

## Primeros pasos

- Levantar el entorno → [entorno local](../getting-started/local-setup.md) ·
  [base de datos](../getting-started/database-setup.md)
- Entender el vocabulario → [glosario](../business/glossary.md) ·
  [contexto de negocio](../business/business-context.md)
- Consumir la API → [convenciones](../api/conventions.md) ·
  [catálogo de endpoints](../api/endpoint-catalog.md)
- Antes de afirmar que algo funciona →
  [verificación de producción](../skills/production-verification.md)

## Qué distingue a este backend

No es un servicio que "calcula un score". Es un sistema de **gobierno**: la decisión que se tomó
ayer se puede reproducir hoy con el mismo artefacto, las mismas variables y el mismo resultado, y
se puede demostrar quién la autorizó. Casi todo lo que aparece en esta bóveda —contratos de
variables, artefactos inmutables, cadena de auditoría encadenada por hash, aislamiento por
tenant— existe para sostener esa afirmación.

## Documentación que se genera sola

Buena parte de estas páginas no se escribe a mano y falla si se desactualiza: el catálogo de
endpoints sale del contrato OpenAPI, el de entidades del esquema de Prisma, el de errores de las
excepciones que lanza el código, y el espejo de reglas y skills de `.claude/`.

```bash
yarn docs:openapi:generate   # contrato desde la aplicación real
yarn docs:vault              # espejo de reglas de diseño y skills
yarn docs:validate           # contrato + catálogos + espejo + cobertura + enlaces
yarn docs:build              # portal en contenedor, modo estricto
```

Ver [ADR-0023](../adr/ADR-0023-generated-documentation.md) y
[política de documentación](../governance/documentation-policy.md).
