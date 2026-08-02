# Migración: leases de la cola de pruebas

Completa la cola con timestamps, intentos y lease de procesamiento. A nivel de negocio evita runs
perdidos tras una caída; a nivel de sistema permite recuperar trabajo expirado y ejecutar varias
réplicas sin duplicar evidencia vigente.
