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

## Responsabilidades

| Rol | Responsabilidad |
| --- | --- |
| Autor de la variable | Declarar la clasificación correcta al crear la versión |
| Autor del artefacto | Elegir la política de traza de intermedias y salidas |
| Plataforma | Aplicar HMAC, redacción y saneamiento sin depender del autor |

La clasificación es un campo del contrato **desde el alta**, no un añadido posterior:
declararla tarde deja un intervalo en el que el dato ya se persistió sin tratamiento.
