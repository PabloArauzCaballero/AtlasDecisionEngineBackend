# ADR-0025: Umbral de archivado de `decision_execution`

## Estado

Aceptado — 2026-07-31

## Contexto

`decision_execution` y sus tablas satélite (`decision_execution_variable`,
`decision_execution_step`, `decision_execution_reason`, `decision_execution_error`) no tienen
purga automática — a diferencia de `decision_runtime_idempotency` — porque cada fila es la
evidencia de una decisión de riesgo o fraude ya comunicada a un solicitante. Sin un umbral,
la tabla crece sin cota indefinidamente y [`retention.md`](../data/retention.md) quedaba con
«el umbral de archivado es una decisión de negocio y de cumplimiento, no técnica» sin resolver.
El motivo por el que seguía abierto es real: el plazo exacto depende del régimen regulatorio
del mercado donde opere cada tenant, y ese régimen no está fijado en este repositorio ni existe
hoy un responsable de cumplimiento externo que lo determine con autoridad.

No fijar un valor no es neutral: cada trimestre sin decisión es un trimestre de crecimiento sin
plan de archivado, y el riesgo de negocio de guardar de más (coste, superficie de exposición) es
menor que el de borrar de menos — nunca se propone borrar `decision_execution`, solo archivar.

## Fuerzas y restricciones

- El motor decide crédito, fraude y similares: la evidencia de una decisión adversa suele tener
  requisitos de conservación medidos en **años**, no meses, en la mayoría de regímenes
  financieros conocidos (por ejemplo, evidencia de decisión crediticia bajo marcos como ECOA/
  Reg B en EE. UU. exige conservación de más de dos años; controles antifraude y AML suelen
  exigir cinco años o más; auditorías financieras tipo SOX suelen exigir siete). Ninguno de
  estos marcos está confirmado como aplicable a un tenant concreto de esta plataforma — se usan
  aquí solo como referencia de orden de magnitud, no como cita normativa vinculante.
- El mecanismo de archivado (exportación de solo lectura + índice por rango temporal) ya existe
  vía `@@index([tenantId, executedAt])`; falta el umbral, no la capacidad técnica.
- Un umbral demasiado corto arriesga borrar evidencia que un regulador todavía puede exigir; uno
  demasiado largo solo cuesta almacenamiento — la asimetría de riesgo favorece un valor
  conservador por defecto.
- El umbral debe ser **por tenant**, porque cada mercado puede tener un régimen distinto; un
  valor único global es el punto de partida, no la forma final.

## Opciones consideradas

| Opción | Por qué no |
| --- | --- |
| Dejarlo indefinidamente sin decidir | Es la situación actual; no cierra el requisito de la auditoría de producción y no protege contra crecimiento sin cota |
| Adoptar el mínimo observado (ECOA, ~2 años) | Insuficiente frente a regímenes AML/SOX más largos que también pueden aplicar |
| Adoptar el máximo observado sin límite superior | Equivale a «nunca archivar», que no resuelve el crecimiento sin cota |
| Adoptar un valor conservador de orden de magnitud (7 años) como línea base ajustable por tenant | Cierra el requisito hoy con un valor defendible, deja la capacidad de ajustarlo por tenant cuando cumplimiento confirme el régimen aplicable |

## Decisión

Se adopta **7 años desde `executedAt`** como umbral de archivado por defecto de
`decision_execution` y sus satélites, aplicado tenant por tenant:

1. Es una línea base conservadora de orden de magnitud frente a los regímenes financieros de
   conservación de evidencia más comunes citados arriba, elegida para minimizar el riesgo de
   archivar evidencia que un regulador todavía pudiera exigir.
2. **Archivar no es borrar.** Pasado el umbral, las filas se exportan a almacenamiento de solo
   lectura (mismo patrón que la exportación de auditoría) y se retiran de las tablas operativas;
   no se eliminan del todo. El mecanismo de exportación reutiliza el índice
   `[tenantId, executedAt]` ya existente.
3. El valor es **configurable por tenant**: cuando cumplimiento confirme el régimen regulatorio
   real de un mercado, ese tenant puede fijar su propio umbral sin cambiar el mecanismo. Hasta
   entonces, todos heredan el valor por defecto de esta decisión.
4. Este ADR **no** implementa el job de archivado en este cierre — fija el umbral y dej a
   registrada la decisión que bloqueaba su implementación. Implementar el job (un worker
   periódico análogo a `RetentionSweeperService`, pero que exporta en vez de purgar) es trabajo
   de ingeniería de seguimiento, ya no bloqueado por una decisión de negocio pendiente.

## Consecuencias positivas

- El requisito de la Fase 17 (`docs/reports/production-readiness.md`, R4) queda cerrado con una
  decisión trazable en vez de un punto abierto sin dueño.
- `retention.md` puede dejar de decir «pendiente de decisión de negocio» y describir un valor
  concreto con su justificación.
- El mecanismo de archivado puede implementarse contra un umbral conocido en vez de quedar
  bloqueado indefinidamente.

## Consecuencias negativas

- El valor de 7 años es una decisión de ingeniería tomada por ausencia de un responsable de
  cumplimiento formal, no una confirmación legal de que ese es el plazo correcto para cada
  mercado donde opere un tenant real. Debe tratarse como línea base, no como asesoría legal.
- Si el régimen real de un tenant exige un plazo más largo, ese tenant debe fijar su propio
  valor **antes** de operar con datos reales bajo ese régimen — este ADR no lo hace por él.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El plazo de 7 años resulta corto para un régimen específico | Umbral configurable por tenant; revisar antes de operar en un mercado nuevo |
| El job de archivado no se implementa a tiempo | El umbral no depende del job: mientras no exista, `decision_execution` simplemente sigue sin purga, que es el comportamiento actual y seguro por defecto |

## Evidencia

- Índice existente: `@@index([tenantId, executedAt])` en `prisma/schema.prisma` (modelo
  `DecisionExecution`).
- Estado previo del bloqueo: [`retention.md`](../data/retention.md) y
  [`maintenance.md`](../operations/maintenance.md).
- Patrón de exportación de solo lectura ya usado para auditoría:
  [`auditability.md`](../security/auditability.md).

## Plan de revisión

Revisar cuando:

- se confirme el régimen regulatorio real de un tenant concreto (el umbral de ese tenant se
  ajusta entonces, sin esperar a los demás);
- se implemente el job de archivado, momento en el que este ADR pasa de fijar un umbral teórico
  a gobernar un mecanismo activo;
- se incorpore un responsable de cumplimiento formal que deba ratificar o corregir el valor.
