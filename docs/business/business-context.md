# Contexto de negocio

## El problema

Una entidad financiera decide miles de veces al día si aprueba un crédito, si una operación es
fraudulenta o si un cliente requiere revisión manual. Esas decisiones tienen tres exigencias
que un servicio convencional no cubre:

1. **Reproducibilidad.** Ante una reclamación o una auditoría hay que demostrar *por qué* se
   decidió lo que se decidió, con los datos de aquel momento — no con la lógica de hoy.
2. **Gobierno.** Quien escribe una regla no puede ser quien la aprueba. Un cambio de política
   crediticia no puede llegar a producción sin dejar rastro de quién lo autorizó.
3. **Velocidad de cambio.** Ajustar un umbral no puede exigir un despliegue de software.

## La respuesta de la plataforma

| Exigencia | Cómo se cumple |
| --- | --- |
| Reproducibilidad | El artefacto se **compila** a una forma inmutable con checksum; la ejecución persiste el snapshot de variables, la ruta recorrida, las razones y los errores |
| Gobierno | Flujo `DRAFT → IN_REVIEW → APPROVED → desplegado` con segregación de funciones: el autor **no puede** aprobar su propia versión |
| Velocidad | El analista edita un grafo en el portal; no hay que recompilar el backend para cambiar una política |
| Explicabilidad | Cada decisión devuelve códigos de razón estructurados, con mensaje público (para el cliente) e interno (para el analista) |
| Aislamiento | Multi-tenant con RLS en PostgreSQL, aplicada por el motor y no por el código de aplicación |

## Qué NO es

- No es un motor de reglas genérico embebible: la unidad es el **artefacto gobernado**, no la regla suelta.
- No es una plataforma de machine learning. Ejecuta reglas y scorecards deterministas; el modelo de datos permite evolucionar hacia scorecards y ML sin romper el gobierno, pero no entrena modelos.
- No es el sistema de originación. Recibe una solicitud ya formada y devuelve una decisión con su evidencia.

## Dominios de riesgo cubiertos

`CREDIT`, `FRAUD`, `COMPLIANCE` y los que declare el catálogo. El dominio no es decorativo:
gobierna qué roles pueden aprobar una versión y cómo se agrupan las métricas.

## Restricciones que moldearon el diseño

!!! quote "Restricciones que explican decisiones que de otro modo parecen excesivas"
    - **La cadena de auditoría es append-only y encadenada por hash.** El rol de aplicación
      tiene revocados `UPDATE` y `DELETE`. Consecuencia práctica: la retención de auditoría no
      puede significar borrado, solo archivado.
    - **El código importado nunca se ejecuta en el proceso de la API.** Un nodo de script corre
      en un contenedor sin red, con capacidades eliminadas y bajo gVisor.
    - **Ninguna validación vive solo en el frontend.** El motor reevalúa las restricciones antes
      de ejecutar, siempre.

Siguiente: [actores y roles](actors-and-roles.md) · [capacidades](capabilities.md).
