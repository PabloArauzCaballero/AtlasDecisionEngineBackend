/**
 * Construcción de una cadena que SATISFACE un `pattern` del contrato (§10.3).
 *
 * El generador guiado por contrato ignoraba `pattern`: rellenaba con letras al azar y
 * devolvía como VÁLIDO un valor que el motor de restricciones rechazaba acto seguido. Un
 * banco de pruebas que se contradice a sí mismo no se mira dos veces, así que aquí el
 * patrón se lee y se produce una cadena que casa con él.
 *
 * ## Por qué un intérprete propio y no una librería
 *
 * `randexp` y equivalentes son dependencias de PRODUCCIÓN que ejecutarían un patrón
 * escrito por el autor del contrato, y su algoritmo puede cambiar entre versiones
 * menores: una corrida archivada dejaría de reproducirse. Aquí el subconjunto soportado
 * está congelado en el repositorio, versionado con `GENERATOR_VERSION`, y consume el
 * mismo flujo determinista que el resto del generador.
 *
 * ## Subconjunto soportado
 *
 * Literales, `.`, clases `[a-z0-9]` (con negación y rangos), `\d \w \s` y sus negados,
 * grupos `( … )` y `(?: … )`, alternancia `|`, cuantificadores `* + ? {n} {n,} {n,m}` y
 * anclas `^ $`. Lo demás —retrorreferencias, lookaround, `\u`, propiedades Unicode— NO
 * se soporta: se devuelve `null` y quien llama decide qué hacer. Fallar declarándolo es
 * la única opción honesta; inventar una cadena que no casa es lo que ya hacía antes.
 *
 * Toda cadena producida se COMPRUEBA contra el patrón real antes de devolverse, de modo
 * que un fallo del intérprete nunca puede escaparse como valor válido.
 */
export { sampleForPattern } from './sample';
