# Qué cambia y por qué

<!-- Una o dos frases. El "por qué" es lo que no se puede deducir del diff. -->

## Tipo de cambio

- [ ] Software compatible
- [ ] Software incompatible (requiere deprecación previa y subir `API_VERSION`)
- [ ] Esquema compatible
- [ ] Esquema destructivo (requiere *expand/contract* y ventana)
- [ ] Configuración
- [ ] Solo documentación

## Evidencia ejecutada

<!-- Pegue la SALIDA REAL. "Debería pasar" no es evidencia. -->

```
```

## Lista de comprobación

### Siempre
- [ ] `yarn format:check`, `yarn typecheck`, `yarn build`
- [ ] `yarn test` con salida real pegada arriba
- [ ] Si toca el camino de decisión o la persistencia: `yarn test:e2e`

### Si cambia la API
- [ ] `yarn docs:openapi:generate` ejecutado y `openapi/openapi.json` confirmado
- [ ] `yarn docs:openapi:check` y `yarn docs:openapi:lint` en verde
- [ ] Si el cambio es incompatible: deprecación anunciada y `API_VERSION` prevista

### Si cambia el esquema
- [ ] Migración **escrita a mano** y aplicada con `migrate deploy`
- [ ] Política RLS espejo si la tabla tiene `tenant_id`
- [ ] Índice para la consulta que realmente existe
- [ ] `yarn migration:validate`
- [ ] Compatible hacia atrás, o plan *expand/contract* descrito

### Si añade configuración
- [ ] Declarada en `env.schema.ts` — **una variable no declarada se ignora en silencio**
- [ ] Comentario que explica para qué sirve (alimenta el catálogo generado)
- [ ] Añadida a `.env.example`

### Si toca seguridad
- [ ] ¿Identidad, roles, RLS, auditoría o ejecución de código? → revisión de seguridad
- [ ] Sin secretos en ficheros versionados
- [ ] Prueba que demuestra que **falla cerrado**

### Documentación
- [ ] `yarn docs:catalog` ejecutado si cambió código que alimenta un catálogo
- [ ] Runbook actualizado si cambió un procedimiento operativo
- [ ] ADR si fue una decisión estructural
- [ ] `yarn docs:validate` en verde

## Riesgos y reversión

<!-- Qué puede salir mal y cómo se revierte. Si la respuesta es "nada", dígalo explícitamente. -->
