# Proceso de revisión

## Dos gobiernos distintos

!!! important "No los confunda"
    | | Revisión de **código** | Revisión de **artefacto** |
    | --- | --- | --- |
    | Qué gobierna | Cambios en el software | Cambios en la política de decisión |
    | Dónde | Pull request | Flujo de aprobación de la plataforma |
    | Quién | Ingeniería | Riesgo y cumplimiento |
    | Registro | Historial de git | Cadena de auditoría |

    Un analista cambia una política **sin** un pull request. Ese es el propósito del sistema.

## Revisión de código

### Qué se comprueba

| Dimensión | Qué se busca |
| --- | --- |
| Corrección | ¿La invariante se aplica en el servidor? ¿Falla cerrado? |
| Seguridad | ¿Toca identidad, roles, RLS, auditoría o ejecución de código? |
| Datos | ¿Tabla con tenant sin política RLS? ¿Índice para la consulta que existe? |
| Pruebas | ¿La feature trae unitaria y, si toca decisión, e2e? |
| Contrato | ¿Cambia `openapi/openapi.json`? ¿Es incompatible? |
| Documentación | ¿Requiere runbook, ADR o regeneración de catálogos? |
| Configuración | ¿Variable nueva declarada en el esquema? |

### Puertas automáticas

`format:check` · `typecheck` · `build` · `test` · `test:e2e` · `migration:validate` ·
`security:audit` · `docs:validate` · `docs:build --strict`.

Una puerta en rojo **no se salta**. Nunca se usa `--no-verify`.

### Revisión reforzada

Cambios en áreas críticas (ver [propiedad](ownership.md)) exigen además revisión de seguridad.

## Revisión de artefacto

| Paso | Regla |
| --- | --- |
| Envío a revisión | La versión debe estar compilada |
| Pasos de aprobación | En orden, con el rol exigido por paso |
| Segregación de funciones | **El autor no puede aprobar su propia versión** |
| Aprobaciones mínimas | `minApprovals` configurable por paso |
| Registro | Evento de auditoría en la **misma transacción** que el voto |

Ninguna de estas reglas depende del portal: todas se aplican en el servidor y están cubiertas
por 20 pruebas de integración.

## Antes de aprobar un artefacto

- [ ] La suite de regresión de la versión pasa
- [ ] Si cambia el contrato de entrada, hay comprobación de compatibilidad
- [ ] Los códigos de razón nuevos tienen mensaje público revisado por cumplimiento
- [ ] Una simulación con `compareWithProduction` muestra una divergencia entendida
- [ ] El impacto de negocio está descrito en las notas de la versión

## Qué hacer ante un desacuerdo

Escalar al propietario del área. Registrar el resultado: si se acepta un riesgo, se documenta
**quién** lo acepta. Un riesgo aceptado sin registro es un riesgo no evaluado.
