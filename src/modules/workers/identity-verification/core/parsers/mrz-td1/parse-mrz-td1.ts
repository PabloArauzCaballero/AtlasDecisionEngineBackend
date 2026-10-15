/**
 * Zona de lectura mecánica (MRZ) de una tarjeta TD1, según ICAO 9303 parte 5.
 *
 * Es el reverso de la cédula boliviana vigente: tres renglones de 30 caracteres
 * en OCR-B. Y es, de lejos, **la fuente más fiable del documento**: está pensada
 * para que la lea una máquina, no una persona, y trae DÍGITOS DE CONTROL que
 * permiten saber si se leyó bien en vez de suponerlo.
 *
 * Esa comprobación es la razón de que exista este módulo. Un OCR sobre el
 * anverso puede confundir un 5 con un 6 y nadie se entera: el número resultante
 * parece igual de válido. Aquí, si el dígito de control no cuadra, el campo se
 * descarta —vale más no saber el número que saberlo mal cuando lo que se decide
 * es la identidad de alguien—.
 *
 *   L1  ID BOL 8942507<< 9 <<<<<<<<<<<<<<<
 *       │  │   │        │
 *       │  │   │        └ dígito de control del número
 *       │  │   └ número de documento (9)
 *       │  └ estado emisor (3)
 *       └ tipo de documento (2)
 *
 *   L2  030405 3 F 280612 5 BOL <<<<<<<<<<< 0
 *       │      │ │ │      │ │                │
 *       │      │ │ │      │ │                └ control compuesto
 *       │      │ │ │      │ └ nacionalidad
 *       │      │ │ │      └ control de la caducidad
 *       │      │ │ └ caducidad (AAMMDD)
 *       │      │ └ sexo
 *       │      └ control del nacimiento
 *       └ nacimiento (AAMMDD)
 *
 *   L3  RODRIGUEZ<GONZALEZ<<MARIA<RENEE<<<<
 *       └ apellidos << nombres
 */

import { candidateLines } from './candidate-lines';
import { interpretar } from './interpret-lines';
import { cabeceraPlausible, variantes } from './line-variants';
import type { MrzTd1 } from './mrz-types';

/**
 * Extrae la MRZ de un texto de OCR y la interpreta.
 *
 * Devuelve `null` cuando no hay tres renglones que parezcan una TD1: eso NO es
 * un error, es una cédula del formato anterior o una foto sólo del anverso.
 */
