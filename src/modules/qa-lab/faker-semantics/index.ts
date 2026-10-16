/**
 * Qué dato realista corresponde a cada variable del contrato, leído de su NOMBRE.
 *
 * El generador del contrato sabe respetar reglas —rango, longitud, patrón, enumeración— pero
 * no sabe qué ES una variable: para él `nombre_cliente` y `codigo_interno` son dos textos, y
 * los rellenaba con letras al azar («frocuzfzj»). Un caso así pasa las propiedades técnicas,
 * pero nadie que lo mire reconoce a una persona, y cualquier regla que dependa de la forma
 * del dato (un carnet de 7 dígitos, un celular que empieza por 6 o 7) no se ejercita nunca.
 *
 * Aquí se decide, por el nombre de la variable, qué campo de un faker del servidor mock le
 * corresponde (`caso` para persona, contacto, dirección, dispositivo, finanzas y cuenta;
 * `comercio` para los datos de un comercio). Lo que no se reconoce NO se toca: sigue saliendo
 * del generador del contrato. Y lo que se reconoce sólo se usa si el contrato lo acepta
 * (`fitToContract`): el faker aporta realismo, el contrato sigue mandando.
 */
export { fitToContract } from './fit-to-contract';
export { semanticRuleFor, tokensOf } from './registry';
export type { FakerRecord, FakerType, SemanticRule } from './types';
