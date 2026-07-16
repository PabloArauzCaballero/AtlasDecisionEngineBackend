# Seguridad

Este repositorio contiene una plataforma financiera sensible. No publique secretos, payloads reales de clientes ni evidencias KYC en issues o logs.

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
