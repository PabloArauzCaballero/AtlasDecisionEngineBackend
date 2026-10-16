import { AnclajeDeCatalogo } from './types';

export const NUMERO_IMPRESO: AnclajeDeCatalogo = {
  id: 'numero-de-cedula-impreso',
  cara: 'ANVERSO',
  // `N°` con las grafías que el reconocedor le da (`N*`, `N”`, `Nº`, `No`) y el
  // número con la forma del SEGIP. Es el dato más grande del anverso.
  patron: /\bN\s*[°º*"'”\u00B0]?\s*\.?\s*(?!0)\d{5,8}\b/u,
  grafias: [],
  peso: 0.06,
  obligatorio: false,
  descripcion: 'El número de cédula impreso en grande en el anverso, precedido de N°.',
};

export const PAR_DE_FECHAS: AnclajeDeCatalogo = {
  id: 'par-de-fechas-del-anverso',
  cara: 'ANVERSO',
  /*
   * DOS fechas y no una. Una sola la lleva cualquier recibo; el PAR —emisión y
   * expiración, impresas una al lado de la otra— es de la tarjeta. Y con la
   * fecha de nacimiento arriba, un anverso legible entrega tres.
   */
  patron: /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}\b[\s\S]{0,120}?\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}\b/u,
  grafias: [],
  peso: 0.05,
  obligatorio: false,
  descripcion: 'Las fechas del anverso: nacimiento, emisión y expiración en formato DD/MM/AAAA.',
};

export const DEPARTAMENTO_DE_NACIMIENTO: AnclajeDeCatalogo = {
  id: 'departamento-en-lugar-de-nacimiento',
  cara: 'REVERSO',
  /*
   * El lugar de nacimiento del reverso nombra un departamento de Bolivia, y va
   * en negro y a buen cuerpo. Es el anclaje del reverso que mejor sobrevive
   * cuando el rótulo `LUGAR DE NACIMIENTO` se pierde, que es lo habitual.
   *
   * El patrón se genera de `NOMBRES_DE_DEPARTAMENTO` más abajo; aquí queda la
   * alternancia literal para que el anclaje sea legible de un vistazo.
   */
  patron: /CHUQUISACA|LA\s+PAZ|COCHABAMBA|ORURO|POTOSI|TARIJA|SANTA\s+CRUZ|\bBENI\b|\bPANDO\b/u,
  grafias: ['CHUQUISACA', 'COCHABAMBA', 'POTOSI', 'TARIJA', 'SANTA CRUZ', 'ORURO'],
  peso: 0.05,
  obligatorio: false,
  descripcion: 'Un departamento de Bolivia nombrado en el lugar de nacimiento del reverso.',
};

/**
 * La MRZ, y el anclaje que MÁS pesa de todo el catálogo.
 *
 * Aquí sólo se comprueba que el renglón exista con la forma de una TD1. Que sus
 * dígitos de control CUADREN es una comprobación aparte y mucho más fuerte, y la
 * hace `parseMrzTd1` — este anclaje mide presencia, no validez.
 */
export const ZONA_MRZ: AnclajeDeCatalogo = {
  id: 'zona-mrz-td1',
  cara: 'REVERSO',
  patron: /(?:^|\n)\s*(?:I|ID)[A-Z<]{2,}[A-Z0-9<]{10,}/u,
  grafias: [],
  peso: 0.12,
  obligatorio: true,
  descripcion: 'La zona de lectura mecánica TD1 del reverso, obligatoria desde el DS 4924.',
};

/** El emisor declarado dentro de la MRZ. `BOL` es el código ISO 3166-1 de Bolivia. */
export const MRZ_EMISOR_BOL: AnclajeDeCatalogo = {
  id: 'mrz-emisor-bol',
  cara: 'REVERSO',
  patron: /(?:^|\n)\s*I?D?[A-Z<]{0,2}BOL/u,
  grafias: [],
  peso: 0.06,
  obligatorio: false,
  descripcion: 'El código de emisor BOL dentro de la MRZ.',
};
