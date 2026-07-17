# ATLAS Decision Engine — Catálogo de vistas por fases

**Versión:** 2.0.0  
**Alcance:** portal interno del Motor de Decisión ATLAS  
**Objetivo:** definir qué pantallas debe implementar el frontend, en qué orden y si cada vista es principalmente una **tabla**, **formulario**, **detalle**, **dashboard**, **wizard**, **editor gráfico** o **modal**.

> Este documento no describe la app del consumidor ni el portal general del comercio. Se concentra en el backend interno de decisiones, riesgo, pruebas, gobierno, despliegue, auditoría y revisión manual.

## 1. Convenciones

| Tipo de vista | Uso recomendado |
|---|---|
| **Tabla** | Buscar, filtrar, ordenar, paginar y ejecutar acciones sobre varios registros. |
| **Formulario** | Crear o editar una entidad con validaciones, ayuda contextual y confirmación. |
| **Detalle** | Consultar una entidad, su estado, historial, relaciones y acciones permitidas. |
| **Dashboard** | Monitorear indicadores, alertas, tendencias y estado operativo. |
| **Wizard** | Completar un proceso de varios pasos con validación progresiva. |
| **Editor gráfico** | Diseñar el grafo de decisión con nodos, aristas, reglas y validación visual. |
| **Modal** | Confirmar una acción puntual de alto impacto o capturar pocos campos. |

### Estados visuales obligatorios

Todas las vistas deben contemplar: `loading`, `empty`, `error`, `forbidden`, `stale-data`, `partial-data` y `success`. Las tablas deben usar paginación del servidor, conservar filtros en la URL y permitir exportación solo cuando el rol lo autorice.

## 2. Orden de implementación

| Fase | Entrega | Propósito | Dependencia |
|---:|---|---|---|
| 0 | Acceso y salud | Entrar de forma segura y conocer el estado del servicio. | IAM/JWT, API desplegada. |
| 1 | Catálogos base | Configurar variables y códigos de razón reutilizables. | Fase 0. |
| 2 | Artefactos y versiones | Crear, versionar y diseñar decisiones. | Fase 1. |
| 3 | Pruebas y validación | Demostrar que cada versión funciona antes de aprobarla. | Fase 2. |
| 4 | Gobierno y despliegue | Revisar, aprobar, desplegar, suspender y revertir. | Fase 3. |
| 5 | Operación y revisión manual | Operar decisiones reales y resolver excepciones. | Fase 4. |
| 6 | Auditoría y observabilidad | Investigar, controlar y monitorear producción. | Fase 5. |
| 7 | Trazabilidad y analítica avanzada | Vincular objetivos, políticas, pruebas y desempeño. | Fases 1–6. |
| 8 | Escala futura | Champion/challenger, modelos, fraude y gobernanza avanzada. | Datos históricos suficientes. |

---

# Fase 0 — Acceso, contexto y salud

## Resumen de vistas

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Rol | Endpoint principal | Prioridad |
|---|---|---|---|---|---|---|
| F0-01 | Inicio de sesión corporativo | **Formulario** | Formulario | Todos | IAM externo | P0 |
| F0-02 | Selección de tenant y contexto | **Formulario** | Selector/Formulario | Multi-tenant | Claim JWT | P0 |
| F0-03 | Estado de plataforma | **Dashboard** | Dashboard | OPERATIONS, AUDITOR | `GET /health/live`, `GET /health/ready` | P0 |
| F0-04 | Perfil y permisos efectivos | **Detalle** | Detalle | Todos | Claims JWT | P1 |

### F0-01 — Inicio de sesión corporativo

**Campos:** usuario/correo, contraseña o SSO, segundo factor, dispositivo recordado.  
**Acciones:** ingresar, recuperar acceso, cerrar otras sesiones.  
**Reglas:** el frontend no almacena tokens en `localStorage`; usa sesión segura administrada por el BFF/IAM. El motor valida JWT RS256 mediante JWKS.  
**Criterio de aceptación:** un usuario sin rol válido no puede abrir rutas protegidas ni ver acciones ocultas.

### F0-03 — Estado de plataforma

