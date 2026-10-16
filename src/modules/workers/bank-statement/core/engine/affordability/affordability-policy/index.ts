/**
 * Los números que gobiernan la evaluación, con la razón de cada uno.
 *
 * Están juntos y con nombre porque son lo primero que hay que recalibrar con
 * cartera real, y porque un umbral escondido dentro de una fórmula es un umbral
 * que nadie discute.
 *
 * ## Ninguno está calibrado, y eso ahora se publica
 *
 * La auditoría de parámetros del corpus revisó los ocho uno por uno y devolvió
 * lo mismo en los ocho: `calibrated_on_observed_arrears: false`,
 * `verified_replacement_value: null`, `measured_error_of_current_value: null`.
 * Es decir: son los valores que el encargo declaró, ninguno se ha medido contra
 * mora observada, y tampoco existe un valor verificado que deba sustituirlos.
 *
 * Varias de las justificaciones que este archivo tenía escritas **no se
 * sostienen**, y se corrigen abajo en su sitio. La más importante: ni la FCA
 * británica ni las guías de la EBA fijan un número —el corpus buscó y devolvió
 * `NO_UNIVERSAL_NUMERIC_RATIO_IDENTIFIED_IN_SOURCE`—, y el 15 % y el 35 % que
 * aquí se llamaban «práctica prudencial» no se verificaron como regla vigente en
 * Bolivia para este producto (huecos G08 y G15, contradicción C09).
 *
 * Que sigan en estos valores es correcto: el corpus entrega rejillas de
 * sensibilidad para medirlos y advierte, con esas palabras, que **una rejilla no
 * es una política**. Lo que cambia es que la evaluación ya no los presenta como
 * si alguien los hubiera medido — ver `AFFORDABILITY_PARAMETER_PROVENANCE`.
 */
export { DEFAULT_AFFORDABILITY_POLICY, normalizeAffordabilityPolicy } from './defaults';
export { AFFORDABILITY_CALIBRATION_STATUS, AFFORDABILITY_PARAMETER_PROVENANCE } from './provenance';
export type { PolicyParameterProvenance } from './provenance';
export type { AffordabilityPolicy } from './types';
