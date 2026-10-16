/**
 * Sección del extracto a la que pertenece una fila.
 *
 * Es el único dato que fija el signo del movimiento: este formato no imprime
 * una columna de débito y otra de crédito, sino **dos tablas separadas** con una
 * sola columna de importe cada una, siempre en positivo. Leer el signo de la
 * cifra sería imposible; se lee de la tabla que la contiene.
 */
export type Section = 'DEPOSITS' | 'WITHDRAWALS';

export const DEPOSITS_HEADING = /^Dep[oó]sitos$/i;
export const WITHDRAWALS_HEADING = /^Retiros$/i;
export const TABLE_HEADER = /Fecha\s+Hora\s*Descripci[oó]n/i;
export const END_OF_SECTION = /^Total\s+(?:dep[oó]sitos|retiros)\b/i;

export const DATE = /(?<!\d)(\d{2}\/\d{2}\/\d{4})(?!\d)/;

/**
 * La hora no puede exigir un límite de palabra por la derecha: cuando el
 * movimiento cabe en un renglón, el generador pega la glosa a la hora dentro de
 * la misma ficha —`23:59PAGO DE INTERES`— y un `\b` no encuentra frontera entre
 * `9` y `P`.
 */
export const TIME = /(?<!\d)(\d{1,2}:\d{2})(?!\d)/;

/**
 * Comprobante de la operación, al final de la ficha que lo contiene.
 *
 * Se reconoce por su forma y no por su columna, por dos razones medidas sobre
 * el extracto real: el generador une la referencia y el comprobante en una sola
 * ficha cuando quedan pegados —`61536391332P68253061` es «6153639133» seguido
 * de «2P68253061»—, y cuando van separados el comprobante cae en una
 * coordenada distinta en cada tabla. Buscarlo por forma cubre los dos casos:
 * las **102** operaciones llevan una y sólo una ficha que termina en `2P` más
 * ocho alfanuméricos, y ninguna otra ficha a la derecha de la glosa la imita.
 */
export const VOUCHER = /(2P[A-Z0-9]{8})$/;

/**
 * Canal de la operación: lo que sigue al primer « - » de la glosa, hasta el
 * primer campo rotulado. Los seis tipos de operación del extracto medido lo
 * imprimen así, con tres valores distintos: `BNB NET`, `ATM/POS` y la agencia
 * que registró el asiento.
 */
export const OPERATION_CHANNEL =
  /^[^]*?\s-\s([^]*?)(?=\s+(?:Cuenta\s+(?:Origen|Destino):|Lugar:|Nombre:|Dato\s+Adicional:)|$)/;

/**
 * Separación vertical a partir de la cual dos renglones son filas distintas.
 *
 * Medido con `yarn inspect:gaps` sobre el extracto real: dentro de una fila el
 * interlineado es de 3,8 pt (tabla de retiros) o 7,6 pt (tabla de depósitos), y
 * el salto entre filas nunca baja de 8,7 pt. Con este umbral los 102
 * movimientos quedan en 102 grupos de una sola ancla y ninguno fusionado.
 */
export const ROW_GAP_THRESHOLD = 8.2;

/**
 * Borde izquierdo de la columna de descripción, distinto en cada tabla: la de
 * depósitos necesita más ancho para las columnas de la derecha y desplaza la
 * glosa.
 */
export const DESCRIPTION_START: Readonly<Record<Section, number>> = {
  DEPOSITS: 0.14,
  WITHDRAWALS: 0.11,
};

/** Borde izquierdo de la celda de referencia y comprobante, por tabla. */
export const REFERENCE_START: Readonly<Record<Section, number>> = {
  DEPOSITS: 0.68,
  WITHDRAWALS: 0.74,
};

/**
 * Zona a la derecha de la referencia. El importe es la **última** ficha
 * numérica que cae en ella, no la primera: entre ambas puede aparecer el ITF,
 * que este formato imprime en su propia columna intermedia.
 */
export const AMOUNT_ZONE_START = 0.8;
