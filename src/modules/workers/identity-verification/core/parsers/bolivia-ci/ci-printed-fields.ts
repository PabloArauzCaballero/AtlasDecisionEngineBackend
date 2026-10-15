import { normalizeForMatch } from '../text-normalization';
import {
  BIRTH_ANCHOR,
  CADUCIDAD_INDEFINIDA,
  EMITIDA_ANCHOR,
  EXCLUSIONES,
  EXPIRA_ANCHOR,
  EXPIRY_ANCHOR,
  GRAFIAS_APELLIDOS,
  GRAFIAS_EMISION,
  GRAFIAS_EMITIDA_INLINE,
  GRAFIAS_EXPIRA_INLINE,
  GRAFIAS_EXPIRACION,
  GRAFIAS_LUGAR,
  GRAFIAS_NACIMIENTO,
  GRAFIAS_NOMBRES,
  LABEL_APELLIDOS,
  LABEL_EMISION,
  LABEL_EXPIRACION,
  LABEL_LUGAR,
  LABEL_NACIMIENTO,
  LABEL_NOMBRES,
} from './ci-anchors';
import { numeroDeDocumento } from './ci-document-number';
import { nombreAnclado, nombrePorVecindad } from './ci-name-readers';
import { lugarAnclado, lugarPorDepartamento } from './ci-place-readers';
import {
  anchored,
  anchoredTolerante,
  labelled,
  type Extraction,
  type SourceLine,
} from './ci-source-lines';

/** Lo que la tarjeta imprime, leído de las líneas del OCR sin contrastarlo con la MRZ. */
export interface CamposImpresos {
  documentNumber: Extraction | null;
  nombres: Extraction | null;
  apellidos: Extraction | null;
  fullName: Extraction | null;
  birth: Extraction | null;
  expiry: Extraction | null;
  issue: Extraction | null;
  placeOfBirth: Extraction | null;
  /** La tarjeta declara que NO caduca. */
  caducidadIndefinida: boolean;
}

/** Se buscan los anclajes de los DOS formatos y gana el que aparezca. */
export function leerCamposImpresos(lines: SourceLine[]): CamposImpresos {
  // Impreso: se buscan los anclajes de los DOS formatos y gana el que aparezca.
  const documentNumber = numeroDeDocumento(lines);
  const nombres = labelled(lines, LABEL_NOMBRES, GRAFIAS_NOMBRES);
  const apellidos = labelled(lines, LABEL_APELLIDOS, GRAFIAS_APELLIDOS);
  const fullName = nombreAnclado(lines) ?? nombrePorVecindad(lines);
  const birth =
    labelled(lines, LABEL_NACIMIENTO, GRAFIAS_NACIMIENTO, EXCLUSIONES.NACIMIENTO) ??
    anchored(lines, BIRTH_ANCHOR);
  const expiry =
    labelled(lines, LABEL_EXPIRACION, GRAFIAS_EXPIRACION, EXCLUSIONES.EXPIRACION) ??
    anchored(lines, EXPIRY_ANCHOR) ??
    /*
     * `Expira el <fecha>` — el rótulo del formato ANTERIOR, que no estaba.
     * Va el último de los tres porque es el más laxo: `EXPIRA` es una palabra
     * corriente y los dos anclajes de arriba nombran el campo sin ambigüedad.
     */
    anchored(lines, EXPIRA_ANCHOR) ??
    anchoredTolerante(lines, GRAFIAS_EXPIRA_INLINE);
  const issue =
    labelled(lines, LABEL_EMISION, GRAFIAS_EMISION, EXCLUSIONES.EMISION) ??
    anchored(lines, EMITIDA_ANCHOR) ??
    anchoredTolerante(lines, GRAFIAS_EMITIDA_INLINE);

  /*
   * ¿Dice la tarjeta que NO caduca?
   *
   * Se mira en el renglón de la caducidad y, si no hubo renglón, en el texto
   * entero: el formato anterior lo imprime como `Válida hasta el INDEFINIDO`
   * —dos renglones a veces— y el vigente como el valor del campo. Se comprueba
   * ANTES de intentar leer una fecha, porque el renglón del formato vigente
   * trae las dos fechas juntas y la regla «la caducidad es la última fecha del
   * renglón» devuelve la de EMISIÓN cuando la de caducidad no es una fecha.
   */
  const caducidadIndefinida = expiry
    ? CADUCIDAD_INDEFINIDA.test(normalizeForMatch(expiry.value))
    : lines.some((line) => CADUCIDAD_INDEFINIDA.test(line.normalized));
  const placeOfBirth =
    labelled(lines, LABEL_LUGAR, GRAFIAS_LUGAR) ??
    lugarAnclado(lines) ??
    lugarPorDepartamento(lines);

  return {
    documentNumber,
    nombres,
    apellidos,
    fullName,
    birth,
    expiry,
    issue,
    placeOfBirth,
    caducidadIndefinida,
  };
}
