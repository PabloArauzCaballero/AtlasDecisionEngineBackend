/**
 * ¿Se parece esto a una cédula boliviana DE VERDAD?
 *
 * `identity-evidence.ts` contesta una pregunta anterior —«¿hay un documento de
 * identidad delante?»— y la contesta con seis señales genéricas que cumple casi
 * cualquier documento oficial del mundo. Este archivo contesta la siguiente, que
 * es la que separa el fraude: dado que hay una cédula boliviana delante, ¿tiene
 * la plantilla COMPLETA de alguna de las dos generaciones que el SEGIP emite?
 *
 * ## Por qué se mide contra la mejor generación y no contra las dos a la vez
 *
 * Porque las dos plantillas son distintas y una cédula legítima de 2021 no lleva
 * MRZ. Promediar las dos conformidades castigaría a todas las cédulas anteriores
 * a noviembre de 2023 por no tener algo que su generación no imprime, y esos son
 * millones de documentos perfectamente válidos. Un falso positivo aquí le cierra
 * el producto a alguien que no hizo nada mal, y —a diferencia de una foto
 * movida— no tiene forma de arreglarlo repitiendo la captura.
 *
 * ## Qué NO hace este archivo
 *
 * No decide. Devuelve una medida y una lista de lo que faltó, y quien decide es
 * `identity-fraud.scorer.ts` con los umbrales del despliegue. Es la misma
 * separación que ya existe entre `identity-evidence` y `identity-triage`, y por
 * el mismo motivo: recalibrar no puede obligar a tocar las señales.
 */
export { analizarPlantilla, LADO_LARGO_MINIMO_LEGIBLE } from './analyze';
export type {
  AnalisisDePlantilla,
  ConformidadDePlantilla,
  EntradaDePlantilla,
  IncoherenciaEstructural,
  ObservacionEstructural,
} from './types';
