-- Retira el catálogo semántico anterior al árbol de gastos.
--
-- El worker nació clasificando reclamos de atención al cliente
-- (`COBRO_NO_RECONOCIDO`, `FRAUDE_SOSPECHADO`…) y ahora clasifica movimientos
-- bancarios contra un árbol de gasto e ingreso. Son dos catálogos distintos, no
-- dos versiones del mismo.
--
-- La semilla es idempotente por `(tenant, code)`: actualiza lo que declara y
-- **no toca lo que ya no declara**. Es lo correcto —el catálogo son datos y
-- alguien puede haber añadido categorías propias que una semilla no debe
-- borrar—, pero deja huérfanas a las categorías del catálogo anterior, que
-- siguen activas y siguen compitiendo como candidatas. Medido: con las cinco
-- vivas, «PAGO FACTURA DE ENERGIA ELECTRICA» aceptaba además categorías ajenas,
-- y el resultado salía `MULTI_MATCH` en vez de `MATCH`.
--
-- Por eso se retiran AQUÍ y por código explícito, en lugar de hacer que la
-- semilla desactive todo lo que no declara: esto se puede leer, auditar y
-- revertir, y no puede llevarse por delante una categoría que un cliente añadió.
--
-- Se desactivan en lugar de borrarse. La auditoría de decisiones pasadas
-- referencia estos códigos, y un `DELETE` convertiría un histórico explicable en
-- un montón de códigos sin significado.

UPDATE "decision_semantic_category"
SET "is_active" = false
WHERE "code" IN (
  'COBRO_NO_RECONOCIDO',
  'FRAUDE_SOSPECHADO',
  'DEVOLUCION_SOLICITADA',
  'BLOQUEO_SOLICITADO',
  'CONSULTA_GENERAL'
);
