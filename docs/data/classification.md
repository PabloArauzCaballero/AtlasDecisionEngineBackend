# Clasificación de datos

## Niveles

Declarados en el contrato de cada variable (`sensitivityClass`):

| Nivel | Ejemplo | Tratamiento |
| --- | --- | --- |
| `PUBLIC` | Código de producto | Sin restricción |
| `INTERNAL` | Puntaje interno, tramo de riesgo | Solo dentro de la plataforma |
| `CONFIDENTIAL` | Límite aprobado, condiciones | Acceso por rol |
| `PII` | Nombre, documento, correo | **HMAC** en evidencia, redacción en registros |
| `SENSITIVE_PII` | Datos de salud o biométricos | Igual que PII, y evitar su ingreso |
| `SECRET` | Credenciales | Nunca en evidencia ni en registros |

## Qué hace el sistema con cada clase

### En la evidencia persistida

Un valor marcado sensible se guarda como **HMAC**, no como SHA-256 desnudo.

!!! important "Por qué HMAC y no SHA-256"
    Los valores sensibles suelen ser de baja entropía: una edad, un documento con formato
    conocido, un booleano. Un SHA-256 sin clave se revierte por fuerza bruta o con tablas
    precalculadas. El HMAC introduce un secreto que hace irreversible el hash almacenado sin él.

### En la traza

La política de traza de cada variable intermedia y de cada campo de salida decide qué sale del
motor:

| Política | Efecto |
| --- | --- |
| `FULL` | El valor viaja tal cual |
| `MASKED` | Se enmascara conservando los dos últimos caracteres — bastan para cotejar un caso en soporte sin revelar el dato |
| `REDACTED` | El valor sale como nulo y el estado se marca `REDACTED` |
| `EXCLUDED` | No aparece |

El saneamiento ocurre **antes** de que el valor salga del motor, no en la capa de presentación.

### En los registros

`StructuredLoggerService` redacta credenciales y campos de PII, y también los contenedores
donde suelen viajar (`variables`, `input`, `context`, `payload`). Tampoco se registra el
`stderr` crudo de un subproceso: puede contener el código fuente o los valores que procesaba.

### En el contrato publicado

El validador de calidad del contrato busca patrones con forma de secreto en
`openapi/openapi.json` y **falla** si encuentra alguno: ese fichero acaba en el portal, en el
repositorio y en cualquier cliente generado.

## Datos que no pasan por el contrato de variables

Los dos workers adicionales (ADR-0026) reciben datos **sin declaración de sensibilidad**: no
son variables del catálogo, sino texto y documentos que entran enteros. El tratamiento no puede
apoyarse en `sensitivityClass`, así que se fija por tabla.

| Dato | Dónde vive | Clasificación de facto | Tratamiento |
| --- | --- | --- | --- |
| Texto a clasificar | `decision_semantic_analysis_run.input_text` | Desconocida — depende de quién lo envíe; se trata como **PII** | Se minimiza a su huella `md5` a los `SEMANTIC_ANALYSIS_MINIMIZE_AFTER_DAYS` y se purga la fila a los `SEMANTIC_ANALYSIS_AUDIT_RETENTION_DAYS`. **Con `SEMANTIC_ANALYSIS_PROVIDER=openai` sale del perímetro antes de eso** |
| PDF del extracto | `decision_bank_statement_run.file_bytes` | **SENSITIVE_PII** | Se anula al cerrar la ejecución; nunca se devuelve al cliente |
| Movimientos normalizados | `…run.result_json` | **PII** | La cuenta solo aparece enmascarada; la glosa se escapa antes de entrar en un CSV |
| Nombre del archivo | `…run.file_name` | **INTERNAL** | Saneado en el borde: sin rutas ni caracteres de control |
| Categorías y alias | `decision_semantic_category`, `…_entity_alias` | **INTERNAL** | Catálogo de configuración, no datos de una persona |

!!! warning "El texto analizado es la clase más difícil de acotar"
    Nadie declara qué contiene: lo escribe quien llama. Un analista puede pegar una glosa
    bancaria, un correo o una conversación entera. Por eso se trata como PII por defecto,
    tiene un plazo de retención propio y su envío a un tercero es una decisión explícita y no
    el valor por defecto.

## Responsabilidades

| Rol | Responsabilidad |
| --- | --- |
| Autor de la variable | Declarar la clasificación correcta al crear la versión |
| Autor del artefacto | Elegir la política de traza de intermedias y salidas |
| Plataforma | Aplicar HMAC, redacción y saneamiento sin depender del autor |

La clasificación es un campo del contrato **desde el alta**, no un añadido posterior:
declararla tarde deja un intervalo en el que el dato ya se persistió sin tratamiento.
