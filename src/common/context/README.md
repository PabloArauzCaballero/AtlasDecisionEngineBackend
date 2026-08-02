# Contexto de request

Esta carpeta propaga correlación, tenant e identidad mediante `AsyncLocalStorage`. A nivel de
negocio permite reconstruir una operación de extremo a extremo; a nivel de sistema evita pasar
metadatos observacionales por cada firma y habilita logs y RLS coherentes.

El contexto se crea en `main.ts` y se enriquece después de autenticar. No debe almacenar payloads,
PII ni objetos de Express que sobrevivan al request.
