/**
 * Dígito de control de ICAO 9303: pesos 7-3-1 en ciclo, letras como 10..35 y
 * el relleno como cero.
 *
 * Se exporta para poder comprobarlo contra los ejemplos que el propio corpus
 * trae calculados (`520727` → `3`, `AB2134<<<` → `5`). Una aritmética que se
 * demuestra contra un oráculo externo vale más que una que se demuestra contra
 * sus propias pruebas.
 */
export function checkDigit(valor: string): string {
  const pesos = [7, 3, 1];
  let suma = 0;
  for (let i = 0; i < valor.length; i += 1) {
    const caracter = valor[i];
    let peso = 0;
    if (caracter >= '0' && caracter <= '9') peso = caracter.charCodeAt(0) - 48;
    else if (caracter >= 'A' && caracter <= 'Z') peso = caracter.charCodeAt(0) - 55;
    else peso = 0; // `<` y cualquier cosa que no debiera estar ahí
    suma += peso * pesos[i % 3];
  }
  return String(suma % 10);
}
