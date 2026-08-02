# Guía para consumidores de eventos

Reglas para escribir un consumidor que no rompa el sistema. La entrega es **al menos una vez**
y el orden global **no** está garantizado; todo lo demás se deriva de ahí.

## 1. Sea idempotente, siempre

Procesar dos veces el mismo evento debe producir el mismo estado que procesarlo una.

```ts
// El patrón del repositorio: registrar el evento procesado y descartar el repetido.
// Ver modules/notifications/notification-projector.service.ts
```

`decision_processed_event` es la tabla que lo sostiene. Un consumidor nuevo debe usarla o
aportar su propia clave de deduplicación.

## 2. No asuma orden

Un evento que falló y se reintentó llega **después** de otros posteriores. Si su lógica depende
del orden, reconstrúyalo por agregado usando `occurredAt`, y contemple recibir un estado más
nuevo antes que uno más viejo.

## 3. Falle rápido y con causa

Un consumidor que traga la excepción impide el reintento y **pierde** el evento en silencio.
Si no puede procesarlo, lance: el relay lo reprogramará con retroceso y, en el peor caso, lo
dejará en la cola muerta, que es visible.

## 4. No haga E/S larga dentro del consumidor

El bus es en proceso y el relay espera. Una llamada de red lenta retrasa todo el lote. Escriba
lo que necesita y delegue el trabajo largo.

## 5. Tolere payloads más nuevos

El sobre lleva `schemaVersion`. Un campo añadido no debe romperle: ignore lo que no conoce y
compruebe la versión si su lógica depende de la forma.

## 6. El tenant viaja en el sobre

Nunca deduzca el tenant del contenido. El relay es **cross-tenant por diseño** y drena la tabla
completa; su consumidor recibirá eventos de todos los tenants.

## 7. Al escribir pruebas

- Cuente eventos globales con `>=`, no con `==`: el relay procesa también lo que dejaron otras corridas.
- No dependa de que el evento llegue en el mismo tick; el despacho es asíncrono.
- Use identificadores de tenant únicos por corrida.

## Registrar un consumidor nuevo

1. Añada el tipo a `DecisionEventType` si no existe — es la **fuente única**; un literal divergente rompe la tubería en silencio.
2. Documente el payload v1 en `event-types.ts`.
3. Suscríbase en el bus y deduplique.
4. Regenere el catálogo: `yarn docs:catalog`.
5. Añada la prueba que demuestre la idempotencia procesando el mismo evento dos veces.
