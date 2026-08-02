# Configuración validada

`env.schema.ts` es el contrato ejecutable de configuración. Su propósito de negocio es impedir que
un entorno inseguro se presente como producción; su propósito de sistema es normalizar variables,
aplicar defaults y rechazar combinaciones peligrosas antes de abrir puertos.

Toda variable nueva debe aparecer también en `.env.example` y en la documentación de despliegue.
Los secretos nunca llevan un valor real en archivos versionados.
