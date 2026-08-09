# Matriz de controles regulatorios

## Para qué sirve esta página

Un examinador no pregunta «¿tenéis auditoría?». Pregunta «enséñeme el control que impide X, y
la prueba de que sigue funcionando». Sin una tabla como ésta, cada revisión se reconstruye a
mano y el resultado depende de quién la haga.

Cada fila apunta al **fichero que implementa** el control y a la **prueba que lo sostiene**. Si
una prueba desaparece, la fila queda sin respaldo y eso se ve.

!!! warning "Esto es ingeniería, no una opinión legal"
    La tabla describe qué hace el software. Si esas capacidades bastan para cumplir en una
    jurisdicción concreta, con una licencia concreta, es una determinación legal que
    corresponde al área de cumplimiento de cada despliegue. Los artículos citados sitúan el
    control; no afirman conformidad.

## Marcos considerados

| Jurisdicción | Marco | Por qué aplica |
| --- | --- | --- |
| 🇧🇷 | **LGPD** (Lei 13.709/2018) | El motor trata datos personales y toma decisiones automatizadas |
| 🇧🇷 | **Res. BACEN 4.658/2018 → BCB 85/2021** | Política de ciberseguridad y contratación de procesamiento de datos |
| 🇧🇷 | **CMN 4.557/2017** | Gestión integrada de riesgos, incluido el riesgo de modelo |
| 🇧🇷 | **Lei 12.414/2011** (Cadastro Positivo) | Explicabilidad del score y derecho de revisión |
| 🇺🇸 | **ECOA / Regulation B** (12 CFR 1002) | Aviso de acción adversa y base prohibida |
| 🇺🇸 | **FCRA** (15 USC 1681) | Decisión basada en informe del consumidor |
| 🇺🇸 | **SR 11-7 / OCC 2011-12** | Gestión del riesgo de modelo |
| 🇺🇸 | **GLBA Safeguards Rule** (16 CFR 314) | Salvaguarda de información financiera |
| 🇺🇸 | **CCPA/CPRA** | Derechos del consumidor de California |

## Decisión y explicabilidad

| Control | Marco | Implementación | Prueba |
| --- | --- | --- | --- |
| Motivos específicos en cada denegación | ECOA §1002.9; Cadastro Positivo art. 5 VI | `DecisionReasonCode.isAdverseAction` + `priority`; se devuelven en `RuntimeService.buildBody` | `test/e2e/runtime.e2e-spec.ts` |
| Procedencia de cada dato usado | FCRA §615(a)(2) | `DecisionExecutionVariable.sourceCode` | `test/variable-resolution.spec.ts` |
| La decisión se puede reconstruir entera | LGPD art. 20 §1; SR 11-7 §V | Artefacto compilado + `canonicalChecksum` + traza por nodo + `inputSnapshotJson` | `test/execution-engine.spec.ts` |
| El motor no inventa un resultado ante un dato ausente o no numérico | SR 11-7 (integridad del modelo) | `ExpressionEvaluator.compare` / `asNumber`; `requireFiniteNumber` en el motor | `test/execution-engine-finite-numbers.spec.ts` |
| Misma entrada ⇒ misma salida | SR 11-7; Cadastro Positivo | Comparación por code point, sin `Math.random` ni `Date` en el sandbox | `test/execution-engine.spec.ts`, `test/script-node-runner.spec.ts` |

## Licitud del tratamiento

