# Utilidades compartidas de grafos

Esta carpeta aloja algoritmos de presentación reutilizables fuera del dominio ejecutor. Su valor de
negocio es conservar grafos legibles para revisión; su valor de sistema es producir posiciones
deterministas sin acoplar importadores o seeders a una UI.

`tree-layout.ts` calcula niveles y reduce cruces. No decide rutas ni evalúa políticas; esas
responsabilidades pertenecen a `modules/graph`.
