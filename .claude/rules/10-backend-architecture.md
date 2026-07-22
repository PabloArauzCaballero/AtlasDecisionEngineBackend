---
paths:
  - "src/**/*.ts"
---

# Arquitectura backend (NestJS)

- Sin lógica de negocio en los controladores: el controller parsea/valida
  entrada, delega en un servicio y forma la respuesta. Ver `src/modules/*/`.
- DTOs siempre validados con `class-validator` (+ `zod` para el env). No aceptes
  entrada sin validar.
- No devuelvas modelos Prisma crudos hacia afuera; mapea a la forma de respuesta.
- Un módulo por dominio (`src/modules/<x>/<x>.module.ts`), registrado en
  `src/app.module.ts`. Los servicios que otros módulos necesiten van en `exports`.
- Evita dependencias circulares entre módulos: cuando un servicio necesite
  colaborar con otro dominio de forma opcional, pásalo como **argumento de
  llamada**, no como dependencia de constructor (patrón usado por
  `ArtifactReferenceResolver` y el `onStep` de ejecución en vivo sobre
  `ExecutionEngineService.execute()`).
- Errores centralizados: lanza `DomainException(code, message, httpStatus, details?)`;
  el `DomainExceptionFilter` global la traduce a RFC7807. No lances `Error` crudo
  a la capa HTTP.
- Tipado estricto: prefiere `unknown` + validación antes que `any`.
