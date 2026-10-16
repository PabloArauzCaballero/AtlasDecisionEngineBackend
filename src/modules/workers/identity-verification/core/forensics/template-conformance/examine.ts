import type { ConformidadDePlantilla } from '../../catalog/bolivia-ci.recognizer';
import { revisarFechas } from './date-checks';
import { revisarNumeroYMrz } from './number-and-mrz-checks';
import { revisarLugarYNacionalidad } from './place-and-nationality-checks';
import type { Revision } from './revision';
import { revisarCapturaDePantalla } from './screen-capture-check';
import type { EntradaDePlantilla, IncoherenciaEstructural, ObservacionEstructural } from './types';

/**
 * Las incoherencias, que son la parte que un falsificador no puede arreglar
 * mirando la tarjeta.
 *
 * Un montaje se hace copiando una plantilla y escribiendo datos encima. Los
 * rótulos salen bien —están en la plantilla— y lo que sale mal es la ARITMÉTICA
 * entre los datos escritos: la MRZ dice un número y el anverso otro, la
 * caducidad cae antes del nacimiento, el documento dura veinte años, el sexo de
 * la MRZ no es ninguno de los tres que admite la norma. Nada de esto se ve
 * mirando; todo se comprueba calculando.
 *
 * Los pesos van de 0,15 a 0,45 y el criterio es cuánto puede explicarse por un
 * fallo del OCR: una fecha ilegible mal leída produce una incoherencia de fechas
 * con relativa facilidad, así que pesa menos; un número de MRZ cuyos dígitos de
 * control CUADRAN y que aun así discrepa del anverso no lo explica ningún fallo
 * de lectura, y pesa el máximo.
 */
export function examinar(
  entrada: EntradaDePlantilla,
  textoCompleto: string,
  conformidad: ConformidadDePlantilla,
): { incoherencias: IncoherenciaEstructural[]; observaciones: ObservacionEstructural[] } {
  const revision: Revision = { entrada, textoCompleto, conformidad, fallos: [], notas: [] };
  revisarNumeroYMrz(revision);
  revisarFechas(revision);
  revisarLugarYNacionalidad(revision);
  revisarCapturaDePantalla(revision);
  return { incoherencias: revision.fallos, observaciones: revision.notas };
}
