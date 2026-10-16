/** Lado largo de la imagen de trabajo normalizada, en píxeles. */
export const NORMALIZED_LONG_EDGE = 1800;
/** Lado largo al que se remuestrea el recorte del rostro del documento. */
export const FACE_CROP_LONG_EDGE = 480;

/**
 * Cuánto puede diferir un píxel del color de la esquina y seguir contando como
 * fondo. El valor por omisión de `sharp` (10) casi nunca dispara sobre una foto
 * real: un escritorio no es de un solo tono exacto.
 */
export const TRIM_THRESHOLD = 28;

/**
 * A partir de cuántos píxeles la resolución deja de restar confianza.
 *
 * Era **un megapíxel**, y ese número no salía de ninguna medición. El efecto:
 * la resolución pesa 0,35 del puntaje, así que toda imagen por debajo de 1 MP
 * arrastraba una penalización proporcional, y con el mínimo en 0,5 eso bastaba
 * para rechazar de plano fotos que se leen enteras. Medido con
 * `scripts/medir-resolucion-identidad.ts`: la misma cédula a 450×289 —130 050
 * píxeles, la octava parte del ancla— entrega número, nombre y caducidad, y
 * termina VERIFICADA con parecido 0,8971. La fórmula la llamaba insuficiente
 * contra la evidencia de haberla leído.
 *
 * 300 000 son 2,3 veces el tamaño más pequeño en el que la lectura salió
 * COMPLETA, que es el margen que se le deja al ruido de una foto real frente a
 * una tarjeta dibujada. Por encima de VGA la resolución ya no es lo que limita,
 * y el puntaje debe decir eso.
 */
export const RESOLUCION_SUFICIENTE = 300_000;

/**
 * Mínimo del área original que debe sobrevivir al recorte. Por debajo, lo que
 * se recortó fue el documento y no el fondo — y perder el número de la cédula
 * es peor que leer con escritorio alrededor.
 */
export const MIN_AREA_TRAS_RECORTE = 0.25;
