---
title: "Reglas de diseño"
tags:
  - reglas-de-diseno
  - indice
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/rules/. Ejecute `yarn docs:vault` tras cambiarla. -->

# Reglas de diseño

Estas reglas fijan qué se considera un cambio aceptable en este backend: precedencia de
requisitos, forma de los módulos NestJS, invariantes de seguridad, uso de Prisma y
PostgreSQL, evidencia exigida a una prueba y criterios para incorporar una dependencia.
A nivel de negocio protegen las garantías que la plataforma promete —decisiones
reproducibles, aisladas por tenant y auditables—; a nivel de sistema evitan que cada
contribución reinvente una convención ya resuelta.

!!! warning "Páginas generadas"
    La fuente canónica vive en `.claude/rules/`, porque la herramienta de asistencia las
    carga desde ahí por ruta de archivo. Estas páginas son un espejo: edite la regla en su
    origen y ejecute `yarn docs:vault`. `yarn docs:validate` falla si el espejo se separa
    de la fuente.

| Regla | Archivo fuente | Alcance |
| --- | --- | --- |
| [Gobernanza y precedencia](00-governance.md) | `00-governance.md` | todo el repositorio |
| [Arquitectura backend (NestJS)](10-backend-architecture.md) | `10-backend-architecture.md` | `src/**/*.ts` |
| [Clean code](20-clean-code.md) | `20-clean-code.md` | `src/**/*.ts` |
| [Seguridad](30-security.md) | `30-security.md` | `src/**/*.ts` · `prisma/**` |
| [Observabilidad](40-observability.md) | `40-observability.md` | `src/**/*.ts` |
| [Rendimiento](50-performance.md) | `50-performance.md` | `src/**/*.ts` |
| [Pruebas](60-testing.md) | `60-testing.md` | `src/**/*.ts` · `test/**/*.ts` |
| [Selección de librerías](70-library-selection.md) | `70-library-selection.md` | todo el repositorio |
| [Base de datos y migraciones (Prisma + PostgreSQL)](80-database.md) | `80-database.md` | `prisma/**` · `src/common/prisma/**` |
| [Documentación](90-documentation.md) | `90-documentation.md` | todo el repositorio |

## Cómo se relacionan con el resto de la documentación

Una regla dice *qué exigir*; el documento de dominio dice *cómo está construido*. Cuando
ambos hablan del mismo tema, el orden de precedencia es el de
[gobernanza](00-governance.md): requisitos aprobados, luego contratos y migraciones
vigentes, luego el código y sus pruebas, y solo al final un supuesto documentado.

- Seguridad → [arquitectura de seguridad](../security/security-architecture.md) ·
  [aislamiento por tenant](../security/tenant-isolation.md)
- Datos → [arquitectura de datos](../data/data-architecture.md) ·
  [migraciones](../data/migrations.md)
- Pruebas → [estrategia de pruebas](../testing/strategy.md)
- Documentación → [política de documentación](../governance/documentation-policy.md)
