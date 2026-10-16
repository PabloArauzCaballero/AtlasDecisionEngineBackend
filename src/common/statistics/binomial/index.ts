/**
 * Intervalos binomiales: cuánto se puede AFIRMAR a partir de lo que se midió.
 *
 * ## Por qué esto vive en `common/` y no dentro de un worker
 *
 * Porque los dos workers que miran documentos de una persona tienen el mismo
 * problema y lo tenían resuelto de la misma manera: no resolviéndolo. «El
 * clasificador acierta el 81 %» sobre 21 casos, «cero falsos positivos» sobre un
 * puñado de documentos, «el umbral es 0,8824». Las tres frases suenan a
 * medición y ninguna lo es, porque a ninguna la acompaña un denominador ni un
 * intervalo.
 *
 * Con 21 casos y 17 aciertos, el intervalo de Wilson al 95 % va de **0,60 a
 * 0,92**. Ese es el verdadero contenido de «81 %»: puede ser un clasificador
 * excelente o uno mediocre, y los datos no distinguen. Publicar el 81 % solo no
 * es optimismo, es una afirmación que los datos no sostienen.
 *
 * ## De dónde salen las fórmulas
 *
 * Del manual del NIST (Dataplot, *Exact Binomial Confidence Limits* y los
 * límites de Wilson/Agresti-Coull), que es lo que el corpus de identidad cita
 * como fuente OFICIAL. Las cifras que este archivo produce se comprueban contra
 * las tablas que el propio corpus trae calculadas: si una implementación se
 * desvía, la prueba lo dice.
 *
 * ## Qué NO hacen estos intervalos
 *
 * No arreglan una muestra sesgada. Un intervalo describe la incertidumbre de un
 * MUESTREO aleatorio de ensayos independientes; si los 300 documentos vienen de
 * siete clientes, el intervalo que salga de aquí será demasiado estrecho y
 * ninguna fórmula lo va a saber. El corpus lo dice de otra manera: «miles de
 * movimientos de siete clientes no sustituyen miles de clientes». La unidad
 * independiente hay que elegirla antes de contar.
 */
export { betaQuantile, incompleteBeta, normalQuantile } from './distributions';
export type { ConfidenceInterval } from './distributions';
export {
  clopperPearson,
  describeInterval,
  recruitmentSize,
  ruleOfThree,
  sampleSizeForPrecision,
  trialsForZeroErrors,
  wilson,
  zeroErrorUpperBound,
} from './intervals';
