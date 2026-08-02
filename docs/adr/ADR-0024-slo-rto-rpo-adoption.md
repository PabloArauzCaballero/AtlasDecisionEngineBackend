# ADR-0024: Adopción de SLO, RTO y RPO

## Estado

Aceptado — 2026-07-31

## Contexto

[Objetivos de nivel de servicio](../observability/service-level-objectives.md) y
[recuperación ante desastres](../operations/disaster-recovery.md) llevaban sus valores marcados
como «propuestos, no acordados»: una auditoría de producción no puede declarar cerrado un
requisito de negocio que ningún responsable ha firmado. No existe, dentro del alcance de este
repositorio, un responsable de producto o de negocio distinto de quien encarga y aprueba este
trabajo. Dejar el punto abierto indefinidamente no lo resuelve — solo pospone una decisión que sí
tiene la información necesaria para tomarse: la configuración real del sistema, sus tiempos de
respuesta medidos, y el diseño de su recuperación.

## Fuerzas y restricciones

- Un objetivo inventado sin relación con el sistema real sería peor que no tener ninguno —
  fijaría una expectativa que la plataforma no puede sostener.
- Los valores propuestos en `service-level-objectives.md` y `disaster-recovery.md` ya derivaban
  de la configuración real (histograma de latencia, `VARIABLE_BACKEND_TIMEOUT_MS`, cadencia de
  WAL) y no de una cifra arbitraria.
- Un objetivo acordado debe poder revisarse cuando exista tráfico de producción real que lo
  contradiga o lo confirme.

## Opciones consideradas

| Opción | Por qué no |
| --- | --- |
| Dejar «propuesto, no acordado» indefinidamente | Bloquea permanentemente el cierre de producción sin que nadie con autoridad lo resuelva |
| Inventar un firmante ficticio | Sería una afirmación falsa sobre quién acordó qué |
| Adoptar los valores propuestos como objetivo formal, con revisión programada | Usa la única información disponible (el sistema real) y dEja trazabilidad de que es una decisión tomada, no una cifra que apareció sola |

## Decisión

Se adoptan como objetivo formal de la plataforma los indicadores, objetivos y presupuesto de
error ya calculados en
[`docs/observability/service-level-objectives.md`](../observability/service-level-objectives.md),
y el RTO/RPO ya calculados en
[`docs/operations/disaster-recovery.md`](../operations/disaster-recovery.md):

| Objetivo | Valor adoptado |
| --- | --- |
| Disponibilidad de decisión | 99,9 % / 30 días |
| Latencia p95 de decisión | < 250 ms / 30 días |
| Latencia p99 de decisión | < 1000 ms / 30 días |
| Tasa de sin-decisión | < 1 % / 7 días |
| Eventos muertos | 0, continuo |
| Integridad de la cadena de auditoría | 100 %, continuo |
| RTO (recuperación tras desastre) | 4 horas |
| RPO (pérdida admisible) | 15 minutos (con WAL continuo) |

Ambas páginas dejan de marcarse «propuesto, no acordado»; pasan a «adoptado por ADR-0024,
sujeto a revisión trimestral».

## Consecuencias positivas

- El requisito de negocio de la Fase 17 del plan de documentación queda cerrado con evidencia,
  no con una advertencia permanente.
- Los paneles y alertas pueden referenciar un umbral fijo en vez de uno «propuesto».
- La revisión trimestral da un mecanismo real para corregir el valor cuando el tráfico de
  producción lo contradiga, en vez de dejarlo abierto sin fecha.

## Consecuencias negativas

- Estos valores no fueron negociados con un responsable de producto o de negocio externo al
  equipo de ingeniería, porque ese rol no existe hoy dentro del alcance operativo del proyecto.
  Si en el futuro se incorpora, debe ratificar o corregir estos valores explícitamente.
- Sin tráfico de producción real todavía, el presupuesto de error de 99,9 % no está validado
  contra volumen real — es una extrapolación de la configuración, no de una serie histórica.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El volumen real de producción invalida el 99,9 % | Revisión trimestral obligatoria; ver plan de revisión |
| Un proveedor externo lento consume el presupuesto sin defecto de la plataforma | Ya documentado en `service-level-objectives.md`; a decidir si se excluye al acordar con negocio |

## Evidencia

- Cálculo de cada objetivo: [`service-level-objectives.md`](../observability/service-level-objectives.md).
- Cálculo de RTO/RPO: [`disaster-recovery.md`](../operations/disaster-recovery.md).
- Métricas que los sustentan: `atlas_http_requests_total`, `atlas_http_request_duration_ms`,
  `atlas_decisions_total`, `atlas_outbox_pending`, `atlas_outbox_dead_total`.

## Plan de revisión

Revisar trimestralmente contra tráfico de producción real, y de inmediato si:

- el presupuesto de error de disponibilidad se consume por encima del 50 % antes de la mitad de
  la ventana de 30 días;
- se incorpora un responsable de producto o de negocio que deba ratificar o corregir los
  valores;
- cambia `VARIABLE_BACKEND_TIMEOUT_MS` o la topología de recuperación descrita en
  `disaster-recovery.md`.
