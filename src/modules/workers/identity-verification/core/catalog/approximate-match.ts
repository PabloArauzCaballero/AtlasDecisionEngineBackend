/**
 * Cotejo APROXIMADO de un rótulo del catálogo contra lo que devolvió el OCR.
 *
 * ## Por qué existe: el catálogo se escribió contra una tarjeta dibujada
 *
 * Los anclajes de `bolivia-ci.catalog.ts` son expresiones regulares exactas
 * —`/CEDULA\s+DE\s+IDENTIDAD/`— y funcionan perfectamente sobre los ejemplares
 * sintéticos de `fixtures/identity-card.ts`, que están DIBUJADOS con esos mismos
 * rótulos en una tipografía limpia. Sobre una fotografía de una cédula real no
 * encuentran casi nada, y eso no es una opinión: medido sobre una cédula
 * boliviana auténtica del DS 4924 fotografiada con un móvil, el catálogo entero
 * alcanzaba una cobertura de entre 0,059 y 0,186 —de 18 anclajes casaban dos o
 * tres— con la tarjeta perfectamente derecha, enfocada y legible.
 *
 * El motivo es que los rótulos de la cédula están impresos en gris, a cuerpo muy
 * pequeño, sobre un fondo guilloché tricolor. Tesseract los devuelve
 * sistemáticamente mutilados, y no de forma aleatoria sino perdiendo caracteres:
 *
 * | impreso                 | leído (medido)                       |
 * | ----------------------- | ------------------------------------ |
 * | CÉDULA DE IDENTIDAD     | `CEI 1 DE` … `IDENTIDAD`             |
 * | IDENTIFICACIÓN PERSONAL | `ITIFICACIÓN PERSONA)`               |
 * | FECHA DE NACIMIENTO     | `PFrCHA DE MACIMIENTO`               |
 * | FECHA DE EMISIÓN        | `FECHA DI EMIBION`                   |
 * | FECHA DE EXPIRACIÓN     | `rca DE FAPIRACIÓN`                  |
 * | DOMICILIO               | `DOMICILI`                           |
 *
 * Ninguna de esas lecturas casa con su expresión regular, y todas son
 * inequívocamente el rótulo que la tarjeta imprime. Exigir el texto exacto
 * convierte cada carácter que el reconocedor se come en un anclaje ausente, y
 * los anclajes ausentes son lo que `identity-fraud.scorer.ts` interpreta como
 * plantilla incompleta: o sea, **una cédula auténtica acusada de falsa por la
 * tipografía de sus propios rótulos**.
 *
 * ## Qué hace en vez de eso
 *
 * Mide la DISTANCIA DE EDICIÓN entre el rótulo del catálogo y la subcadena del
 * texto leído que más se le parezca, y da el anclaje por encontrado cuando esa
 * distancia cabe dentro de una tolerancia proporcional a la longitud del rótulo.
 * Es la misma idea que el analizador ya aplicaba a los nombres de mes, aplicada
 * donde hace más falta.
 *
 * Dos decisiones sostienen que esto no sea simplemente «aflojar»:
 *
 * 1. **La tolerancia es proporcional y con suelo alto.** Un quinto de la
 *    longitud, redondeado hacia abajo, y el rótulo tiene que medir al menos
 *    cinco caracteres. `SERIE` admite un error; `IDENTIFICACION PERSONAL`
 *    admite cuatro. Un rótulo corto no se puede acertar por casualidad porque
 *    apenas se le tolera nada, y uno largo tampoco porque cuatro ediciones sobre
 *    veintidós caracteres siguen exigiendo que dieciocho coincidan EN ORDEN.
 *
 * 2. **Se compara sobre texto plegado a `[A-Z0-9]`.** Espacios, guiones y signos
 *    desaparecen de los DOS lados. Es lo correcto porque el reconocedor inventa
 *    y se come separadores continuamente —`C/CUQUISAS` sale `CICUQUISAS`— y
 *    porque quita de la tolerancia el gasto de los espacios, que es el error más
 *    frecuente y el menos informativo.
 *
 * ## Lo que NO hace
 *
 * No normaliza confusiones de glifo (`0`↔`O`, `5`↔`S`). Eso lo hace `mrz-td1.ts`
 * y sólo en las posiciones donde la norma GARANTIZA que hay un dígito, que es la
 * única circunstancia en la que deshacer una confusión no es adivinar. Aquí, en
 * texto libre, plegar `O` y `0` a lo mismo haría colisionar palabras distintas y
 * la tolerancia ya cubre ese error como una edición más.
 */

