# Política de deprecación

## Regla

Nada desaparece sin haber estado **marcado como obsoleto** y sin haber ofrecido a qué migrar.
Deprecar sin indicar el sustituto deja al consumidor sin salida.

## Fases

| Fase | Qué ocurre | Señal para el consumidor |
| --- | --- | --- |
| 1. Anuncio | La operación se marca `deprecated: true` en el contrato, con la alternativa en su descripción | Visible en la referencia interactiva y en el catálogo de endpoints |
| 2. Convivencia | La operación antigua y la nueva funcionan a la vez | Ninguna ruptura |
| 3. Retirada | Se elimina y **sube `API_VERSION`** | El cliente fijado a la versión anterior no se ve afectado hasta que migra |

La duración de la fase 2 la fija el responsable del producto según los consumidores conocidos;
no hay un plazo automático, porque retirar algo que un canal de originación sigue llamando es
una incidencia de negocio, no técnica.

## Cómo se marca

```ts
@ApiOperation({
  operationId: 'auditListEvents',
  summary: 'Listar eventos de auditoría (obsoleto)',
  deprecated: true,
  description: 'Use `GET /v1/audit/events/cursor`, que pagina por cursor y no degrada con el volumen.',
})
```

La marca viaja al contrato, al portal y a cualquier cliente generado.

## Qué se considera retirada

Además de borrar una ruta:

- Eliminar o renombrar un campo de una respuesta.
- Estrechar una validación existente.
- Cambiar el código de error devuelto ante una situación que ya ocurría.
- Renombrar un `operationId` — cambia el nombre de la función en los clientes generados.

Ver [versionado](versioning.md) para la lista completa de qué es incompatible.

## Aplicación en curso

Hoy no hay ninguna operación marcada como obsoleta. El par
`GET /v1/audit/events` (desplazamiento) y `GET /v1/audit/events/cursor` (cursor) convive de
forma **aditiva y permanente**: el segundo no sustituye al primero, resuelve un caso distinto.

## Deprecación en el modelo de datos

Una variable o un campo calculado tienen su propio ciclo (`DEPRECATED` → `RETIRED`). Retirar
una versión en uso se rechaza con `CALCULATED_FIELD_VERSION_IN_USE` y no con un error de clave
foránea: el mensaje dice **qué artefactos** la usan, que es lo que el autor necesita para poder
migrar.
