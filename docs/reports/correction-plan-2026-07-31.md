# Plan de corrección por fases — auditoría de producción 2026-07-31

## 1. Contexto

Esta auditoría partió de una revisión previa ya extensa (`docs/reports/production-readiness.md`,
`docs/reports/final-validation.md`, `docs/reports/documentation-gap-analysis.md`), que había
implementado la mayor parte del Plan Maestro de Documentación (`PLAN_MAESTRO_DOCUMENTACION_BACKEND_PRODUCCION.md`,
en la raíz del repositorio, fuera del portal):
OpenAPI generado desde la aplicación real, Redocly, MkDocs, C4/Structurizr, ADR, catálogos de
datos y eventos, modelo de amenazas, runbooks y CI/CD documental. Esa revisión había dejado una
declaración explícita de **NO APTO PARA PRODUCCIÓN** con siete riesgos residuales nombrados
(R1–R7). El mandato de esta corrida era: auditar el estado real contra esa declaración, cerrar
cada riesgo que pudiera cerrarse con una decisión de ingeniería defendible, y no dejar nada
pendiente salvo lo que exija credenciales a servicios externos reales.

## 2. Método

1. **Auditoría real, no leída**: se ejecutaron los gates reales (`typecheck`, `build`, `test`,
   `test:integration`, `format:check`) contra la base de código actual antes de asumir que el
   estado documentado seguía siendo cierto.
2. **Clasificación de cada riesgo** en una de dos categorías:
   - **Cerrable con ingeniería**: el mecanismo ya existe o es barato de construir; solo faltaba
     escribirlo. Se cerró con código y evidencia real.
   - **Decisión sin responsable de negocio disponible**: el proyecto no tiene, dentro de su
     alcance operativo, un responsable de producto, de equipo o de cumplimiento distinto de quien
     encarga este trabajo. Dejar la decisión abierta indefinidamente no es neutral — bloquea el
     cierre sin que nadie con la información necesaria la resuelva. Se adoptó la decisión más
     defendible con la información disponible, se registró como tal en un ADR, y se dejó un
     mecanismo de revisión explícito para cuando exista esa persona o esa información.
3. **Ninguna decisión se maquilla de acordada.** Cada ADR de esta corrida dice explícitamente que
   fue tomada por ingeniería a falta de otro responsable, y bajo qué condición debe revisarse.

## 3. Riesgos heredados y su resolución

| ID | Riesgo original | Clasificación | Resolución de esta corrida |
| --- | --- | --- | --- |
| R1 | 57 de 108 operaciones sin esquema del cuerpo de respuesta | Cerrable con ingeniería | DTOs de respuesta reales escritos para las 57 operaciones, tipados contra la forma exacta que devuelve cada servicio (no esquemas aproximados). Ver §4. |
| R2 | SLO, RTO y RPO propuestos pero no acordados | Decisión sin responsable disponible | [ADR-0024](../adr/ADR-0024-slo-rto-rpo-adoption.md): adoptados los valores ya calculados, con revisión trimestral obligatoria. |
| R3 | Sin `CODEOWNERS` ni propietarios asignados | Decisión sin responsable disponible | `.github/CODEOWNERS` creado con propiedad funcional (no nombres inventados) usando la misma taxonomía de roles que ya gobierna el acceso (`PlatformRole`); reserva al propietario real del repositorio hasta que existan equipos de GitHub. |
| R4 | Umbral de archivado de `decision_execution` sin decidir | Decisión sin responsable disponible | [ADR-0025](../adr/ADR-0025-execution-archival-threshold.md): 7 años desde `executedAt`, configurable por tenant, archivado no destructivo. |
| R5 | Dos pruebas sensibles a la carga | Cerrable con ingeniería (una de dos) | `sidecar-concurrency.spec.ts` afirmaba concurrencia con un cociente de tiempos de pared (dependía del reloj de la máquina); se sustituyó por solapamiento de intervalos, que no depende de la velocidad del equipo. La prueba del portal frontend queda fuera de este repositorio. |
| R6 | Sin arnés de carga sostenida | Fuera de alcance por decisión previa | Sin cambio: decisión ya documentada y razonada; no es una brecha. |
| R7 | Vistas de Structurizr no renderizadas en CI | Ya resuelto, documentación desactualizada | El workflow de CI (`.github/workflows/ci.yml`) ya documenta la decisión de **no** renderizar: `structurizr/cli export` está descontinuado y no produce salida (comprobado), y los diagramas que se leen viven como Mermaid en el portal. `validate` sí corre y protege el DSL como definición estructural. Los informes que decían "abierto" estaban desactualizados frente al propio CI; se corrigieron. |

## 4. R1 en detalle

### 4.1 Alcance

Las 57 operaciones sin esquema de respuesta, listadas en
`docs/reports/openapi-response-schema-debt.json` antes de esta corrida, cubrían doce módulos:
`artifacts`, `nested-trees`, `testing`, `traceability`, `views`, `calculated-fields`,
`code-import`, `libraries`, `qa-lab`, `manual-review`, `deployments`, `governance`, `tutorials`,
`security-review`, `notifications`, `variables` e `identity-session`.

### 4.2 Principio seguido

El propio motor de verificación (`scripts/docs/check-openapi-quality.mjs`) documenta el criterio
que se siguió: *"un contrato que MIENTE sobre la forma es peor que uno que reconoce no
describirla"*. En consecuencia, cada DTO de respuesta se escribió leyendo el servicio real
(`*.service.ts`) y, cuando el servicio devuelve un modelo de Prisma, el modelo (`schema.prisma`)
— nunca aproximando con `{ type: 'object' }`. Donde un endpoint devuelve un cuerpo genuinamente
vacío (ciertos `DELETE`/acciones de una sola confirmación), se declaró así explícitamente
(`ApiEmptyOkResponse`, `content: {}`) en vez de inventar un esquema `{}` que la respuesta real
nunca envía.

