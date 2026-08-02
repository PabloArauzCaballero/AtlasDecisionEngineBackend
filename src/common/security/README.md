# Seguridad e identidad

Esta carpeta establece el principal confiable y aplica audiencia, roles, tenant y rate limits. A
nivel de negocio hace efectiva la segregación de funciones; a nivel de sistema verifica JWT/IdP,
resuelve clientes técnicos registrados y ejecuta guards/interceptores globales.

El llamante nunca declara roles ni identidad mediante cabeceras. `PLATFORM_ADMIN` sólo es comodín
para identidades firmadas, y las denegaciones relevantes se auditan sin retener objetos HTTP.
