/**
 * El fusor: de tres montones de señales a UN veredicto de fraude documental.
 *
 * ## Por qué hace falta un fusor y no basta con encadenar `if`
 *
 * Porque ninguna de las señales que llegan aquí es concluyente por su cuenta, y
 * encadenar condiciones convierte cada una en concluyente sin querer. Un muaré
 * es sospechoso y también lo produce una cédula plastificada bajo un
 * fluorescente. Un rótulo ausente es sospechoso y también lo produce un reflejo.
 * Una conformidad semántica baja es sospechosa y también la produce un OCR que
 * leyó media tarjeta. Cada una por separado NO justifica acusar a nadie de
 * falsificar un documento; tres a la vez, sí.
 *
 * Así que se suman con su peso y se cortan por dos umbrales, exactamente igual
 * que la puerta de documentos (`identity-triage.ts`): rechazar y preguntar no
 * son lo mismo, y hacen falta dos fronteras para poder distinguirlos.
 *
 * ## Las tres puertas
 *
 * - **`CLEAR`** — el documento se comporta como una cédula boliviana auténtica.
 * - **`REVIEW`** — hay algo, y lo que hay no basta. Va a una persona, con la
 *   lista de qué señales saltaron. Es el desenlace por omisión de todo lo que
 *   este archivo no sepa clasificar: la duda NUNCA se resuelve aprobando.
 * - **`FRAUD_SUSPECTED`** — la evidencia se acumuló por encima del umbral alto.
 *   Sigue sin ser una acusación firmada por una máquina: el artefacto decide qué
 *   hacer con ella, y hoy decide mandarla a revisión humana marcada. Lo que este
 *   veredicto garantiza es que **no puede terminar en aprobación automática**.
 *
 * ## La prueba que FALTA no es una prueba superada
 *
 * Es la regla que gobierna el modo estricto. Si el servidor de embeddings no
 * contestó, o si el análisis de píxeles no pudo correr, el documento no queda
 * «sin señales negativas»: queda SIN MEDIR. En un despliegue de producción eso
 * escala a revisión humana, porque la alternativa —aprobar lo que no se pudo
 * comprobar— convierte una caída de un servicio auxiliar en una puerta abierta,
 * y es justo el fallo que un flujo de identidad no puede permitirse.
 */
export { evaluarFraude } from './evaluate';
export { UMBRALES_DE_FRAUDE_POR_DEFECTO } from './types';
export type { EvaluacionDeFraude, UmbralesDeFraude, VeredictoDeFraude } from './types';
