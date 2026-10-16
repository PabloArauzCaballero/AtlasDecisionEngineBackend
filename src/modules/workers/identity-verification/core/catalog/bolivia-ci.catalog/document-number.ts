/**
 * El número de cédula boliviano, con su complemento opcional.
 *
 * **Esto es un BUSCADOR, no un validador**, y la distinción decide si se
 * rechaza a alguien. Sirve para elegir, entre los números que un OCR encuentra
 * en una tarjeta llena de cifras —el de control de impresión, el del código de
 * barras, una fecha pegada—, cuál parece el de la cédula. Para eso un patrón
 * estrecho es exactamente lo que hace falta.
 *
 * Lo que NO puede hacer es acusar. La gramática del SEGIP **no está
 * verificada**: el corpus de identidad la buscó y devolvió `exact_min_length:
 * null`, `exact_max_length: null` y `leading_zero_assignment_policy: null`, con
 * la instrucción de conservar los ceros y de no rechazar con una longitud que
 * nadie ha confirmado (hueco G04). Y sobre el complemento resolvió una
 * contradicción del encargo: el Servicio de Impuestos Nacionales lo publica como
 * **alfanumérico**, no como dos letras, así que imponer `[A-Z]{2}` descartaría
 * complementos legítimos (contradicción C02).
 *
 * Por eso `template-conformance.ts` ya no levanta una incoherencia cuando un
 * número no encaja aquí: lo anota como observación y sigue.
 *
 * La forma que este buscador usa:
 * - Entre cinco y ocho dígitos, que es lo observado en las cédulas reales de las
 *   que disponemos; no una regla del emisor.
 * - Sin cero a la izquierda, por la misma razón y con la misma reserva.
 * - Complemento opcional de uno o dos caracteres alfanuméricos tras un guion.
 */
export const NUMERO_CEDULA = /^(?!0)(\d{5,8})(?:-([0-9A-Z]{1,2}))?$/u;

/** ¿Este texto tiene la forma de un número de cédula boliviano? */
export function esNumeroDeCedulaValido(valor: string | null | undefined): boolean {
  if (!valor) return false;
  return NUMERO_CEDULA.test(valor.trim().toUpperCase());
}

/**
 * Los nueve departamentos, más la abreviatura CANDIDATA con la que cada uno
 * aparece junto al número —`1234567 SC`—.
 *
 * **Candidata, y la palabra importa.** El corpus fue a buscar la tabla oficial
 * del emisor (la RPT038 que la normativa referencia) y no la obtuvo:
 * `official_SEGIP_code_list_verified: false`, y los nueve códigos llegan
 * marcados uno a uno como `official_verified: false` (hueco G05). Su instrucción
 * es explícita: son candidatos para revisión, **no una lista oficial ni una
 * regla de rechazo**.
 *
 * Aquí decía lo contrario —«un lugar de expedición que no esté en esta lista es
 * un dato que el SEGIP no puede haber impreso»— y esa frase es la que convierte
 * una tabla reconstruida en un motivo para rechazar a una persona. Se usa para
 * RECONOCER lo que se leyó; lo que no se reconoce se queda sin reconocer.
 */
export const DEPARTAMENTOS_DE_EXPEDICION: Readonly<Record<string, string>> = {
  CH: 'Chuquisaca',
  LP: 'La Paz',
  CB: 'Cochabamba',
  OR: 'Oruro',
  PT: 'Potosí',
  TJ: 'Tarija',
  SC: 'Santa Cruz',
  BE: 'Beni',
  PD: 'Pando',
};

/** Nombres completos de departamento, plegados, para reconocerlos en el texto. */
export const NOMBRES_DE_DEPARTAMENTO: readonly string[] = [
  'CHUQUISACA',
  'LA PAZ',
  'COCHABAMBA',
  'ORURO',
  'POTOSI',
  'TARIJA',
  'SANTA CRUZ',
  'BENI',
  'PANDO',
];

/*
 * ── Sondas para el clasificador por transformers ───────────────────────────
 *
 * El clasificador semántico no busca palabras: proyecta el texto leído y estas
 * sondas al mismo espacio vectorial y mide el coseno. Por eso las sondas están
 * REDACTADAS como frases y no como listas de rótulos — un vector de una lista de
 * palabras sueltas no representa nada.
 *
 * Las NEGATIVAS son la mitad que hace el trabajo. Sin contraejemplos, el
 * clasificador contesta «se parece bastante» a cualquier documento oficial del
 * mundo, porque todos los documentos oficiales se parecen entre sí más de lo que
 * se parecen a un recibo. Con ellas, la pregunta pasa a ser la correcta: ¿se
 * parece MÁS a una cédula boliviana que a un DNI peruano, a una licencia de
 * conducir o a una plantilla descargada de internet?
 */