**Componentes:** estado API, PostgreSQL, Redis, versión de build, commit, uptime y tiempo de respuesta.  
**Alertas:** dependencia degradada, readiness fallida, versión distinta a la aprobada.  
**Actualización:** cada 30–60 segundos, sin usar la API de negocio para el sondeo.

---

# Fase 1 — Catálogos base

## 1.1 Variables

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Acciones clave |
|---|---|---|---|---|---|---|
| F1-01 | Catálogo de variables | **Tabla** | Tabla | RISK_ANALYST, FRAUD_ANALYST, QA_ANALYST | `GET /v1/variables` | Buscar, filtrar, paginar, abrir detalle. |
| F1-02 | Alta de variable | **Formulario** | Formulario | RISK_ANALYST, FRAUD_ANALYST | `POST /v1/variables` | Crear definición y primera versión. |
| F1-03 | Detalle de variable | **Detalle** | Detalle | RISK_ANALYST, QA_ANALYST, AUDITOR | `GET /v1/variables/:definitionId` | Ver versiones, origen, validaciones, uso. |
| F1-04 | Nueva versión de variable | **Formulario** | Formulario | RISK_ANALYST, FRAUD_ANALYST | `POST /v1/variables/:definitionId/versions` | Versionar sin sobrescribir historia. |
| F1-05 | Simulador de resolución | **Formulario** | Formulario/Resultado | QA_ANALYST | Gap controlado | Probar valor, transformación y error. |

**Columnas F1-01:** código, nombre, categoría, tipo de dato, fuente, versión vigente, sensibilidad, estado, fecha de actualización, propietario.  
**Filtros:** texto, categoría, estado, fuente, sensibilidad.  
**Campos F1-02/F1-04:** código, nombre, descripción, tipo, fuente, ruta, expresión/transformación, valor por defecto, requerido, validaciones, sensibilidad, vigencia y justificación.

## 1.2 Códigos de razón

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Acciones clave |
|---|---|---|---|---|---|---|
| F1-06 | Catálogo de reason codes | **Tabla** | Tabla | RISK_ANALYST, COMPLIANCE, AUDITOR | `GET /v1/reason-codes` | Buscar, filtrar, abrir detalle. |
| F1-07 | Alta de reason code | **Formulario** | Formulario | RISK_ANALYST, COMPLIANCE | `POST /v1/reason-codes` | Crear razón explicable. |
| F1-08 | Detalle de reason code | **Detalle** | Detalle | COMPLIANCE, AUDITOR | Gap menor | Ver usos y textos por canal/idioma. |

**Columnas F1-06:** código, categoría, severidad, título, mensaje al cliente, mensaje interno, acción sugerida, activo.  
**Regla crítica:** nunca mostrar al cliente información que facilite fraude o revele variables internas sensibles.

---

# Fase 2 — Artefactos, versiones y grafo de decisión

## 2.1 Artefactos

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Prioridad |
|---|---|---|---|---|---|---|
| F2-01 | Inventario de artefactos | **Tabla** | Tabla | RISK_ANALYST, FRAUD_ANALYST, QA_ANALYST, AUDITOR | `GET /v1/artifacts` | P0 |
| F2-02 | Crear artefacto | **Formulario** | Formulario | RISK_ANALYST, FRAUD_ANALYST | `POST /v1/artifacts` | P0 |
| F2-03 | Detalle del artefacto | **Detalle** | Detalle | Roles de consulta | `GET /v1/artifacts/:artifactId` | P0 |
| F2-04 | Historial de versiones | **Tabla** | Tabla dentro de detalle | Roles de consulta | Incluido en detalle | P0 |
| F2-05 | Comparador de versiones | **Detalle** | Diff visual | RISK_ANALYST, QA_ANALYST, AUDITOR | `GET /v1/artifact-versions/:left/diff/:right` | P1 |

**Columnas F2-01:** código, nombre, tipo, equipo propietario, versión vigente, estado, ambiente desplegado, última validación, última modificación.  
**Filtros:** estado, tipo, propietario, texto.  
**Campos F2-02:** código, nombre, descripción, tipo, propietario, finalidad, tags, nivel de criticidad, objetivo de SLA.

