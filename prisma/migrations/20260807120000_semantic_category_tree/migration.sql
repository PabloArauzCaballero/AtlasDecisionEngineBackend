-- Árbol de categorías del worker semántico.
--
-- El catálogo era una lista plana. Clasificar gasto doméstico contra una lista
-- plana obliga a elegir el nivel de detalle de antemano: o hay una categoría
-- «Vivienda» que no distingue el alquiler de la luz, o hay treinta hojas sueltas
-- entre las que nada dice cuáles son variantes de lo mismo. Con el padre
-- declarado, la hoja conserva el detalle y el informe puede agregar por rama.
--
-- Se referencia el CÓDIGO del padre, no su `id`. El catálogo se siembra e
-- importa por código, y una clave foránea contra `id` obligaría a insertar cada
-- padre antes que sus hijos en toda carga. `(tenant_id, code)` ya es único, así
-- que la clave foránea compuesta cierra el árbol sin imponer ese orden.

ALTER TABLE "decision_semantic_category"
  ADD COLUMN "parent_code" VARCHAR(120);

-- El padre vive en el MISMO tenant. Sin la columna de tenant en la clave, la
-- categoría de un cliente podría colgar del árbol de otro, que es precisamente
-- la fuga que el resto del esquema evita con RLS.
--
-- `RESTRICT` y no `SET NULL`: borrar «Vivienda» dejando «Alquiler» colgando de
-- la raíz no es una degradación, es una reclasificación silenciosa de todo lo
-- que ya se decidió bajo esa rama. Quien retire una rama debe decir antes qué
-- pasa con sus hojas.
ALTER TABLE "decision_semantic_category"
  ADD CONSTRAINT "decision_semantic_category_parent_fkey"
  FOREIGN KEY ("tenant_id", "parent_code")
  REFERENCES "decision_semantic_category" ("tenant_id", "code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una categoría que se declara hija de sí misma produce un ciclo de longitud
-- uno, y el recorrido del árbol no termina. Los ciclos más largos no se pueden
-- prohibir con un CHECK; los detecta el sembrador, que es quien construye el
-- catálogo.
ALTER TABLE "decision_semantic_category"
  ADD CONSTRAINT "decision_semantic_category_parent_not_self"
  CHECK ("parent_code" IS NULL OR "parent_code" <> "code");

-- Recorrer el árbol hacia abajo es la consulta que este índice sirve: dado un
-- nodo, sus hijos. Sin él, cada nivel es un recorrido completo de la tabla.
CREATE INDEX "decision_semantic_category_tenant_parent_idx"
  ON "decision_semantic_category" ("tenant_id", "parent_code");