export function parseMrzTd1(rawText: string): MrzTd1 | null {
  const lineas = candidateLines(rawText);
  if (lineas.length < 3) return null;

  const [l1, l2, l3] = lineas as [string, string, string];

  /*
   * Cada renglón se prueba TAL CUAL y también SIN su primer carácter, y ganan
   * los dígitos de control.
   *
   * Es la tolerancia al corrimiento: el reconocedor mete un glifo espurio
   * delante del renglón —el borde de la tarjeta, una sombra— y TODA la línea se
   * corre una posición. Medido sobre una cédula real: la nacionalidad salía
   * «5BO» (el control de la caducidad, corrido al hueco de la nacionalidad),
   * los apellidos «EARAUZ», y las dos fechas se descartaban con sus controles.
   * Quitar el primer carácter realinea el renglón entero, y si la variante
   * fuera incorrecta ningún control cuadraría: elegir la que más controles
   * valida no puede inventar un dato, sólo recuperar el que se demuestra.
   */
  /*
   * Las alineaciones con CABECERA VÁLIDA se prueban primero y, si hay alguna,
   * ninguna otra compite.
   *
   * La norma fija el arranque del primer renglón: el tipo de documento es `A`,
   * `C` o `I`, y el estado emisor son tres letras. Una alineación que no lo
   * cumple no es «una lectura peor»: es la MRZ leída desde el sitio equivocado,
   * y todo lo que se calcule sobre ella —incluido el control compuesto— está
   * calculado sobre posiciones que no son las suyas.
   *
   * Sin esta preferencia, un control compuesto acertado POR AZAR —un dígito,
   * una posibilidad entre diez— hacía ganar a una alineación corrida. Medido
   * sobre la MRZ sintética de las pruebas: el estado emisor salía `OLI` y el
   * dígito de control del número caía sobre un relleno. Dos campos publicados
   * mal por una coincidencia aritmética.
   *
   * Cuando NINGUNA variante tiene cabecera válida —el reconocedor se comió el
   * tipo de documento, que pasa— se prueban todas, que es lo que se hacía antes.
   */
  const variantesL1 = variantes(l1);
  const conCabecera = variantesL1.filter((variante) => cabeceraPlausible(variante.linea));
  const candidatasL1 = conCabecera.length > 0 ? conCabecera : variantesL1;

  let mejor: MrzTd1 | null = null;
  let mejorPuntos = -1;
  for (const v1 of candidatasL1) {
    for (const v2 of variantes(l2)) {
      // El tercer renglón no lleva ningún control: no hay con qué elegir entre
      // sus variantes, así que se toma tal cual. Un espurio delante del nombre
      // no se puede demostrar — y un nombre «corregido» sin prueba sería un
      // dato inventado.
      const leida = interpretar(
        v1.linea,
        v2.linea,
        variantes(l3)[0]?.linea ?? l3,
        v1.completa && v2.completa,
      );
      /*
       * Una variante ARRIESGADA sólo se acepta si cuadra el control COMPUESTO.
       *
       * Quitar un carácter de en medio genera treinta variantes por renglón, y
       * con tantas alguna acaba cuadrando un control de un solo dígito por puro
       * azar —una de cada diez—. Ese acierto casual entregaría un número de
       * documento inventado con el sello de «validado», que es exactamente lo
       * que este analizador existe para no hacer.
       *
       * El compuesto se calcula sobre los DOS renglones enteros: acertarlo por
       * casualidad es mucho más difícil, y acertarlo a la vez que el número lo
       * es todavía más. Las variantes de siempre —tal cual y sin el primer
       * carácter— no pasan por aquí: ésas ya estaban demostradas.
       */
      if ((v1.arriesgada || v2.arriesgada) && leida.checks.composite !== true) continue;
      const puntos =
        Number(leida.checks.documentNumber === true) +
        Number(leida.checks.birthDate === true) +
        Number(leida.checks.expirationDate === true) +
        // El compuesto pesa doble: valida los dos renglones enteros, no un campo.
        2 * Number(leida.checks.composite === true) +
        /*
         * Y a igualdad de controles, gana la alineación con FORMA de TD1.
         *
         * Pesa menos que cualquier control —una décima— porque es una pista
         * estructural y no una demostración: no puede darle la vuelta a un
         * dígito que cuadra. Lo que sí hace es desempatar, que es donde hacía
         * falta. Con varios arranques posibles, dos de ellos pueden validar los
         * mismos cero controles y quedarse con el primero era quedarse con el
         * renglón sin recortar; ahora gana el que empieza por el tipo de
         * documento y el emisor, que es de donde salen la nacionalidad y el
         * estado emisor —dos campos que ningún dígito de control cubre—.
         */
        0.1 * Number(cabeceraPlausible(v1.linea)) +
        /*
         * Y, por debajo de todo, que el control se pueda COMPROBAR.
         *
         * Vale cinco centésimas: nunca le gana a un control que cuadra, y
         * desempata entre dos alineaciones igual de buenas a favor de la que
         * deja los dígitos de control sobre dígitos en vez de sobre el relleno.
         * Una alineación que pierde el control no es más segura por no poder
         * fallarlo.
         */
        0.05 *
          (Number(leida.checks.documentNumber !== null) +
            Number(leida.checks.birthDate !== null) +
            Number(leida.checks.expirationDate !== null) +
            Number(leida.checks.composite !== null));
      if (puntos > mejorPuntos) {
        mejor = leida;
        mejorPuntos = puntos;
      }
    }
  }
  return mejor;
}