## 2.2 Versiones y editor gráfico

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Acciones clave |
|---|---|---|---|---|---|---|
| F2-06 | Detalle de versión | **Detalle** | Detalle | RISK_ANALYST, QA_ANALYST, COMPLIANCE | `GET /v1/artifact-versions/:versionId` | Ver estado, checksum, evidencias y acciones. |
| F2-07 | Clonar versión | **Formulario** | Modal/Formulario | RISK_ANALYST, FRAUD_ANALYST | `POST /v1/artifact-versions/:versionId/clone` | Crear borrador derivado. |
| F2-08 | Editor de grafo | **Editor gráfico** | Editor + paneles | RISK_ANALYST, FRAUD_ANALYST | `GET /v1/artifact-versions/:versionId/graph` + API de edición | Diseñar nodos/aristas. |
| F2-09 | Propiedades de nodo | **Formulario** | Panel/Formulario | RISK_ANALYST, FRAUD_ANALYST | API de edición | Configurar regla/acción/razones. |
| F2-10 | Propiedades de arista | **Formulario** | Panel/Formulario | RISK_ANALYST, FRAUD_ANALYST | API de edición | Prioridad, condición y destino. |
| F2-11 | Validación del grafo | **Detalle** | Panel de resultados | RISK_ANALYST, QA_ANALYST | `POST /v1/artifact-versions/:versionId/validate` | Navegar a error y corregir. |
| F2-12 | Compilación | **Modal** | Modal + resultado | RISK_ANALYST, QA_ANALYST | `POST /v1/artifact-versions/:versionId/compile` | Generar artefacto inmutable. |
| F2-13 | Validar y compilar | **Wizard** | Wizard | RISK_ANALYST, QA_ANALYST | `POST /v1/artifact-versions/:versionId/validate-and-compile` | Ejecutar flujo completo. |

### Diseño mínimo del editor F2-08

- **Lienzo central:** nodos de inicio, condición, score, política, acción, revisión manual y fin.
- **Panel izquierdo:** biblioteca de nodos y variables autorizadas.
- **Panel derecho:** formulario de propiedades con validación inmediata.
- **Barra superior:** guardar, deshacer/rehacer, validar, compilar, comparar, zoom y versión.
- **Panel inferior:** errores, advertencias, nodos no alcanzables, rutas sin terminal y cobertura de pruebas.
- **Bloqueo optimista:** advertir si otra persona modificó la versión; no sobrescribir silenciosamente.

### Contrato disponible para el editor

La lectura, clonación, validación y compilación están implementadas. El editor puede guardar el grafo completo mediante `PUT /v1/artifact-versions/:versionId/graph` y debe enviar `If-Match` con la versión de bloqueo actual para evitar sobrescrituras concurrentes.

---

# Fase 3 — Pruebas, regresión y calidad

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Prioridad |
|---|---|---|---|---|---|---|
| F3-01 | Suites de prueba por versión | **Tabla** | Tabla | QA_ANALYST, RISK_ANALYST, AUDITOR | `GET /v1/artifact-versions/:versionId/test-suites` | P0 |
| F3-02 | Crear suite | **Formulario** | Formulario/Wizard | QA_ANALYST, RISK_ANALYST | `POST /v1/artifact-versions/:versionId/test-suites` | P0 |
| F3-03 | Casos de prueba | **Tabla** | Tabla editable | QA_ANALYST | Incluidos en suite | P0 |
| F3-04 | Crear/editar caso | **Formulario** | Formulario | QA_ANALYST | Extensión recomendada | P0 |
| F3-05 | Ejecutar suite | **Formulario** | Modal/Formulario | QA_ANALYST | `POST /v1/test-suites/:suiteId/runs` | P0 |
| F3-06 | Resultado de ejecución | **Detalle** | Detalle | QA_ANALYST, RISK_ANALYST, AUDITOR | `GET /v1/test-runs/:runId` | P0 |
| F3-07 | Cobertura de grafo | **Dashboard** | Dashboard | QA_ANALYST, RISK_ANALYST | Incluido en run | P0 |
| F3-08 | Comparación de regresión | **Detalle** | Diff | QA_ANALYST, RISK_ANALYST | Baseline en ejecución | P1 |
| F3-09 | Importar casos CSV/JSON | **Formulario** | Wizard | QA_ANALYST | Gap | P2 |

