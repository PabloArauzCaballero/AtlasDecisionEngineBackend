import { IdentityDocumentType } from '../../domain/identity-enums';

/** El tipo de documento al que se refiere todo este catálogo. */
export const TIPO_CATALOGADO = IdentityDocumentType.BOLIVIA_CI;

/**
 * De dónde sale cada dato de este archivo.
 *
 * Están aquí y no en un `docs/` aparte a propósito: quien vaya a mover un peso o
 * a añadir un anclaje tiene que poder comprobar la fuente sin salir del archivo,
 * porque la tentación de «ajustar hasta que pase el caso que me trajo» es
 * exactamente lo que convierte un catálogo en una superstición.
 */
export const FUENTES: ReadonlyArray<{ readonly que: string; readonly donde: string }> = [
  {
    que: 'Rótulos impresos, medidas, material, campos del anverso y del reverso, vigencias e historia de versiones (2011, DS 4342 de 2020, DS 4861 y DS 4924 de 2023).',
    donde: 'https://es.wikipedia.org/wiki/C%C3%A9dula_de_identidad_(Bolivia)',
  },
  {
    que: 'Medidas de seguridad del rediseño de 2023: MRZ, código QR, microimpresiones, guilloché tricolor, fotografía sin fondo blanco, firma y huella digitalizadas.',
    donde:
      'https://www.reduno.com.bo/noticias/gobierno-presenta-la-nueva-cedula-de-identidad-y-asi-se-ve-202311195818',
  },
  {
    que: 'Competencia del SEGIP sobre el Registro Único de Identificación y la emisión de la cédula.',
    donde: 'https://www.segip.gob.bo/',
  },
  {
    que: 'Complemento alfanumérico del número de cédula: por qué existe y qué forma tiene.',
    donde: 'https://boliviaimpuestos.com/complemento-del-carnet-de-identidad/',
  },
  {
    que: 'Estructura de la MRZ TD1 de tres renglones de 30 caracteres y sus dígitos de control.',
    donde: 'ICAO Doc 9303, parte 5 — implementada en core/parsers/mrz-td1.ts',
  },
];
