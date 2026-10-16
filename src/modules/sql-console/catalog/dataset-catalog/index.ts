/**
 * La FICHA de la superficie de consulta: qué significa cada tabla y cada columna.
 *
 * Este archivo dejó de ser la lista de lo que existe. Lo que existe lo dice la base, y se lo
 * pregunta `catalog-discovery.service.ts` a `pg_catalog`. El reparto quedó así porque cada
 * mitad falla de una manera distinta:
 *
 *  - La FORMA escrita a mano (qué vistas, qué columnas) es correcta el día que se escribe y
 *    queda muda en la primera migración que añada una. El explorador seguía enseñando
 *    dieciséis relaciones y la guardia rechazaba la decimoséptima con «no existe en los
 *    datasets de la consola», sobre una vista que existía, estaba gobernada y ya tenía
 *    concedido el `SELECT`.
 *  - La PROSA —la explicación, el grano, qué significa cada columna— no se puede deducir de
 *    `information_schema`. Sin ella el explorador sería una lista de nombres, y un `COUNT(*)`
 *    sobre una tabla cuyo grano nadie explicó se interpreta mal.
 *
 * Así que aquí se declara lo segundo y se descubre lo primero. Lo que se escriba aquí para
 * una relación que la base no publica sencillamente no aparece: la ficha no puede inventar
 * una tabla. Y una vista nueva aparece sola, con la descripción de su propio `COMMENT ON
 * VIEW` mientras nadie escriba la suya aquí.
 *
 * Sigue alimentando a los tres consumidores —el explorador del portal, el autocompletado y la
 * lista blanca de `sql-guard.ts`—, sólo que los tres leen ahora el catálogo DESCUBIERTO, así
 * que siguen sin poder divergir entre sí. Ésa era la propiedad que importaba y no se pierde:
 * el fallo más confuso posible en una consola es una tabla que el árbol muestra y el motor
 * dice que no existe.
 *
 * El espejo del SQL está en `20260814090000_sql_console_governed_views`. La prueba
 * `dataset-catalog.integration.spec.ts` consulta `information_schema` y exige que lo descrito
 * aquí exista en la base: describir una columna que la vista no publica sería documentar una
 * mentira, y es el error que una ficha escrita a mano comete sola.
 */
export { DATASET_NAMES, QUALIFIED_RELATIONS, SQL_CONSOLE_CATALOG, findTable } from './registry';
export type { CatalogColumn, CatalogDataset, CatalogTable, ColumnKind } from './types';
