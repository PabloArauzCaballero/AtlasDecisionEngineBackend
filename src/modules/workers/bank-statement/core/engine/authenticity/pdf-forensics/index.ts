/**
 * Lo que el ARCHIVO dice de sí mismo, leído de sus bytes y no de su contenido.
 *
 * Las otras dos compuertas del worker preguntan por el contenido —«¿esto es un
 * estado de cuenta?», «¿quién lo emitió?»— y las dos se responden con el texto
 * que el PDF imprime. Ese texto lo escribe quien fabrica el archivo, así que las
 * dos se pueden satisfacer copiando la carátula de un banco en un documento de
 * Word: el clasificador suma 1.00, el detector de entidad atribuye el documento
 * al banco cuyo nombre se copió, y el motor convierte en movimientos una tabla
 * que escribió el solicitante.
 *
 * Esta compuerta pregunta otra cosa: **con qué se fabricó el archivo y si se
 * tocó después**. Es la única de las tres que no se puede contestar escribiendo
 * el texto correcto, porque no mira el texto. Mira el diccionario `/Info`, el
 * número de revisiones incrementales, las anotaciones superpuestas, el contenido
 * activo y la incrustación de fuentes — todo ello estructura del contenedor, que
 * el generador deja como rastro y que un editor de escritorio no puede borrar
 * sin reescribir el archivo entero (lo cual, a su vez, deja SU rastro).
 *
 * ## Qué NO es
 *
 * No es una verificación de firma digital. Un extracto boliviano no viene
 * firmado criptográficamente —ni ASFI lo exige ni los bancos lo emiten así—, de
 * modo que exigir una firma rechazaría el 100 % de los documentos legítimos. Lo
 * que hay aquí es evidencia circunstancial, ponderada y explicada, del mismo
 * tipo que usa un perito documental cuando no hay sello: quién dice el papel que
 * lo imprimió, si tiene tachaduras, si le añadieron una hoja después.
 *
 * ## Por qué la evidencia va PONDERADA y no en una lista de prohibiciones
 *
 * Porque las señales no valen lo mismo y varias son ambiguas por separado. Que
 * un PDF lo haya producido Chrome es normalísimo —media Bolivia imprime su banca
 * por internet con «Guardar como PDF»— y sería un rechazo absurdo; que lo haya
 * producido Photoshop no lo es en ningún escenario. Que un archivo tenga una
 * revisión incremental puede ser el propio banco añadiendo una página; que la
 * tenga ADEMÁS de haber pasado por un editor es otra cosa. Con una lista de
 * prohibiciones habría que elegir entre rechazar a los primeros o dejar pasar a
 * los últimos.
 */
export { assessProvenance } from './assess-provenance';
export { readPdfProvenance } from './read-provenance';
export type { ForensicAxis, ForensicReport, ForensicSignal, PdfProvenance } from './types';