**Columnas F3-01:** código, nombre, tipo, bloqueante, casos activos, último resultado, fecha, cobertura de nodos, cobertura de aristas.  
**Columnas F3-03:** caso, nombre, tags, entrada, resultado esperado, estado, última ejecución.  
**Resultado F3-06:** assertions aprobadas/fallidas, resultado real, error, duración, ruta recorrida, nodos/aristas, reason codes y artefacto compilado.

**Definition of Done de una versión:** 100% de suites bloqueantes aprobadas, cobertura mínima configurable, cero errores de validación, checksum generado y evidencia auditable.

---

# Fase 4 — Gobierno, aprobación y despliegue

## 4.1 Aprobaciones

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Prioridad |
|---|---|---|---|---|---|---|
| F4-01 | Bandeja de revisiones | **Tabla** | Tabla | RISK_MANAGER, COMPLIANCE, APPROVER | Filtro sobre solicitudes | P0 |
| F4-02 | Enviar a revisión | **Formulario** | Modal/Formulario | RISK_ANALYST, FRAUD_ANALYST | `POST /v1/artifact-versions/:versionId/submit-for-review` | P0 |
| F4-03 | Detalle de solicitud | **Detalle** | Detalle | APPROVER, COMPLIANCE, AUDITOR | `GET /v1/approval-requests/:requestId` | P0 |
| F4-04 | Decisión de aprobación | **Formulario** | Formulario/Modal | APPROVER, COMPLIANCE | `POST /v1/approval-steps/:stepId/decisions` | P0 |
| F4-05 | Evidencia y segregación | **Detalle** | Timeline | AUDITOR, COMPLIANCE | Incluido en detalle | P1 |

**Columnas F4-01:** artefacto, versión, tipo de cambio, solicitante, paso actual, responsable, SLA, fecha, estado.  
**Campos F4-04:** decisión, comentario obligatorio, evidencia, excepción autorizada, vigencia.  
**Regla:** el autor no puede autoaprobar cuando la política exige segregación de funciones.

## 4.2 Despliegues

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Prioridad |
|---|---|---|---|---|---|---|
| F4-06 | Ambientes | **Tabla** | Tabla | RELEASE_MANAGER, OPERATIONS, AUDITOR | `GET /v1/environments` | P0 |
| F4-07 | Historial de despliegues | **Tabla** | Tabla | RELEASE_MANAGER, OPERATIONS, AUDITOR | `GET /v1/deployments` | P0 |
| F4-08 | Crear despliegue | **Formulario** | Wizard | RELEASE_MANAGER | `POST /v1/artifact-versions/:versionId/deployments` | P0 |
| F4-09 | Detalle del despliegue | **Detalle** | Detalle/Timeline | RELEASE_MANAGER, OPERATIONS, AUDITOR | Gap menor | P1 |
| F4-10 | Suspender despliegue | **Formulario** | Modal | RELEASE_MANAGER, OPERATIONS | `POST /v1/deployments/:deploymentId/suspend` | P0 |
| F4-11 | Rollback | **Formulario** | Modal crítico | RELEASE_MANAGER | `POST /v1/deployments/:deploymentId/rollback` | P0 |

**Columnas F4-07:** artefacto, versión, checksum, ambiente, estado, desplegado por, fecha, tráfico, versión anterior.  
**Wizard F4-08:** elegir ambiente → verificar aprobación → verificar pruebas → mostrar diff/checksum → confirmar ventana → desplegar.  
**Rollback F4-11:** exige motivo, ticket de incidente, versión destino y doble confirmación.

---

# Fase 5 — Operación, ejecución y revisión manual

## 5.1 Consola de ejecución controlada

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Prioridad |
|---|---|---|---|---|---|---|
| F5-01 | Simulador de decisión | **Formulario** | Formulario + resultado | RISK_ANALYST, QA_ANALYST | `POST /v1/decisions/:artifactCode` | P1 |
| F5-02 | Resultado de simulación | **Detalle** | Detalle | RISK_ANALYST, QA_ANALYST | Respuesta del runtime | P1 |

