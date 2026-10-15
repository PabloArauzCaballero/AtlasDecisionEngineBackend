import { distanciaDeEdicion } from './ci-name-comparison';

/**
 * Elige entre lo que dice la MRZ y lo que dice el texto impreso.
 *
 * `discrepa` sólo es cierto cuando las DOS fuentes tienen valor y no
 * coinciden: que falte una no es una contradicción, es una cara que no se
 * fotografió.
 */
export function preferir(
  deMrz: string | null,
  impreso: string | null,
): { valor: string | null; deMrz: boolean; discrepa: boolean } {
  /*
   * UNA cifra de diferencia no es una discrepancia: es una mala lectura.
   *
   * La marca `DOCUMENT_MRZ_MISMATCH` significa «el anverso y el reverso
   * pertenecen a documentos distintos», que es la firma de un montaje. Un
   * montaje no se equivoca en un dígito: copia una plantilla y escribe datos
   * que no cuadran con nada. Lo que sí se equivoca en un dígito es el
   * reconocedor sobre el texto impreso, y sobre una cédula boliviana auténtica
   * pasó: el anverso imprime `13/01/2031` y volvió `13/01/2034`, así que una
   * cédula legítima salía marcada como documento compuesto.
   *
   * La comparación es asimétrica a propósito. La MRZ trae dígitos de control
   * y ya se comprobaron —si no cuadraran, su campo sería `null` y no
   * llegaríamos aquí—; lo impreso sólo se puede leer y confiar. Así que cuando
   * las dos fuentes se parecen tanto que sólo pueden ser la misma, gana la que
   * puede demostrarse y no se avisa de nada. A partir de DOS caracteres de
   * diferencia el aviso vuelve, porque ahí ya no se explica por una errata.
   */
  const discrepa = Boolean(
    deMrz && impreso && deMrz !== impreso && distanciaDeEdicion(deMrz, impreso, 1) > 1,
  );
  if (deMrz) return { valor: deMrz, deMrz: true, discrepa };
  return { valor: impreso, deMrz: false, discrepa };
}
