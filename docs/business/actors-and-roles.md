# Actores y roles

## Actores

| Actor | Cómo entra | Qué hace |
| --- | --- | --- |
| Analista de riesgo / fraude | Portal, sesión contra el proveedor de identidad | Diseña variables, algoritmos y pruebas |
| Aprobador de riesgo | Portal | Aprueba o rechaza una versión; **no** puede aprobar la suya |
| Analista de QA | Portal | Ejecuta suites de regresión y corridas generativas |
| Cumplimiento / auditoría | Portal | Consulta ejecuciones, evidencia y la cadena de auditoría |
| Operaciones | Portal y herramientas | Despliega, revierte, opera incidentes |
| Canal de originación | Integración técnica (API key o JWT) | Pide decisiones en línea |
| Orquestador de contenedores | Sin credencial | Consulta las sondas de salud |

## Roles de plataforma

Catálogo único en `src/common/security/platform-roles.ts`. Un nombre divergente no es una
errata: un paso de aprobación que exige un rol que ninguna identidad puede tener se vuelve
**insatisfacible en silencio**, y una guarda que comprueba el comodín equivocado es un agujero
de autorización. Por eso los nombres están centralizados y tipados.

| Rol | Para qué |
| --- | --- |
| `PLATFORM_ADMIN` | Comodín global. **Solo se honra en identidades firmadas por el proveedor de identidad, nunca en una API key** |
| `RISK_ANALYST` | Autoría de artefactos y variables de crédito |
| `FRAUD_ANALYST` | Autoría en el dominio de fraude |
| `QA_ANALYST` | Suites de prueba y QA Lab |
| `RISK_APPROVER` | Aprobación de versiones |
| `COMPLIANCE` | Revisión de cumplimiento y consulta de evidencia |
| `AUDITOR` | Solo lectura sobre auditoría y ejecuciones |
| `OPERATIONS` | Despliegues y operación |

## De dónde salen los roles: la decisión que importa

!!! danger "Un llamante nunca declara su propia identidad"
    Las cabeceras `x-principal-id` y `x-roles` **no existen** en esta API: ni se aceptan ni
    figuran en la lista de CORS. Los roles se resuelven así:

    | Modo | Origen de la identidad y los roles |
    | --- | --- |
    | API key | Registro de clientes de integración en base de datos (`integration_client` + scopes) |
    | JWT | Reclamaciones firmadas del token, verificadas contra JWKS |
    | Proveedor de identidad | Respuesta del proveedor, mapeada por `identity-role-mapper.ts` |

    Aceptar roles del llamante convertiría cualquier integración en administrador de la
    plataforma con una cabecera.

## Segregación de funciones

La regla que gobierna el flujo de aprobación: **el autor de una versión no puede aprobarla**.
Se comprueba en el servidor (`governance.service.ts`), está cubierta por 20 pruebas de
integración y no depende de ocultar un botón en el portal.

Ver [flujos críticos](critical-workflows.md) y [control de acceso](../security/access-control.md).