**Campos F5-01:** artefacto, ambiente autorizado, request ID, idempotency key, variables de entrada, contexto y modo sin persistencia cuando exista.  
**Advertencia:** el simulador debe estar claramente separado de producción y no debe permitir datos personales reales en ambientes no productivos.

## 5.2 Revisión manual

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Prioridad |
|---|---|---|---|---|---|---|
| F5-03 | Cola de revisión manual | **Tabla** | Tabla | OPERATIONS, FRAUD_ANALYST | `GET /v1/manual-reviews` | P0 |
| F5-04 | Detalle del caso | **Detalle** | Detalle | OPERATIONS, FRAUD_ANALYST, AUDITOR | `GET /v1/manual-reviews/:caseId` | P0 |
| F5-05 | Asignar caso | **Formulario** | Modal/Formulario | OPERATIONS | `POST /v1/manual-reviews/:caseId/assign` | P0 |
| F5-06 | Resolver caso | **Formulario** | Formulario | OPERATIONS, FRAUD_ANALYST | `POST /v1/manual-reviews/:caseId/resolve` | P0 |
| F5-07 | Evidencias del caso | **Tabla** | Tabla/Timeline | OPERATIONS, AUDITOR | Incluido en detalle | P1 |

**Columnas F5-03:** caso, cola, prioridad, motivo, artefacto, cliente referencial enmascarado, asignado a, antigüedad, SLA, estado.  
**Detalle F5-04:** entrada enmascarada, resultado preliminar, reason codes, ruta del grafo, eventos, evidencias y decisiones previas.  
**Resolución F5-06:** resultado, reason code, comentario, evidencia, vigencia y confirmación. No se puede editar la decisión después de cerrar; una corrección crea un nuevo evento.

---

# Fase 6 — Auditoría, investigaciones y observabilidad

## 6.1 Ejecuciones y trazas

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Prioridad |
|---|---|---|---|---|---|---|
| F6-01 | Buscador de ejecuciones | **Tabla** | Tabla | AUDITOR, COMPLIANCE, RISK_ANALYST, OPERATIONS | `GET /v1/audit/executions` | P0 |
| F6-02 | Detalle de ejecución | **Detalle** | Detalle/Timeline | Mismos roles | `GET /v1/audit/executions/:executionId` | P0 |
| F6-03 | Visualización de ruta | **Detalle** | Grafo resaltado | AUDITOR, RISK_ANALYST | Incluido en detalle | P1 |
| F6-04 | Exportación de evidencia | **Formulario** | Modal | AUDITOR, COMPLIANCE | Gap controlado | P2 |

**Filtros F6-01:** artefacto, outcome, request ID, rango de fechas, ambiente, estado.  
**Columnas:** fecha, request ID, artefacto/versión, ambiente, outcome, estado, duración, reason codes, revisión manual.  
**Detalle:** input snapshot enmascarado, variables resueltas y origen, pasos, nodos, razones, errores, checksum, deployment y tiempos.

## 6.2 Eventos de auditoría

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Prioridad |
|---|---|---|---|---|---|---|
| F6-05 | Bitácora de auditoría | **Tabla** | Tabla | AUDITOR, COMPLIANCE | `GET /v1/audit/events` | P0 |
| F6-06 | Detalle de evento | **Detalle** | Detalle | AUDITOR, COMPLIANCE | Datos de tabla | P1 |
| F6-07 | Verificación de cadena | **Dashboard** | Dashboard/Resultado | AUDITOR | `GET /v1/audit/chain/verify` | P0 |

**Columnas F6-05:** fecha, evento, agregado, ID, actor, request ID, hash anterior, hash actual.  
**Alerta crítica:** cualquier ruptura de cadena se trata como incidente de integridad y no como simple error visual.

