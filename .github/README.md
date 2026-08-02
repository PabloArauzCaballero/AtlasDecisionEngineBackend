# Automatización de GitHub

Esta carpeta existe para que calidad y seguridad se apliquen de forma repetible en cada cambio. A
nivel de negocio reduce el riesgo de entregar decisiones sin evidencia; a nivel de sistema define
workflows con permisos mínimos, servicios efímeros y gates verificables.

`workflows/ci.yml` valida formato, tipos, build, migraciones, pruebas, cobertura, smoke e imágenes.
`workflows/security.yml` ejecuta CodeQL, revisión de dependencias y escaneo de contenedor.
