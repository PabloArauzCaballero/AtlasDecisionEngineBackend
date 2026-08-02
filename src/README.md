# Código productivo

Esta carpeta contiene el backend que se compila y despliega. A nivel de negocio materializa el
ciclo de vida de decisiones de crédito, riesgo y fraude; a nivel de sistema contiene el bootstrap,
capacidades transversales y módulos de dominio de NestJS.

- `main.ts` configura transporte HTTP, validación, CORS, seguridad, OpenAPI, trazas y apagado.
- `app.module.ts` es la raíz de composición; no debe acumular lógica de negocio.
- `common/` ofrece infraestructura compartida sin semántica de un dominio concreto.
- `modules/` agrupa capacidades por dominio y mantiene controladores delgados.

Toda entrada externa se valida, toda autorización se decide en backend y toda escritura regulada
debe conservar evidencia atómica.
