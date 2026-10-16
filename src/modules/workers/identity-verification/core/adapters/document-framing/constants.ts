/**
 * Lado largo al que se reduce la imagen para buscar la tarjeta.
 *
 * La pregunta —«¿qué parte de esta foto no es la mesa?»— se contesta con manchas
 * de color, no con detalle, así que pagar megapíxeles aquí sería tiempo regalado
 * en el camino caliente de cada verificación. A 320 px una cédula que ocupe la
 * décima parte del encuadre sigue midiendo cien píxeles de ancho.
 */
export const LADO_ANALISIS = 320;

/**
 * Suelo de la tolerancia de color, en distancia euclídea RGB sobre 0-255.
 *
 * Es un SUELO y no el valor: la tolerancia de verdad la fija cada foto (ver
 * `toleranciaDeFondo`). Existe para que una imagen de fondo perfectamente
 * uniforme —un escaneo— no acabe con una tolerancia de cero, donde el ruido de
 * compresión de un solo píxel ya contaría como documento.
 */
export const TOLERANCIA_MINIMA = 20;

/**
 * Percentil de las distancias del BORDE que marca dónde acaba el fondo.
 *
 * La tolerancia sale de la propia foto y no de una constante, y ésa es la
 * corrección que hace que esto funcione sobre papel cuadriculado. Con un umbral
 * fijo, medido sobre una cédula real fotografiada sobre cuadrícula: el 30 % de
 * los píxeles de la imagen quedaban por encima —las líneas de la cuadrícula, el
 * ruido de compresión y el sombreado de la hoja— y el perfil no separaba nada.
 * Con el percentil 85 de lo que hay EN EL BORDE, la cuadrícula queda dentro del
 * fondo por construcción: si el borde de la foto es cuadrícula, la cuadrícula es
 * fondo.
 *
 * 85 y no 95: por encima empieza a tragarse una esquina de la propia tarjeta
 * cuando el documento ya llena el encuadre, que es cuando no hay que recortar
 * nada y da igual, pero también cuando la tarjeta toca un borde, que sí importa.
 */
export const PERCENTIL_DE_FONDO = 0.85;

/**
 * Lado del bloque sobre el que se mide la densidad, en píxeles de análisis.
 *
 * **Es la pieza que separa una cédula de una cuadrícula**, y no el color.
 *
 * Contando píxeles sueltos, una hoja cuadriculada y una tarjeta impresa dan la
 * misma respuesta: las dos tienen píxeles que no son el fondo. Lo que las separa
 * es cómo están REPARTIDOS. Las líneas de una cuadrícula son finas y aisladas y
 * dejan un bloque de 8×8 al 10-15 %; el texto, el retrato y el guilloché de una
 * cédula dejan el mismo bloque al 50-90 %.
 *
 * Ocho píxeles sobre un lado de análisis de 320 es la vigésima parte del lado
 * corto de una tarjeta que llene el encuadre: fino para seguir el borde y grueso
 * para que una línea de un píxel no llene el bloque.
 */
export const LADO_DE_BLOQUE = 8;

/**
 * Qué parte de cada franja del borde se toma para estimar el fondo.
 *
 * Un veinteavo por lado. Más estrecho y una sombra pegada al marco decide sola;
 * más ancho y empieza a entrar la propia tarjeta cuando está bien encuadrada
 * —que es justo cuando este detector no debe recortar nada—.
 */
export const FRANJA_DE_BORDE = 0.05;

/**
 * Fracción del máximo del perfil por debajo de la cual un renglón de bloques
 * —o una columna— deja de ser tarjeta.
 *
 * Dentro de la tarjeta el perfil está cerca de su máximo y fuera cae a casi
 * cero, así que el corte no es delicado: cualquier valor entre un cuarto y la
 * mitad separa las dos poblaciones. 0,35 deja margen para la fila del borde
 * redondeado, que sí es tarjeta y tiene menos densidad que el centro.
 */
export const CORTE_DEL_PERFIL = 0.35;

/**
 * Proporciones admisibles del recorte, lado largo entre lado corto.
 *
 * Una tarjeta ID-1 mide 85,6 × 54 mm: proporción 1,585. El intervalo la rodea
 * con holgura para la perspectiva de una foto de móvil y para el margen que se
 * añade, y sirve para lo único que tiene que servir: si lo detectado tiene forma
 * de columna o de banda, no es una cédula y el recorte se descarta. Es barato y
 * evita el fallo caro —recortar el sitio equivocado y perder el número—.
 */
export const PROPORCION_MINIMA = 1.1;
export const PROPORCION_MAXIMA = 2.6;

/**
 * Margen que se deja alrededor de la caja detectada, en tanto por uno de su lado.
 *
 * La detección se queda corta por definición: el borde de la tarjeta es blanco y
 * el papel de debajo también, así que los últimos milímetros cuentan como fondo.
 * Un 2 % los devuelve, y perderlos importa: en la cédula vigente el número va
 * pegado al margen derecho y en la anterior el de control va pegado al inferior.
 */
export const MARGEN = 0.02;
