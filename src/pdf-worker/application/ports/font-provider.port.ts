/**
 * Tipografía del documento (§23).
 *
 * El problema que resuelve: un PDF maquetado con una fuente que sólo existe en el portátil de
 * quien lo programó sale distinto en el contenedor —otras métricas, otros saltos de línea,
 * otro número de páginas— y nadie se entera hasta que un cliente recibe un informe de nueve
 * hojas que en desarrollo tenía ocho.
 *
 * La solución es embeber: el proveedor devuelve reglas `@font-face` con la fuente dentro, en
 * `data:` URI. Si el despliegue no ha incorporado ninguna, lo DICE —`embedded: []`— para que
 * el arranque pueda registrarlo y `/health` lo publique, en vez de fingir que todo va bien
 * mientras se usa lo que haya en el sistema operativo.
 */
export interface FontFaceBundle {
  /** CSS listo para insertar en el `<head>`; cadena vacía si no hay ninguna embebida. */
  readonly css: string;
  /** Familias efectivamente embebidas. Vacío = se depende del sistema. */
  readonly embedded: readonly string[];
  /** Pila que deben usar los tokens, ya con los respaldos. */
  readonly fontFamily: string;
  readonly monoFamily: string;
  readonly totalBytes: number;
}

export interface FontProviderPort {
  load(): Promise<FontFaceBundle>;
}

export const FONT_PROVIDER_PORT = Symbol('FontProviderPort');
