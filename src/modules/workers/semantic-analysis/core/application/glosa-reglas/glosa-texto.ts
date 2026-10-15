/**
 * Mayúsculas y sin tildes.
 *
 * Se pliega UNA vez y todas las reglas se escriben contra el texto plegado. La
 * alternativa —`[óo]` en cada patrón— multiplica los sitios donde olvidarse de
 * una tilde, y ya pasó: `comisión` casaba y `COMISION` no, según qué banco
 * imprimiera el extracto en mayúsculas.
 */
export function plegar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase();
}

/** El texto de evidencia: la glosa recortada a 120 caracteres. */
export function recorte(texto: string): string {
  return texto.length <= 120 ? texto : `${texto.slice(0, 117)}…`;
}
