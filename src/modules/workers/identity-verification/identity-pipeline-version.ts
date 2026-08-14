/**
 * Versión del CANAL DE LECTURA Y DECISIÓN de identidad.
 *
 * Entra en la huella de idempotencia, y ésa es toda su razón de ser. Un
 * veredicto es función de tres cosas —las imágenes, la calibración y el código
 * que las lee—, y la huella cubría sólo las dos primeras: al arreglar el lector
 * de la MRZ, reenviar las mismas fotos bajo la misma calibración seguía
 * devolviendo el veredicto GUARDADO, hecho con el lector viejo. Desde fuera es
 * indistinguible de «el arreglo no sirvió», que es exactamente lo que pareció.
 *
 * **Súbela cuando cambie algo que altere lo que se lee o cómo se decide**: los
 * analizadores de `core/parsers/`, el motor de decisión, el recorte, la medida
 * de calidad o el orden del canal. No hace falta tocarla por un cambio de
 * registro, de nombres o de pruebas.
 *
 * Es una constante y no el hash del commit a propósito: el commit cambia con
 * cada línea del motor e invalidaría la caché de todas las verificaciones por
 * un cambio en otro worker —volviendo a pagar lecturas que nadie pidió—. Una
 * constante obliga a decidirlo, y esa decisión se revisa en el diff.
 *
 * Historial:
 *   1 — canal absorbido del paquete original.
 *   2 — 2026-08-13: la MRZ tolera glifos de ruido, dígitos de control leídos
 *       como letra y renglones CORRIDOS una posición (se prueban las dos
 *       alineaciones y eligen los dígitos de control). Recupera número, ambas
 *       fechas y el control compuesto en cédulas que antes salían sin campos.
 */
export const IDENTITY_PIPELINE_VERSION = 2;
