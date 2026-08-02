# Seguridad

Este repositorio contiene una plataforma financiera sensible. No publique secretos, payloads reales de clientes ni evidencias KYC en issues o logs.

Este documento existe para proteger a clientes y operadores, y para que un incidente tenga un
canal responsable. A nivel de sistema fija el mínimo que rodea los controles implementados; no
convierte por sí solo al repositorio en un entorno certificado.

## Reporte responsable

Reporte vulnerabilidades por el canal privado de seguridad definido por ATLAS. Incluya componente afectado, versión, impacto, pasos mínimos de reproducción y mitigación sugerida. No ejecute pruebas destructivas contra producción.

## Reglas operativas mínimas

- Cambiar todas las claves de ejemplo.
- Exponer el servicio únicamente detrás de API Gateway/WAF e IAM.
- Usar TLS, KMS/Secrets Manager y PostgreSQL/Redis privados.
- Restringir el Control Plane a redes corporativas.
- Replicar auditoría a almacenamiento inmutable.
- Rotar secretos y aplicar mínimo privilegio.
- Ejecutar análisis SAST/SCA, pruebas de penetración y carga antes de producción.

El esquema de configuración rechaza producción con API keys como único modo de autenticación,
URLs críticas sin HTTPS, Swagger activo, scripts in-process o secretos de ejemplo. Consulte
`docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` y `docs/runbooks/OPERATIONS.md` para el diseño y la
operación detallados.
