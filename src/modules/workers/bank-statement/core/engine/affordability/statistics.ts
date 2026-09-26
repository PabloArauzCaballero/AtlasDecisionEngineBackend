/**
 * Los estadísticos con los que se mide un extracto, y por qué no son la media.
 *
 * Un extracto de tres meses son tres observaciones. Con tres datos, la media es
 * un estimador terrible: un aguinaldo, la devolución de un impuesto o la venta
 * de un vehículo la levantan un 60 % y el motor concluye que la persona gana
 * eso todos los meses. El error es asimétrico —sobreestimar el ingreso aprueba a
 * quien no puede pagar; subestimarlo niega un crédito que se habría pagado— y
 * por eso todo lo que se usa aquí es robusto a valores extremos por diseño.
 *
 * No hay ninguna función de este archivo que no exista precisamente para no
 * dejar que un mes raro decida.
 */

/** La mediana. Con lista vacía devuelve `null`, nunca 0: no son lo mismo. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Media recortada: descarta el mayor y el menor antes de promediar.
 *
 * Sólo recorta con **cuatro o más** observaciones. Con tres, recortar dos deja
 * una sola —que es la mediana, no una media— y encima la más arbitraria de las
 * tres. Por debajo de cuatro devuelve la media entera y deja que la mediana haga
 * el trabajo de robustez.
 */
export function trimmedMean(values: readonly number[]): number | null {
  if (values.length < 4) return mean(values);
  const sorted = [...values].sort((left, right) => left - right);
  return mean(sorted.slice(1, -1));
}

export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values) ?? 0;
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Coeficiente de variación: la dispersión EN PROPORCIÓN a la magnitud.
 *
 * Es la medida de estabilidad del ingreso, y tiene que ser relativa: una
 * desviación de 400 bolivianos sobre un sueldo de 3.000 es un ingreso variable;
 * sobre 30.000 es ruido. La desviación a secas no distingue los dos casos y
 * penalizaría al segundo.
 */
export function coefficientOfVariation(values: readonly number[]): number {
  const average = mean(values) ?? 0;
  if (average <= 0) return 0;
  return standardDeviation(values) / average;
}

/**
 * Pendiente mensual relativa: cuánto crece o cae la serie por mes, en tanto por
 * uno sobre su propio nivel.
 *
 * Es una regresión por mínimos cuadrados sobre el índice del mes. Se devuelve
 * relativa —y no en bolivianos— porque lo que decide es la MAGNITUD del cambio
 * respecto de lo que la persona gana: −300 Bs/mes es una caída del 10 % para
 * quien gana 3.000 y del 1 % para quien gana 30.000.
 *
 * Con menos de tres puntos devuelve 0: dos observaciones siempre definen una
 * recta perfecta, y llamar «tendencia» a la recta que une dos puntos es
 * inventarse una dirección donde sólo hay una diferencia.
 */
export function relativeTrend(values: readonly number[]): number {
  if (values.length < 3) return 0;
  const n = values.length;
  const meanIndex = (n - 1) / 2;
  const average = mean(values) ?? 0;
  if (average === 0) return 0;

  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < n; index += 1) {
    const deltaIndex = index - meanIndex;
    covariance += deltaIndex * ((values[index] ?? 0) - average);
    variance += deltaIndex * deltaIndex;
  }
  if (variance === 0) return 0;
  return covariance / variance / average;
}

/** Acota un valor a un intervalo. */
export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Dos decimales, para que lo que se publica sea lo que cualquiera sumaría. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Recorta los extremos al percentil dado en vez de eliminarlos (winsorización).
 *
 * Se usa donde el valor extremo **sí cuenta** pero no debe mandar: los gastos de
 * un mes con una compra grande siguen siendo gastos, y borrar ese mes fingiría
 * que la persona no gastó. Llevarlo al percentil 90 conserva el hecho y le quita
 * el poder de fijar él solo la línea base.
 */
export function winsorize(values: readonly number[], percentile = 0.9): number[] {
  if (values.length < 3) return [...values];
  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(Math.floor(percentile * (sorted.length - 1)), 0, sorted.length - 1);
  const cap = sorted[index] ?? 0;
  return values.map((value) => Math.min(value, cap));
}
