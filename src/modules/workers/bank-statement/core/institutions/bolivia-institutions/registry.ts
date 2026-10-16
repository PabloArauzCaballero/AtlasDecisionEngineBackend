import {
  BANCOS_MULTIPLES,
  BANCOS_PYME,
  ENTIDADES_DEL_ESTADO,
  ENTIDADES_DE_VIVIENDA,
} from './banks';
import { COOPERATIVAS } from './cooperatives';
import { ENTIDADES_SIN_LICENCIA, INSTITUCIONES_DE_DESARROLLO } from './development-and-unlicensed';
import { BoliviaInstitution } from './types';

/** El padrón completo, en el orden en que ASFI publica su nómina. */
export const BOLIVIA_INSTITUTIONS: readonly BoliviaInstitution[] = [
  ...BANCOS_MULTIPLES,
  ...BANCOS_PYME,
  ...ENTIDADES_DEL_ESTADO,
  ...ENTIDADES_DE_VIVIENDA,
  ...COOPERATIVAS,
  ...INSTITUCIONES_DE_DESARROLLO,
  ...ENTIDADES_SIN_LICENCIA,
];

/**
 * Cuántos marcadores de la entidad coinciden con el texto, y 0 si una exclusión
 * la desmiente.
 *
 * Contar en lugar de responder sí/no es lo que permite desempatar entre dos
 * entidades cuyos marcadores coinciden a la vez: gana la que aporta más
 * evidencia, no la que aparece antes en el padrón.
 */
export function countMarkerHits(institution: BoliviaInstitution, text: string): number {
  if (institution.exclusions?.some((exclusion) => exclusion.test(text))) return 0;
  return institution.markers.filter((marker) => marker.test(text)).length;
}
