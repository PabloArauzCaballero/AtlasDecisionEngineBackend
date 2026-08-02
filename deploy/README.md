# Despliegue

Esta carpeta reúne artefactos declarativos para ejecutar el backend fuera del proceso de
desarrollo. A nivel de negocio hace reproducible la entrega y explicita que un manifiesto de
referencia no equivale a aprobación de Go-Live. A nivel de sistema separa topología, recursos y
controles de plataforma del código NestJS.

`kubernetes/` contiene manifiestos de referencia. Los valores de secretos, ingress, TLS,
observabilidad, almacenamiento y políticas corporativas deben resolverse en la plataforma destino.
