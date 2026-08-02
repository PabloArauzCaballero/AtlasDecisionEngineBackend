# Modelo de amenazas (STRIDE)

Alcance: el backend de decisión, sus contenedores y sus integraciones. Cada amenaza indica la
mitigación **implementada** y el riesgo residual real.

## Fronteras de confianza

| # | Frontera | Qué la cruza |
| --- | --- | --- |
| F1 | Internet → API | Peticiones de canales, integraciones y portal |
| F2 | API → PostgreSQL | Todo el estado |
| F3 | API → sidecar de scripts | Código importado por un analista |
| F4 | API → proveedores externos | Variables e identidad |
| F5 | Operador → contenedores | Configuración y secretos |

---

## S · Suplantación

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| S1 | Un llamante declara ser otro con una cabecera | `x-principal-id`/`x-roles` no existen; la identidad sale del registro o del token | **Bajo** |
| S2 | Reutilización de una API key filtrada | Hash en reposo, audiencia acotada, tenants explícitos, rotación que invalida la anterior | **Medio** — una clave filtrada sirve hasta que se rota. Requiere vigilar `decision_access_audit` |
| S3 | Token falsificado | Verificación contra JWKS: emisor, audiencia, expiración, desfase | **Bajo** |
| S4 | Suplantación del proveedor de identidad | HTTPS obligatorio en producción | **Bajo**, sujeto a la PKI de la organización |

## T · Manipulación

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| T1 | Alterar una decisión ya emitida | Auditoría append-only con disparadores y permisos revocados | **Muy bajo** |
| T2 | Modificar un artefacto aprobado | Solo el borrador es editable; el compilado lleva checksum | **Bajo** |
| T3 | Inyección por entrada | Validación estricta; Prisma parametriza; `safe-regex` contra ReDoS | **Bajo** |
| T4 | Escape del sandbox para alterar el proceso | Prototipo nulo, dunder y `str.format` bloqueados, sin red, gVisor, cotas | **Medio** — un sandbox es una carrera permanente; el contenedor sin red acota el daño |
| T5 | Manipular el esquema desde la aplicación | El rol de aplicación no puede alterar el esquema | **Bajo** |

## R · Repudio

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| R1 | «Yo no aprobé esa versión» | Evento de auditoría en la misma transacción que el voto, encadenado por hash | **Muy bajo** |
| R2 | «Esa decisión no se tomó así» | Snapshot de entradas, traza y artefacto compilado inmutable | **Muy bajo** |
| R3 | Pérdida del secreto de firma | Rotación con clave identificada por evento y secretos retirados para verificar | **Medio** — perder el secreto **y** su respaldo deja la cadena inverificable |

## I · Divulgación de información

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| I1 | Un tenant lee datos de otro | RLS + rol no superusuario + tenants permitidos; recurso ajeno responde `404` | **Bajo** |
| I2 | PII en registros | Redacción de credenciales y PII; sin `stderr` crudo de subprocesos | **Bajo** |
| I3 | PII en la evidencia | HMAC, no hash desnudo | **Bajo** |
| I4 | Detalle interno en un error | En producción el `500` no lleva mensaje interno; `/health/ready` no revela el fallo del driver | **Bajo** |
| I5 | Superficie de API expuesta | Swagger prohibido en producción | **Bajo** |
| I6 | Secretos en el contrato publicado | El validador falla si detecta un patrón con forma de secreto | **Bajo** |

## D · Denegación de servicio

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| D1 | Inundación de peticiones | Límite por ventana con estado compartido | **Medio** — sin WAF por delante, el límite es de aplicación |
| D2 | Script que consume CPU o memoria | Timeout, cotas de memoria, pids y CPU; admisión con 503 | **Bajo** |
| D3 | Consulta que agota la memoria | Paginación acotada; auditoría recorrida por lotes; sin filtrado genérico | **Bajo** |
| D4 | Cadena de artefactos desbocada | Presupuesto: artefactos, tiempo total, por salto, tamaño y memoria retenida | **Bajo** |
| D5 | Crecimiento sin cota de idempotencia | Purga por lotes con margen | **Bajo** |
| D6 | Cuerpo de petición enorme | `BODY_LIMIT_BYTES` | **Bajo** |

## E · Elevación de privilegios

| ID | Amenaza | Mitigación | Riesgo residual |
| --- | --- | --- | --- |
| E1 | Una API key se atribuye `PLATFORM_ADMIN` | El comodín solo se honra en identidad firmada; cubierto por prueba | **Muy bajo** |
| E2 | Autor aprueba su propia versión | Segregación de funciones en el servidor, 20 pruebas | **Muy bajo** |
| E3 | Escape del contenedor | Sin privilegios, capacidades eliminadas, raíz de solo lectura, gVisor | **Medio** — depende de que gVisor esté realmente instalado en el anfitrión |
| E4 | Escalada por dependencia vulnerable | `yarn audit` en CI, CodeQL, Trivy, revisión de dependencias | **Medio** — vulnerabilidades de día cero |

---

## Riesgos residuales aceptados

| Riesgo | Por qué se acepta | Qué lo compensa |
| --- | --- | --- |
| Una API key filtrada sirve hasta rotarse | Es la naturaleza de un secreto compartido | Auditoría de accesos, alcance acotado, rotación documentada |
| El sandbox es una carrera permanente | Ninguna defensa de sandbox es definitiva | Contenedor sin red y con cotas: el daño queda contenido aunque el escape ocurra |
| Sin WAF, D1 depende del límite de aplicación | Corresponde a la infraestructura de la organización | Límite por ventana y `AUTH_FAILURE_RATE_LIMIT` |
| gVisor debe existir en el anfitrión | La plataforma no controla el clúster | Documentado como requisito de producción |

## Revisión

Este modelo se revisa al añadir un endpoint que exponga datos nuevos, una integración saliente,
una tabla con datos personales o un mecanismo de ejecución de código.
