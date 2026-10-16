import { BoliviaInstitution } from './types';

/** Prefijo común de las cooperativas: el nombre entrecomillado es lo distintivo. */
const COOPERATIVA = String.raw`COOPERATIVA[\s\S]{0,80}?`;

/**
 * Arma la entrada de una cooperativa a partir de lo único que la distingue.
 *
 * Se hace con un ayudante y no escribiendo 41 objetos iguales porque lo que hay
 * que poder revisar de un vistazo es el nombre y su patrón; el resto —el tipo,
 * la licencia, el prefijo del marcador— es idéntico en las 41 y repetirlo sólo
 * daría sitio a que una se desviara sin que nadie lo notara.
 */
export function cooperativa(code: string, name: string, distinctive: string): BoliviaInstitution {
  return {
    code,
    name,
    kind: 'COOPERATIVE',
    licenseStatus: 'LICENSED',
    retailDeposits: true,
    markers: [new RegExp(COOPERATIVA + distinctive, 'i')],
  };
}

/** Igual, para las ocho instituciones financieras de desarrollo. */
export function ifd(code: string, name: string, distinctive: string): BoliviaInstitution {
  return {
    code,
    name,
    kind: 'DEVELOPMENT_IFD',
    licenseStatus: 'LICENSED',
    // Prestan; no captan depósitos del público. Sus estados de cuenta son de
    // crédito, no de una cuenta de ahorro.
    retailDeposits: false,
    markers: [new RegExp(distinctive, 'i')],
  };
}