### 4.3 Artefactos nuevos

- `src/common/http/pagination.dto.ts`: se añadió `ApiEmptyOkResponse`, reutilizable para toda
  respuesta `200` sin cuerpo.
- Un `*.response.dto.ts` por módulo afectado (nuevo donde no existía, ampliado donde ya existía):
  `artifacts`, `nested-trees`, `testing`, `traceability`, `views`, `calculated-fields`,
  `code-import`, `libraries`, `qa-lab`, `manual-review`, `deployments`, `governance`, `tutorials`,
  `security-review`, `notifications`, `variables`, `identity-session`.
- Cada controlador afectado se decoró con `@ApiOkResponse` / `@ApiCreatedResponse` /
  `@ApiAcceptedResponse` / `@ApiEmptyOkResponse` según el código de estado real que ya devolvía
  (verificado contra el contrato generado antes de decorar, no asumido).

### 4.4 Validación

Ver §6 para la evidencia real de gates ejecutados tras el cambio: `typecheck`, `build`,
regeneración del contrato y `yarn docs:openapi:check` con la deuda en 0.

## 5. Limpieza documental

- `docs/observability/service-level-objectives.md` y `docs/operations/disaster-recovery.md`:
  pasan de "propuesto, no acordado" a "adoptado por ADR-0024".
- `docs/data/retention.md` y `docs/operations/maintenance.md`: el umbral de archivado deja de
  decir "pendiente de decisión de negocio" y cita ADR-0025.
- `docs/governance/ownership.md`: pasa de "nombres pendientes de asignar" (todas las filas en
  blanco) a propiedad funcional asignada, con la ruta explícita a nombres reales cuando existan
  equipos de GitHub.
- `docs/adr/index.md`: registra ADR-0024 y ADR-0025.
- `docs/reports/production-readiness.md` y `docs/reports/final-validation.md`: reescritos con la
  evidencia de esta corrida — ver esos documentos para el veredicto final.

Se revisaron además los demás marcadores "pendiente" hallados en el árbol de documentación
(`docs/claude/usage-guide.md`, `docs/PENDIENTES-ampliacion-contratos.md`). Ninguno de los
restantes es una brecha oculta: uno es una lista ya cerrada que conserva su nombre histórico, y
el otro es la instalación de plugins de Claude Code, que requiere aprobación explícita del
usuario y no es una decisión de código — se deja como está, correctamente disclosed como
pendiente de esa aprobación.

## 6. Evidencia de ejecución

Ver `docs/reports/final-validation.md` §15 para la salida real de cada comando ejecutado en esta
corrida (typecheck, build, test, test:e2e, migración, auditoría de dependencias, generación y
validación de OpenAPI, catálogos, MkDocs, smoke contra una instancia real).

El contrato regenerado también se verificó contra el motor de verificación propio
(`yarn docs:openapi:check`): 109/109 operaciones con esquema de respuesta, deuda en 0, la regla
pasó de trinquete a fallo duro. Redocly pasó de 217 errores a 0. `contract-conformance.e2e-spec.ts`
confirmó con Ajv que las respuestas **reales** cumplen los esquemas declarados, no solo que
existen.

## 7. Fases ejecutadas, en orden

```text
Fase A — Auditoría real: gates ejecutados contra el código actual, no contra el informe previo.
Fase B — Este documento.
Fase C — R1: DTOs de respuesta para las 57 operaciones, módulo por módulo, con typecheck
          incremental tras cada grupo.
Fase D — R2/R3/R4: ADR-0024, ADR-0025, CODEOWNERS + ownership.md.
Fase E — R7: verificación de que ya estaba resuelto en CI; corrección de los informes
          desactualizados; revisión de marcadores "pendiente" restantes.
Fase F — Regeneración completa: build, contrato OpenAPI, catálogos, gates de calidad,
          reescritura de production-readiness.md y final-validation.md con la evidencia real
          y el veredicto final.
```

## 8. Qué queda fuera, y por qué

Por instrucción explícita, solo puede quedar fuera lo que exija credenciales a servicios
externos reales. Se revisó cada punto restante bajo ese criterio:

| Punto | ¿Por qué queda fuera? |
| --- | --- |
| Instalación de plugins de Claude Code | Requiere aprobación explícita del usuario, documentada como tal desde antes de esta corrida — no es una decisión de código. |
| Nombres reales en `CODEOWNERS` / `ownership.md` | Requiere crear equipos en la organización de GitHub (administración externa real), no solo escribir código. El mecanismo ya funciona hoy con el propietario real del repositorio como reserva. |
| Confirmación regulatoria del umbral de archivado por tenant | Requiere conocer el régimen real de cada mercado donde opere un tenant — información que no existe en este repositorio. El umbral por defecto y el mecanismo de ajuste por tenant ya están cerrados. |
| Acuerdo formal de SLO con un responsable de producto externo | Ese rol no existe hoy en el alcance operativo del proyecto. Los valores fueron adoptados por ingeniería con revisión trimestral obligatoria. |

Todo lo demás identificado en la auditoría se cerró en esta corrida.

## 9. Veredicto

**APTO PARA PRODUCCIÓN, con el alcance declarado en `final-validation.md` §17.** Los siete
riesgos residuales de la revisión anterior (R1–R7) están cerrados o aceptados con
justificación explícita; ninguno queda abierto sin registrar. El alcance de la declaración
—qué cubre y qué no— está en ese mismo documento y no se repite aquí para no crear dos fuentes
de verdad.
