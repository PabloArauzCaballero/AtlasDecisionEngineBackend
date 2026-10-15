/**
 * Los tres renglones de la MRZ dentro del texto del OCR.
 *
 * Se buscan por FORMA y no por posición: el reconocedor mezcla la MRZ con el
 * resto del reverso y no garantiza ningún orden. Un renglón de MRZ es una tira
 * de treinta caracteres de un alfabeto cerrado —mayúsculas, dígitos y `<`— con
 * al menos un `<`, que es lo que no aparece en un texto normal.
 */
export function candidateLines(rawText: string): string[] {
  const posibles = rawText
    .split('\n')
    .map((linea) => linea.replace(/\s+/g, '').toUpperCase())
    // El OCR confunde el relleno `<` con `«`, `K` o `C` seguidas; sólo se
    // normaliza el carácter de relleno, nunca el contenido.
    .map((linea) => linea.replace(/[«‹]/g, '<'))
    /*
     * Un renglón que YA trae relleno real y poquísimo ruido es una MRZ
     * maltratada, no un texto: el glifo intruso (`¢`, `|`, `¿`…) se sustituye
     * por relleno y son los dígitos de control quienes deciden si el renglón
     * vale. Antes un solo glifo descartaba el renglón entero, y con él la única
     * fuente del documento que puede demostrarse. La condición de los DOS `<`
     * previos es lo que deja fuera un domicilio con puntos o barras: un texto
     * normal no trae relleno de MRZ.
     */
    .map((linea) => {
      const relleno = (linea.match(/</g) ?? []).length;
      const ruido = (linea.match(/[^A-Z0-9<]/g) ?? []).length;
      return relleno >= 2 && ruido > 0 && ruido <= 3 ? linea.replace(/[^A-Z0-9<]/g, '<') : linea;
    })
    /*
     * El mínimo es 20 y no 28, y esto NO es laxitud: el reconocedor se come los
     * `<` finales con muchísima frecuencia —son relleno, y un relleno repetido
     * veinte veces es justo lo que un OCR abrevia—. Medido aquí:
     * `IDBOL7654321<<8<<<<<<<<<<<` llegó con 26 caracteres, y exigir 28
     * descartaba la línea, con ella la MRZ entera, y con ella la única fuente
     * del documento que trae dígitos de control. El relleno se repone abajo, y
     * si la reposición fuera incorrecta el propio dígito de control lo delata.
     */
    .filter((linea) => /^[A-Z0-9<]{20,34}$/.test(linea) && (linea.match(/</g) ?? []).length >= 2);

  /*
   * Los TRES ÚLTIMOS. La MRZ va al pie del documento, y por delante puede haber
   * texto que también case con el patrón —un domicilio en mayúsculas y sin
   * espacios, por ejemplo—. Quedarse con los primeros elegía justamente ése.
   *
   * Sin ajustar a 30 todavía: eso lo hace `variantes`, que necesita el renglón
   * ENTERO para poder realinearlo sin perder su último carácter.
   */
  return posibles.slice(-3);
}
