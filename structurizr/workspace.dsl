/*
 * Arquitectura oficial en texto versionable.
 *
 * Está aquí y no como imágenes exportadas por una razón práctica: un diagrama que solo existe
 * como PNG no se puede revisar en un pull request ni se sabe si sigue siendo cierto. Esto sí.
 *
 * Los diagramas del portal usan Mermaid embebido en Markdown para lo que se lee en línea;
 * este workspace es la definición estructural completa.
 */
workspace "ATLAS Decision Platform" "Motor de decisión gobernado para crédito, riesgo y fraude" {

    model {
        analista = person "Analista de riesgo/fraude" "Diseña variables, algoritmos y pruebas"
        aprobador = person "Aprobador" "Autoriza versiones; nunca las propias"
        operador = person "Operaciones" "Despliega, revierte y atiende incidentes"

        canal = softwareSystem "Canal de originación" "Solicita decisiones en línea" "External"
        idp = softwareSystem "AtlasBackend (proveedor de identidad)" "Autentica al personal del portal y emite sus roles" "External"
        proveedorVariables = softwareSystem "Proveedor de variables" "Resuelve variables externas en tiempo de decisión" "External"
        observabilidad = softwareSystem "Stack de observabilidad" "Prometheus y colector OpenTelemetry" "External"

        atlas = softwareSystem "Backend de decisión ATLAS" "Diseña, gobierna, despliega y ejecuta algoritmos de decisión con evidencia reproducible" {

            api = container "API" "NestJS sobre Node 22. WORKER_ROLE=API: solo atiende tráfico" "TypeScript" {
                frontera = component "Frontera HTTP" "Validación, CORS, correlación, apagado ordenado" "main.ts"
                seguridad = component "Guardas de seguridad" "Autenticación, roles y límite de tasa" "common/security"
                motor = component "Motor de ejecución" "Recorre el artefacto compilado y produce la traza" "graph/execution-engine.service.ts"
                contratos = component "Contratos de variables" "Resolución y evaluación autoritativa de restricciones" "variables + common/contracts"
                gobierno = component "Gobierno" "Aprobaciones con segregación de funciones" "modules/governance"
                runtime = component "Runtime de decisión" "Idempotencia y escritura de evidencia" "modules/runtime"
                auditoria = component "Auditoría" "Cadena append-only encadenada por hash" "common/audit"
                outbox = component "Publicador de outbox" "Escribe el evento en la transacción del negocio" "common/events"
            }

            worker = container "Worker" "Misma imagen, WORKER_ROLE=WORKER. Sin adaptador HTTP: no puede atender decisiones" "TypeScript" {
                relay = component "Relay del outbox" "Reclamo con lease, retroceso y cola muerta" "modules/outbox-relay"
                testWorker = component "Worker de corridas" "Ejecuta suites de regresión" "modules/testing"
                sweeper = component "Purga de idempotencia" "Borrado por lotes acotados" "modules/runtime"
                sondas = component "Servidor de sondas" "node:http mínimo; mismo HealthProbeService que la API" "worker.ts"
            }

            scriptRunner = container "Sidecar de scripts" "Ejecuta código importado. Sin red, capacidades eliminadas, gVisor, cotas de CPU/memoria/pids" "Node 22 + python3"
            migrator = container "Job de migración" "prisma migrate deploy, antes de que arranque la aplicación" "Prisma CLI"
            postgres = container "PostgreSQL" "Estado, evidencia y auditoría. RLS por tenant con rol no superusuario" "PostgreSQL 16" "Database"
            redis = container "Redis" "Idempotencia, límite de tasa y caché por tenant" "Redis 7" "Database"
            portal = container "Portal de documentación" "MkDocs Material, construido en contenedor" "MkDocs"
        }

        analista -> atlas "Diseña y prueba" "HTTPS"
        aprobador -> atlas "Aprueba o rechaza" "HTTPS"
        operador -> atlas "Despliega y opera" "HTTPS"
        canal -> atlas "Pide decisiones" "HTTPS, API key o JWT"

        atlas -> idp "Verifica credenciales y roles" "HTTPS"
        atlas -> proveedorVariables "Resuelve variables ausentes" "HTTPS con timeout"
        atlas -> observabilidad "Exporta trazas y expone métricas" "OTLP / HTTP"

        api -> postgres "Lee y escribe como atlas_app" "SQL con GUC de tenant"
        api -> redis "Idempotencia y tasa" "RESP"
        api -> scriptRunner "Ejecuta nodos de script" "HTTP sobre socket Unix"
        worker -> postgres "Reclama y despacha" "SQL"
        worker -> redis "Caché" "RESP"
        migrator -> postgres "Aplica migraciones con rol elevado" "SQL"

        canal -> api "POST /v1/decisions/{artifactCode}" "HTTPS"
        analista -> api "API de gestión" "HTTPS"

        outbox -> postgres "Escribe el evento en la transacción del negocio"
        relay -> postgres "Reclama con FOR UPDATE SKIP LOCKED + lease"

        produccion = deploymentEnvironment "Producción" {
            deploymentNode "Clúster Kubernetes" {
                deploymentNode "Deployment atlas-decision-api" "2+ réplicas" {
                    containerInstance api
                }
                deploymentNode "Deployment atlas-decision-worker" "Estrategia Recreate" {
                    containerInstance worker
                }
                deploymentNode "DaemonSet/Deployment del sidecar" "Runtime gVisor" {
                    containerInstance scriptRunner
                }
                deploymentNode "Job de migración" "Antes del arranque de la aplicación" {
                    containerInstance migrator
                }
            }
            deploymentNode "PostgreSQL gestionado" {
                containerInstance postgres
            }
            deploymentNode "Redis gestionado" {
                containerInstance redis
            }
        }
    }

    views {
        systemContext atlas "Contexto" {
            include *
            autolayout lr
            description "Quién usa el motor y de qué depende"
        }

        container atlas "Contenedores" {
            include *
            autolayout lr
            description "API y worker comparten imagen; solo cambian el arranque y el rol"
        }

        component api "ComponentesApi" {
            include *
            autolayout lr
            description "Componentes del contenedor de API"
        }

        component worker "ComponentesWorker" {
            include *
            autolayout lr
            description "Trabajos de fondo y sus sondas"
        }

        deployment atlas produccion "Despliegue" {
            include *
            autolayout lr
        }

        styles {
            element "Person" {
                shape person
                background #17365D
                color #ffffff
            }
            element "Software System" {
                background #355C7D
                color #ffffff
            }
            element "External" {
                background #999999
                color #ffffff
            }
            element "Container" {
                background #6B8EAD
                color #ffffff
            }
            element "Database" {
                shape cylinder
                background #4A6E8A
                color #ffffff
            }
            element "Component" {
                background #EAF2F8
                color #1F2937
            }
        }
    }
}
