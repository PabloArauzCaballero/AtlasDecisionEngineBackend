# Despliegues de decisiones

Este módulo publica artefactos compilados en ambientes y administra rollback/suspensión. A nivel
de negocio garantiza que sólo políticas aprobadas llegan a tráfico; a nivel de sistema aplica
segregación de funciones, locks PostgreSQL, invariantes de tráfico y bindings resolubles por el
runtime.

`DeploymentResolverService` cachea por tenant/artefacto/ambiente e invalida tras cambios. El
servicio nunca compila ni altera una versión durante el despliegue.
