/**
 * CATÁLOGO DE LA CÉDULA DE IDENTIDAD BOLIVIANA.
 *
 * ## Qué es este archivo, y por qué no es una lista de expresiones regulares más
 *
 * Hasta ahora el worker sabía RECONOCER una cédula —`identity-evidence.ts` mide
 * si hay un documento de identidad delante— pero no sabía cómo **debería verse**
 * la cédula boliviana concreta. La diferencia importa exactamente donde importa
 * el fraude: una falsificación casera contiene la palabra «CÉDULA DE IDENTIDAD»,
 * lleva una foto y tiene la proporción de una tarjeta, así que supera con
 * holgura la puerta de evidencia. Lo que NO tiene es la plantilla completa: le
 * faltan rótulos, la MRZ no cuadra sus dígitos de control, el número no respeta
 * el formato del SEGIP, las fechas no son coherentes entre sí y el lugar de
 * expedición no existe.
 *
 * Este catálogo es esa plantilla, escrita como dato y no como código, para que
 * la conformidad se pueda MEDIR campo a campo y para que quien revise un caso
 * pueda leer qué faltaba. Es la referencia contra la que trabajan
 * `core/forensics/*`.
 *
 * ## De dónde salen los datos
 *
 * De fuentes públicas, y están anotadas una a una en `FUENTES`. **No hay ni una
 * sola imagen de una cédula real en este repositorio, ni la habrá**: una cédula
 * de verdad es el dato con el que se suplanta a una persona, y guardar ejemplos
 * «para calibrar» es fabricar exactamente la fuga que este worker existe para
 * prevenir. Lo que se cataloga es la ESPECIFICACIÓN —qué rótulos lleva, en qué
 * orden, con qué formato— que es información pública publicada por el propio
 * emisor, y los ejemplares sintéticos de `fixtures/identity-card.ts`, dibujados
 * por nosotros contra esta misma especificación.
 *
 * ## Las dos generaciones conviven, y las dos son válidas
 *
 * El DS 4924 (1 de noviembre de 2023) rediseñó la tarjeta entera y le añadió
 * MRZ. Las cédulas emitidas antes siguen vigentes hasta su caducidad, así que
 * durante años se van a presentar las dos. Exigir la plantilla nueva a una
 * cédula legítima de 2021 la rechazaría por falsa, que es el peor error posible
 * de este módulo: el falso positivo le cierra el producto a alguien que no hizo
 * nada mal y no tiene forma de arreglarlo.
 *
 * Por eso la conformidad se mide contra CADA generación y se queda con la mejor:
 * un documento tiene que parecerse mucho a *alguna* cédula boliviana real, no a
 * la última.
 */
export {
  DEPARTAMENTOS_DE_EXPEDICION,
  NOMBRES_DE_DEPARTAMENTO,
  NUMERO_CEDULA,
  esNumeroDeCedulaValido,
} from './document-number';
export { MARCAS_DE_FALSIFICACION, SONDAS_BOLIVIA_CI } from './probes';
export type { SondaDeCatalogo } from './probes';
export { FUENTES, TIPO_CATALOGADO } from './sources';
export { PLANTILLAS, PLANTILLA_DS_4924_2023, PLANTILLA_PRE_2023 } from './templates';
export { BoliviaCiGeneration } from './types';
export type { AnclajeDeCatalogo, PlantillaDeCedula } from './types';