| Control | Marco | Implementación | Prueba |
| --- | --- | --- | --- |
| Una base prohibida no puede influir en la decisión | ECOA §1002.6(b)(9) | `DecisionUseRestriction.PROHIBITED_BASIS` + [`graph-decision-use.validator.ts`](https://github.com/) — rechaza al publicar, sin excepción posible | `test/regulatory-decision-use.spec.ts` |
| Un dato sensible exige base legal declarada | LGPD art. 11 | `SPECIAL_CATEGORY` admitida solo si la versión declara `legalBasis` | `test/regulatory-decision-use.spec.ts` |
| Finalidad declarada del tratamiento | LGPD art. 6 I | `DecisionArtifactVersion.processingPurpose`; el validador avisa si falta | `test/regulatory-decision-use.spec.ts` |
| Registro de la operación de tratamiento | LGPD art. 37 | `legalBasis` + `processingPurpose` por versión, con evento de auditoría al declararlas | `test/regulatory-decision-use.spec.ts` |
| Clasificación de sensibilidad de cada dato | LGPD art. 5; GLBA §314.4(c) | `SensitivityClass`; ver [clasificación](../data/classification.md) | `test/graph-input-contract.spec.ts` |

## Derechos del titular

| Control | Marco | Implementación | Prueba |
| --- | --- | --- | --- |
| Localizar todas las decisiones sobre un titular | LGPD art. 18 I-II; CCPA §1798.110 | Índice `(tenant_id, subject_reference_hash)` + [`data-subject`](../modules/data-subject.md) | `test/data-subject-rights.spec.ts` |
| El identificador del titular no se persiste en claro | LGPD art. 6 VII | HMAC en `subjectReferenceHash`, también en el evento de auditoría | `test/data-subject-rights.spec.ts` |
| Portabilidad | LGPD art. 18 V | `requestType: PORTABILITY` | `test/data-subject-rights.spec.ts` |
| La eliminación se rechaza con motivo cuando hay retención obligatoria | LGPD arts. 16 I y 18 §4 | `resolutionFor` devuelve `LEGAL_RETENTION_OBLIGATION` | `test/data-subject-rights.spec.ts` |
| Derecho a revisión humana | LGPD art. 20; Cadastro Positivo art. 5 VI | `requestType: REVIEW` → cola de [revisión manual](../modules/manual-review.md) | `test/manual-review-segregation.spec.ts` |
| Constancia de cada solicitud atendida | LGPD art. 18 §1 | `decision_data_subject_request` + evento de auditoría en la misma transacción | `test/data-subject-rights.spec.ts` |

## Riesgo de modelo y gobierno del cambio

| Control | Marco | Implementación | Prueba |
| --- | --- | --- | --- |
| Inventario versionado de modelos | SR 11-7 §IV; CMN 4.557 art. 39 | `DecisionArtifact` → `DecisionArtifactVersion` → `DecisionDeployment` | `test/e2e/artifact-lifecycle.e2e-spec.ts` |
| Validación antes de publicar | SR 11-7 §V | Diez validadores en `src/modules/graph/validators/` | `test/graph-*.spec.ts` |
| Aprobación con segregación de funciones | SR 11-7 §V; SOX ITGC | Pasos de aprobación por rol; el autor no aprueba ni despliega su versión | `test/governance-approval-guards.spec.ts`, `test/governance-sod.integration.spec.ts` |
| Solo se despliega lo aprobado | SR 11-7; CMN 4.557 | `GovernanceService.assertApproved` antes de cualquier despliegue | `test/governance-approval-guards.spec.ts` |
| Reversión a la versión anterior | CMN 4.557 art. 40 | `DeploymentService.rollback` con bloqueo por artefacto y ambiente | `test/deployment-invariants.integration.spec.ts` |

!!! danger "Hueco conocido: monitoreo continuo del modelo"
    SR 11-7 exige *ongoing monitoring* y *outcome analysis*, y CMN 4.557 lo equivalente. Hoy
    existe el conteo de resultados (`atlas_decisions_total`) pero **no** backtesting contra
    resultados reales, deriva poblacional, champion/challenger ni pruebas de impacto dispar
    —estas últimas, esperables bajo ECOA—. Está identificado y sin implementar; no lo dé por
    cubierto.

## Evidencia e integridad

| Control | Marco | Implementación | Prueba |
| --- | --- | --- | --- |
| Registro inalterable de cada acción | SOX; LGPD art. 37; BACEN 4.658 | Cadena HMAC encadenada, append-only por trigger y `REVOKE` | `test/audit-append-only.integration.spec.ts` |
| Verificación de la cadena bajo demanda | SOX | `GET /v1/audit/chain/verify`, por lotes con cursor | `test/audit-chain-verification.spec.ts` |
| La rotación de secreto no invalida la historia | — | `hashKeyId` persistido por evento | `test/audit-chain-verification.spec.ts` |
| Acción y evidencia son atómicas | LGPD art. 37 | `AuditService.append(input, tx)` dentro de la transacción del negocio | `test/audit-transactional.integration.spec.ts` |
| Retención por familia de datos | Reg B §1002.12 (25 meses); AML (5 años); SOX (7) | 7 años, razonado en [ADR-0025](../adr/ADR-0025-execution-archival-threshold.md); ver [retención](../data/retention.md) | `test/retention-sweeper.spec.ts` |

## Seguridad de la información

| Control | Marco | Implementación | Prueba |
| --- | --- | --- | --- |
| Aislamiento entre clientes | GLBA §314.4(c); LGPD art. 46 | RLS en las 31 tablas tenant-scoped, con rol de aplicación no superusuario | `test/tenant-rls-isolation.integration.spec.ts` |
| Autorización decidida en el servidor | GLBA §314.4(c) | `@Roles` + `RolesGuard` en las 124 rutas | `test/roles-guard.spec.ts`, `test/e2e/security.e2e-spec.ts` |
| Registro de accesos | BACEN 4.658; GLBA | `AccessAuditInterceptor` → `decision_access_audit` | `test/e2e/access-denial-audit.e2e-spec.ts` |
| Código importado ejecutado en aislamiento | BACEN 4.658 art. 3 | Sidecar gVisor sin red; el runner en proceso prohibido en producción | `test/script-node-runner.spec.ts` |
| PII no aparece en registros ni trazas | LGPD art. 6 VII | Redacción en `StructuredLoggerService`; ruta sin query string en el filtro de errores | `test/structured-logger.spec.ts` |
| Transferencia internacional declarada, nunca por omisión | LGPD art. 33; BACEN 4.658 arts. 11-15 | `SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER`, exigida en producción, con guarda además en la fábrica de proveedores | `test/regulatory-international-transfer.spec.ts` |
| Notificación de incidentes con plazos | LGPD art. 48; FTC Safeguards; NYDFS | [respuesta a incidentes](incident-response.md#regulatoria) | — (procedimiento) |

## Lo que esta matriz no cubre

Se excluyen a conciencia, y cada despliegue debe confirmar si le aplican:

- **PCI DSS** — el motor no procesa datos de tarjeta.
- **SOX §404** — solo si la entidad cotiza en EE. UU.; los controles ITGC de arriba son la parte
  que aporta el software.
- **NYDFS Part 500** y **Open Finance Brasil** — dependen de la licencia.
- **Cifrado en reposo, MFA y residencia de datos** — son del gestor de infraestructura y del
  proveedor de identidad, no de este repositorio. Ver [despliegue](../DEPLOYMENT.md).
- **Contratos con proveedores y cláusulas de transferencia** — documental.
