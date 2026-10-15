/**
 * Convierte pesos relativos en un número EXACTO de casos por desenlace.
 *
 * Reparto por resto mayor: los enteros primero y las plazas que sobran a quien tenía la
 * fracción más alta, con el código como desempate para que el resultado sea el mismo en
 * cada corrida. Redondear cada peso por su cuenta perdía casos —diez casos repartidos
 * entre tres ramas daban nueve— y la corrida ejecutaba menos de los que decía.
 *
 * Vive aquí, y no en el servicio, porque es aritmética pura: así se prueba sin levantar
 * medio Nest para comprobar una suma.
 */
export function allocateOutcomeCounts(
  weights: ReadonlyArray<readonly [string, number]>,
  total: number,
): Map<string, number> {
  const suma = weights.reduce((acumulado, [, peso]) => acumulado + peso, 0);
  if (suma <= 0 || total <= 0) return new Map(weights.map(([clave]) => [clave, 0]));

  const exactos = weights.map(([clave, peso]) => [clave, (peso / suma) * total] as const);
  const reparto = new Map(exactos.map(([clave, parte]) => [clave, Math.floor(parte)]));
  let sobran = total - [...reparto.values()].reduce((acumulado, casos) => acumulado + casos, 0);
  const porResto = [...exactos].sort((a, b) => (b[1] % 1) - (a[1] % 1) || a[0].localeCompare(b[0]));
  for (const [clave] of porResto) {
    if (sobran <= 0) break;
    reparto.set(clave, (reparto.get(clave) ?? 0) + 1);
    sobran -= 1;
  }
  return reparto;
}
