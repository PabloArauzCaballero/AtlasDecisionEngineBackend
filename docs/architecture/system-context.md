# Contexto del sistema (C4 nivel 1)

```mermaid
C4Context
    title Contexto — Motor de decisión ATLAS

    Person(analista, "Analista de riesgo/fraude", "Diseña variables, algoritmos y pruebas")
    Person(aprobador, "Aprobador", "Autoriza versiones; nunca las propias")
    Person(operador, "Operaciones", "Despliega, revierte, atiende incidentes")
    System_Ext(canal, "Canal de originación", "Solicita decisiones en línea")

    System(atlas, "Backend de decisión ATLAS", "Diseña, gobierna, despliega y ejecuta algoritmos de decisión con evidencia reproducible")

    System_Ext(idp, "AtlasBackend (proveedor de identidad)", "Autentica al personal del portal y emite sus roles")
    System_Ext(proveedor, "Proveedor de variables", "Resuelve variables externas en tiempo de decisión")
    System_Ext(otel, "Colector OpenTelemetry", "Recibe las trazas")
    System_Ext(prom, "Prometheus", "Recolecta las métricas")

    Rel(analista, atlas, "Diseña y prueba", "HTTPS, sesión del portal")
    Rel(aprobador, atlas, "Aprueba o rechaza", "HTTPS")
    Rel(operador, atlas, "Despliega y opera", "HTTPS")
    Rel(canal, atlas, "Pide decisiones", "HTTPS, API key o JWT")
    Rel(atlas, idp, "Verifica credenciales y roles", "HTTPS")
    Rel(atlas, proveedor, "Resuelve variables ausentes", "HTTPS, con timeout")
    Rel(atlas, otel, "Exporta trazas", "OTLP/HTTP")
    Rel(prom, atlas, "Lee /metrics", "HTTPS con token")
```

## Fronteras de confianza

| Frontera | Qué la cruza | Control |
| --- | --- | --- |
| Internet → API | Peticiones de canales e integraciones | Autenticación, roles, límite de tasa, validación estricta del cuerpo |
| API → proveedor de variables | Consulta de variables externas | Timeout acotado; la resolución ocurre **fuera** de la transacción; en producción exige HTTPS |
| API → proveedor de identidad | Verificación de credenciales | Reintento solo ante fallo transitorio, **nunca** ante credencial rechazada |
| API → sidecar de scripts | Código importado a ejecutar | Socket Unix, sin red, capacidades eliminadas, gVisor, cotas de CPU, memoria y pids |
| API → base de datos | Todo el estado | Rol **no** superusuario para que RLS aplique |

## Lo que el sistema NO hace

- No origina la solicitud de crédito: la recibe ya formada.
- No entrena modelos.
- No es la fuente de verdad de la identidad del personal: delega en el proveedor.
- No almacena el dato sensible en claro en la evidencia: guarda HMAC.

## Suposiciones

1. El proveedor de identidad es alcanzable cuando el portal está en uso; las integraciones por API key no dependen de él.
2. Redis está disponible en producción; sin él el arranque se rechaza porque idempotencia y límite de tasa serían inconsistentes.
3. El reloj de los nodos está sincronizado dentro del margen configurado (`JWT_CLOCK_SKEW_SECONDS`).
