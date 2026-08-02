-- Las coordenadas de un nodo son porcentajes (0-100) del lienzo del editor.
-- Como enteros, cada paso equivalía a ~17 px: los nodos "saltaban" al recargar
-- el grafo después de arrastrarlos. Se pasan a doble precisión.
ALTER TABLE "decision_rule_node"
  ALTER COLUMN "x_pos" TYPE DOUBLE PRECISION USING "x_pos"::double precision,
  ALTER COLUMN "y_pos" TYPE DOUBLE PRECISION USING "y_pos"::double precision;
