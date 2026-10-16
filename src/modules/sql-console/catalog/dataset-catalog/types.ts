/** Tipo de dato tal y como se le presenta a quien consulta, no el tipo de Postgres. */
export type ColumnKind = 'texto' | 'numero' | 'entero' | 'booleano' | 'fecha' | 'identificador';

export interface CatalogColumn {
  readonly name: string;
  readonly kind: ColumnKind;
  readonly description: string;
}

export interface CatalogTable {
  readonly name: string;
  readonly description: string;
  /**
   * Frase que explica qué es UNA fila. Sin esto, un `COUNT(*)` se interpreta mal.
   *
   * `null` en una vista recién descubierta que nadie ha fichado todavía. No se rellena con
   * una frase derivada del nombre: un grano inventado se lee igual que uno comprobado, y es
   * justo la afirmación que hace que alguien cuente mal sin enterarse.
   */
  readonly grain: string | null;
  readonly columns: readonly CatalogColumn[];
}

export interface CatalogDataset {
  readonly name: string;
  readonly description: string;
  readonly tables: readonly CatalogTable[];
}

export const id = (name: string, description: string): CatalogColumn => ({
  name,
  kind: 'identificador',
  description,
});
