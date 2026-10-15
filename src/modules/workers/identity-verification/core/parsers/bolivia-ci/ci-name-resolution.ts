import type { MrzTd1 } from '../mrz-td1';
import { empiezaPor, mismoNombre } from './ci-name-comparison';
import { splitName } from './ci-name-readers';
import { pareceNombre } from './ci-noise-cleaning';
import type { Extraction } from './ci-source-lines';

/** Nombre y apellidos, por orden de fiabilidad decreciente. */
export function resolverNombre(
  mrz: MrzTd1 | null,
  nombres: Extraction | null,
  apellidos: Extraction | null,
  fullName: Extraction | null,
): {
  firstNames: string | null;
  lastNames: string | null;
  fullName: string | null;
  deMrz: boolean;
  heuristico: boolean;
  /** Se leyó el rótulo del nombre y lo que había debajo no era un nombre. */
  rotuloIlegible: boolean;
  /** Lo impreso y la MRZ nombran a personas distintas. */
  discrepaConMrz: boolean;
} {
  /*
   * Para el NOMBRE manda lo impreso, al revés que para el número y las fechas.
   *
   * No es una excepción caprichosa: el tercer renglón de la MRZ tiene treinta
   * caracteres contados, y cuando el nombre no cabe, la norma manda
   * TRUNCARLO. Medido con esta misma tarjeta: `RODRIGUEZ<GONZALEZ<<MARIA<RENE`
   * — la última «E» de «RENEÉ» no cabe y desaparece. Un dato con dígito de
   * control es más fiable que uno impreso sólo mientras el dato esté ENTERO;
   * en cuanto la MRZ lo recorta, el rótulo del anverso dice más.
   */
  /*
   * Lo impreso sólo manda si lo impreso PARECE UN NOMBRE.
   *
   * La regla de arriba —lo impreso gana a la MRZ— sigue siendo la correcta por
   * la truncatura de los treinta caracteres, pero daba por bueno lo que
   * hubiera bajo el rótulo pasara lo que pasara. Y el rótulo del nombre es
   * justo el que va PEGADO AL RETRATO: medido sobre una cédula real, el
   * reconocedor devuelve ahí `CMI`, `Priti`, `PrELLI` y renglones de letras
   * sueltas. Cuando uno de esos cae en la posición del valor, el expediente se
   * queda con un nombre inventado con toda la pinta de uno leído —que es
   * exactamente la peor clase de dato en una verificación de identidad— y
   * encima descarta la MRZ, que en esa misma foto trae el nombre entero y
   * limpio.
   *
   * `pareceNombre` es el filtro, y es deliberadamente flojo: letras, un mínimo
   * de tres, y ninguna cifra. No valida ortografía —un apellido puede ser
   * cualquier cosa— sólo descarta lo que no puede ser un nombre de persona.
   */
  const nombreImpreso = pareceNombre(nombres?.value) ? (nombres?.value ?? null) : null;
  const apellidoImpreso = pareceNombre(apellidos?.value) ? (apellidos?.value ?? null) : null;
  const hayRotuloIlegible =
    (nombres !== null && nombreImpreso === null) ||
    (apellidos !== null && apellidoImpreso === null);

  /*
   * Cada mitad se resuelve POR SEPARADO, y ésa es la corrección.
   *
   * Antes bastaba con que UNA de las dos mitades impresas pareciera un nombre
   * para quedarse con las dos y no volver a mirar la MRZ. La consecuencia,
   * medida sobre cédulas auténticas: el rótulo de los apellidos se leía y el de
   * los nombres no —o al revés—, y el expediente salía con media identidad
   * mientras la MRZ del reverso traía las dos mitades enteras y limpias.
   * Nombres y apellidos son dos campos y se leen de dos sitios distintos de la
   * tarjeta; que uno falle no dice nada del otro.
   */
  const resolverMitad = (
    impreso: string | null,
    deMrz: string | null,
  ): { valor: string | null; deMrz: boolean; discrepa: boolean } => {
    if (!impreso) return { valor: deMrz, deMrz: deMrz !== null, discrepa: false };
    if (!deMrz) return { valor: impreso, deMrz: false, discrepa: false };
    /*
     * Lo impreso gana SÓLO si es lo mismo o MÁS que la MRZ, nunca menos.
     *
     * La razón por la que lo impreso ganaba está en la truncatura: la MRZ
     * corta el tercer renglón a treinta caracteres por norma, así que sobre un
     * nombre largo lo impreso trae la cola que la MRZ recortó, y además trae
     * los diacríticos. Esa razón sólo se aplica cuando lo impreso CONTIENE lo
     * de la MRZ; si es más corto o le falta un trozo por el medio, la razón
     * juega al revés.
     *
     * La distinción hace falta porque `mismoNombre` tolera una edición —para
     * no acusar de documento compuesto a una cédula con una letra mal leída— y
     * sin ella esa tolerancia se volvía en contra: `.UISPE MAMANI` y `QUISPE
     * MAMANI` pasaban por el mismo nombre, y como lo impreso mandaba, el
     * expediente guardaba el apellido MUTILADO teniendo el entero al lado.
     */
    if (empiezaPor(impreso, deMrz)) return { valor: impreso, deMrz: false, discrepa: false };
    /*
     * Se parecen pero lo impreso no es lo más completo: gana la MRZ y no se
     * avisa, porque una edición de diferencia es una letra que el reconocedor
     * se comió y no dos personas distintas.
     */
    if (mismoNombre(impreso, deMrz)) return { valor: deMrz, deMrz: true, discrepa: false };
    /*
     * Y cuando NO coinciden gana la MRZ. Esto es lo contrario de lo que había,
     * y el motivo está medido sobre una cédula boliviana auténtica: el rótulo
     * del nombre es el que va PEGADO AL RETRATO, y el reconocedor le come
     * caracteres —`QUISPE MAMANI` volvió como `” .UISPE MAMANI`—
     * mientras la MRZ, que está impresa en OCR-B al pie del reverso y para ser
     * leída por una máquina, trae el mismo nombre entero.
     *
     * Quedarse con lo impreso guardaba en el expediente de identidad de una
     * persona un apellido que no es el suyo, teniendo el bueno delante. Y la
     * discrepancia NO se silencia: sigue levantando `NAME_MRZ_MISMATCH`, que
     * es la marca de documento compuesto. Lo que cambia es cuál de los dos
     * datos se guarda, no si se avisa.
     */
    return { valor: deMrz, deMrz: true, discrepa: true };
  };

  const primerosNombres = resolverMitad(nombreImpreso, mrz?.firstNames ?? null);
  const apellidosFinales = resolverMitad(apellidoImpreso, mrz?.lastNames ?? null);

  if (primerosNombres.valor || apellidosFinales.valor) {
    const completo =
      [primerosNombres.valor, apellidosFinales.valor].filter(Boolean).join(' ').trim() || null;
    return {
      firstNames: primerosNombres.valor,
      lastNames: apellidosFinales.valor,
      fullName: completo,
      deMrz: primerosNombres.deMrz || apellidosFinales.deMrz,
      heuristico: false,
      rotuloIlegible: hayRotuloIlegible,
      discrepaConMrz: primerosNombres.discrepa || apellidosFinales.discrepa,
    };
  }
  const partes = fullName ? splitName(fullName.value) : null;
  return {
    firstNames: partes?.firstNames ?? null,
    lastNames: partes?.lastNames ?? null,
    fullName: fullName?.value ?? null,
    deMrz: false,
    heuristico: Boolean(partes),
    rotuloIlegible: hayRotuloIlegible,
    discrepaConMrz: false,
  };
}