/**
 * Longitud mínima de un rótulo para cotejarlo con TOLERANCIA. Por debajo sólo
 * cuenta su expresión regular exacta.
 *
 * Ocho, y el número está medido contra un falso positivo concreto. Con el mínimo
 * en cinco, `SECCION` —el campo administrativo del SEGIP, siete caracteres, una
 * edición de tolerancia— casaba dentro de `DIRECCIÓN DEPARTAMENTAL DE TRÁNSITO`
 * a distancia 1 (`RECCION` → `SECCION`), y con eso una licencia de conducir
 * boliviana sintética alcanzaba una cobertura de 0,623: MÁS que la cédula real
 * fotografiada. Un rótulo corto no tiene material suficiente para que una
 * edición signifique algo — en siete caracteres, una edición es la séptima parte
 * de la palabra.
 *
 * Los rótulos por debajo de ocho siguen en el catálogo y siguen contando: lo que
 * pierden es la tolerancia, no la comprobación. `SEGIP`, `SERIE` y `SECCIÓN` se
 * buscan exactos, que es lo apropiado para una sigla y para dos palabras que no
 * admiten variante.
 */
const LONGITUD_MINIMA = 8;

/** Una edición admitida por cada cinco caracteres del rótulo. */
const CARACTERES_POR_EDICION = 5;

/**
 * Pliega un texto para cotejarlo: mayúsculas, sin diacríticos y sólo letras y
 * dígitos.
 *
 * Se aplica IGUAL a los dos lados —al rótulo del catálogo y al texto del OCR—,
 * que es lo que hace que plegar no pueda inventar una coincidencia: si los dos
 * pierden sus espacios, comparar sin espacios sigue comparando lo mismo.
 */
export function plegarParaCotejo(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '');
}

/**
 * Cuántas ediciones se le toleran a un rótulo de esta longitud.
 *
 * Expuesto para que quien lea un caso pueda explicar por qué un anclaje se dio
 * por encontrado, que es la mitad de para qué sirve una medida de conformidad.
 */
export function toleranciaDe(rotulo: string): number {
  return Math.floor(plegarParaCotejo(rotulo).length / CARACTERES_POR_EDICION);
}

/**
 * Distancia de edición mínima entre `aguja` y CUALQUIER subcadena de `pajar`.
 *
 * Es la distancia de Levenshtein con el comienzo y el final libres: la fila
 * inicial vale cero en toda su longitud (empezar en cualquier posición del pajar
 * es gratis) y la respuesta es el mínimo de la última columna (terminar en
 * cualquier posición también). `tope` corta el cálculo en cuanto la fila entera
 * se pasa, que es lo que impide que cotejar veinte rótulos contra un texto largo
 * cueste veinte recorridos completos.
 */
function distanciaEnSubcadena(pajar: string, aguja: string, tope: number): number {
  if (aguja.length === 0) return 0;
  if (pajar.length === 0) return aguja.length;

  let previa = Array.from({ length: aguja.length + 1 }, (_, indice) => indice);
  let mejor = previa[aguja.length] ?? aguja.length;

  for (let i = 0; i < pajar.length; i += 1) {
    const actual = new Array<number>(aguja.length + 1);
    // Comenzar aquí no cuesta nada: es lo que convierte la distancia entre dos
    // cadenas en una búsqueda de la subcadena más parecida.
    actual[0] = 0;
    let minimoDeLaFila = 0;
    for (let j = 1; j <= aguja.length; j += 1) {
      const sustitucion = (previa[j - 1] ?? 0) + (pajar[i] === aguja[j - 1] ? 0 : 1);
      const borrado = (previa[j] ?? 0) + 1;
      const insercion = (actual[j - 1] ?? 0) + 1;
      const valor = Math.min(sustitucion, borrado, insercion);
      actual[j] = valor;
      if (valor < minimoDeLaFila) minimoDeLaFila = valor;
    }
    const final = actual[aguja.length] ?? aguja.length;
    if (final < mejor) mejor = final;
    if (mejor === 0) return 0;
    // La fila entera por encima del tope: ninguna continuación puede bajar de
    // ahí, porque cada paso siguiente sólo suma.
    if (minimoDeLaFila > tope && mejor > tope) return mejor;
    previa = actual;
  }
  return mejor;
}

/**
 * ¿Aparece `rotulo` en `textoPlegado`, admitiéndole al OCR sus erratas?
 *
 * `textoPlegado` tiene que venir YA plegado por `plegarParaCotejo`: quien cotea
 * veinte rótulos contra el mismo texto lo pliega una vez, no veinte.
 */
export function contieneAproximado(textoPlegado: string, rotulo: string): boolean {
  const aguja = plegarParaCotejo(rotulo);
  if (aguja.length < LONGITUD_MINIMA) return false;
  const tolerancia = Math.floor(aguja.length / CARACTERES_POR_EDICION);
  return distanciaEnSubcadena(textoPlegado, aguja, tolerancia) <= tolerancia;
}

/**
 * ¿Alguna de las grafías aparece en el texto? Devuelve la que casó, para que la
 * traza del caso pueda decir POR QUÉ se dio un anclaje por encontrado.
 *
 * Las grafías de un anclaje son alternativas y no sinónimos: `CEDULA DE
 * IDENTIDAD` y `IDENTIDAD` describen el mismo rótulo impreso, y la segunda
 * existe porque el reconocedor parte el rótulo largo con frecuencia. Basta una.
 */
export function casarGrafias(textoPlegado: string, grafias: readonly string[]): string | null {
  for (const grafia of grafias) {
    if (contieneAproximado(textoPlegado, grafia)) return grafia;
  }
  return null;
}
