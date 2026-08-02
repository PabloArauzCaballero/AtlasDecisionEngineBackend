# Contratos HTTP compartidos

Esta carpeta normaliza IDs, concurrencia optimista y paginación. A nivel de negocio entrega errores
consistentes y listas predecibles; a nivel de sistema impide que valores inválidos lleguen a Prisma,
centraliza `If-Match` y limita tamaños de página/cursor.

Use `parseBigIntId`, `parseIfMatch`, `paginationArgs` y `keysetArgs` en vez de conversiones o
protocolos locales.
