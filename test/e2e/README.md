# Pruebas end-to-end

Estas suites ejercitan autenticación, persistencia, gobierno, despliegue y ejecución a través de
HTTP. A nivel de negocio demuestran que los roles y ciclos críticos funcionan juntos; a nivel de
sistema levantan una aplicación Nest real contra PostgreSQL/Redis y verifican respuestas, side
effects, RLS y auditoría.

Use infraestructura aislada y migrada desde cero. Los escenarios crean códigos únicos para poder
repetirse y `support/global-teardown.ts` cierra recursos compartidos.