## 6.3 Observabilidad

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Prioridad |
|---|---|---|---|---|---|---|
| F6-08 | Dashboard operativo | **Dashboard** | Dashboard | OPERATIONS, SRE | `GET /metrics` + observabilidad externa | P0 |
| F6-09 | Métricas de negocio | **Dashboard** | Dashboard | RISK_MANAGER, OPERATIONS | `GET /v1/audit/metrics` | P1 |
| F6-10 | Alertas e incidentes | **Tabla** | Tabla | OPERATIONS, SRE | Plataforma externa | P1 |

**Indicadores mínimos:** tasa de decisiones, error rate, NO_DECISION, p50/p95/p99, rate limit, timeout, PostgreSQL/Redis, revisión manual, outcomes, versión/ambiente y checksum.  
**Regla:** `/metrics` se protege con token técnico y no se consume directamente desde el navegador del usuario.

---

# Fase 7 — Trazabilidad de negocio y control

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Roles | Endpoint | Prioridad |
|---|---|---|---|---|---|---|
| F7-01 | Objetivos de negocio | **Tabla** | Tabla | RISK_ANALYST, COMPLIANCE, AUDITOR | `GET /v1/traceability/objectives` | P1 |
| F7-02 | Crear objetivo y políticas | **Formulario** | Wizard | RISK_ANALYST, COMPLIANCE | `POST /v1/traceability/objectives` | P1 |
| F7-03 | Detalle del objetivo | **Detalle** | Detalle | RISK_ANALYST, COMPLIANCE, AUDITOR | Contenido de listado | P1 |
| F7-04 | Matriz política–artefacto | **Tabla** | Matriz | COMPLIANCE, AUDITOR | Enlaces existentes | P1 |
| F7-05 | Vincular política a versión | **Formulario** | Modal | RISK_ANALYST, COMPLIANCE | `POST /v1/traceability/policies/:policyId/artifacts` | P1 |
| F7-06 | Vincular política a prueba | **Formulario** | Modal | QA_ANALYST, COMPLIANCE | `POST /v1/traceability/policies/:policyId/test-suites` | P1 |
| F7-07 | Matriz de cobertura | **Dashboard** | Dashboard | COMPLIANCE, AUDITOR | Datos agregados | P2 |

**Columnas F7-01:** código, objetivo, métrica, meta, propietario, políticas, cobertura de artefactos, cobertura de pruebas, estado.  
**Resultado esperado:** desde una política se puede navegar a la versión que la implementa, la prueba que la verifica, la aprobación y el despliegue activo.

---

# Fase 8 — Escala futura

Estas vistas no deben bloquear el MVP, pero el diseño visual y de navegación debe reservar su lugar.

| ID | Vista | ¿Formulario o tabla? | Tipo principal | Momento de implementación |
|---|---|---|---|---|
| F8-01 | Registro de modelos estadísticos | **Tabla** | Tabla | Cuando existan modelos propios entrenados. |
| F8-02 | Alta de modelo y versión | **Formulario** | Wizard | Después de MLOps y validación independiente. |
| F8-03 | Champion/challenger | **Dashboard** | Dashboard | Con volumen suficiente y experimentación controlada. |
| F8-04 | Estrategias de tráfico | **Formulario** | Formulario | Con canary/shadow deployments. |
| F8-05 | Reglas de fraude | **Tabla** | Tabla | Fase de fraude avanzada. |
| F8-06 | Editor de regla de fraude | **Formulario** | Editor/Formulario | Fase de fraude avanzada. |
| F8-07 | Monitoreo de drift | **Dashboard** | Dashboard | Con muestras históricas y etiquetas de desempeño. |
| F8-08 | Cohortes/vintages | **Dashboard** | Dashboard | Tras madurar cartera. |
| F8-09 | Roll-rate y mora | **Dashboard** | Dashboard | Con cobranza y calendario real. |
| F8-10 | Retención y legal hold | **Tabla** | Tabla/Formulario | Antes de políticas regulatorias productivas. |
| F8-11 | Integraciones externas | **Tabla** | Tabla | KYC, buró, bancos, notificaciones. |
| F8-12 | Configuración de integración | **Formulario** | Formulario seguro | Solo secretos referenciados, nunca visibles. |

---

# 9. Navegación recomendada

```text
Inicio
├── Diseño
│   ├── Artefactos
│   ├── Variables
│   └── Reason codes
├── Calidad
│   ├── Suites de prueba
│   ├── Ejecuciones de prueba
│   └── Cobertura
├── Gobierno
│   ├── Revisiones
│   ├── Aprobaciones
│   ├── Ambientes
│   └── Despliegues
├── Operaciones
│   ├── Revisión manual
│   ├── Simulador
│   └── Salud
├── Auditoría
│   ├── Ejecuciones
│   ├── Eventos
│   └── Integridad de cadena
└── Trazabilidad
    ├── Objetivos
    ├── Políticas
    └── Matriz de cobertura
```

# 10. Matriz resumida de permisos

| Módulo | RISK_ANALYST | FRAUD_ANALYST | QA_ANALYST | COMPLIANCE | APPROVER | RELEASE_MANAGER | OPERATIONS | AUDITOR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Variables | C/E/V | C/E/V | V | V | — | — | — | V |
| Artefactos | C/E/V | C/E/V | V | V | V | V | — | V |
| Pruebas | E/V | E/V | C/E/V | V | V | V | — | V |
| Aprobaciones | Solicita | Solicita | V | Decide/V | Decide/V | V | — | V |
| Despliegues | V | V | V | V | V | C/E/V | E/V | V |
| Revisión manual | V | E/V | — | V | — | — | C/E/V | V |
| Auditoría | V | V | V | V | V | V | V | V |

**Leyenda:** C = crear, E = editar/ejecutar, V = visualizar. La autorización real siempre se aplica en backend; ocultar un botón no es un control de seguridad.

# 11. Reglas UX obligatorias para producción

1. **No perder trabajo:** autoguardado de borrador local temporal y confirmación antes de abandonar formularios modificados.
2. **Acciones críticas explícitas:** aprobar, desplegar, suspender, resolver revisión y rollback requieren motivo y confirmación.
3. **Sin “pantallas congeladas”:** skeletons, progreso, timeout visible y opción de reintento idempotente.
4. **Errores accionables:** mostrar `requestId`, código del error y una explicación segura; nunca stack traces.
5. **Datos sensibles:** enmascarar identidad, teléfonos, correos, documentos y variables clasificadas.
6. **Accesibilidad:** navegación por teclado, foco visible, contraste AA, etiquetas y mensajes asociados a campos.
7. **Auditoría:** toda acción de escritura muestra quién, cuándo, estado anterior/nuevo y request ID.
8. **Paginación servidor:** no descargar listas completas al navegador.
9. **Fechas:** almacenar UTC y mostrar zona horaria del usuario con etiqueta clara.
10. **Concurrencia:** usar checksum/ETag para impedir sobreescrituras silenciosas.

# 12. Definition of Done del frontend por vista

Una vista se considera terminada únicamente cuando:

- consume el endpoint real y documentado;
- maneja todos los estados visuales;
- aplica permisos y el backend también los valida;
- posee validación de campos equivalente al contrato API;
- incluye pruebas unitarias y de integración;
- registra telemetría sin datos personales;
- soporta paginación/filtros en URL cuando corresponde;
- supera accesibilidad básica y responsive para escritorio/tablet;
- incluye criterio de error, reintento e idempotencia;
- tiene evidencia de aceptación por Riesgo/QA/Operaciones según el módulo.

# 13. Brechas de API antes de completar todas las vistas

| Brecha | Impacto | Prioridad recomendada |
|---|---|---|
| Endpoints de actualización/desactivación de variables y reason codes | Limita mantenimiento operativo. | P1 |
| Listado global de solicitudes de aprobación | Obliga a consultas indirectas para la bandeja. | P0 |
| Detalle directo de deployment y ambiente | Reduce trazabilidad visual. | P1 |
| CRUD de casos de prueba individuales e importación | Hace pesada la gestión de suites grandes. | P1 |
| Exportación auditable de evidencia | Necesaria para auditorías formales. | P2 |
| Endpoint de simulación sin persistencia y aislado de producción | Mejora QA y evita contaminar métricas. | P1 |
