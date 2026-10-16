export interface FaceBoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageQuality {
  score: number;
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  sharpness: number | null;
  warnings: string[];
}

export interface NormalizedImage {
  buffer: Buffer;
  mimeType: 'image/jpeg';
  quality: ImageQuality;
}

export interface ImageNormalizerPort {
  normalize(input: Buffer): Promise<NormalizedImage>;
  assess(input: Buffer): Promise<ImageQuality>;
}

export interface FaceCropPort {
  crop(input: Buffer, box: FaceBoundingBox): Promise<Buffer>;
}

export interface DocumentFraming {
  buffer: Buffer;
  /** Si se llegó a recortar algo, o la imagen salió tal cual entró. */
  recortado: boolean;
  /** Proporción del área que sobrevivió al recorte, en [0,1]. */
  areaConservada: number;
}

/**
 * Quita el fondo que rodea al documento antes de leerlo.
 *
 * Una foto de una cédula sobre un escritorio trae mesa, sombras y a veces otros
 * papeles. Todo eso entra al reconocedor: baja la precisión sobre el documento
 * y, en el peor caso, le da letras de otro sitio que confunden al clasificador.
 *
 * Es un puerto aparte y no un método más del normalizador porque es una
 * decisión distinta —qué parte de la imagen es el documento— y un despliegue
 * puede querer resolverla con un detector de bordes de verdad sin tocar el
 * remuestreo.
 */
export interface DocumentFramerPort {
  frame(input: Buffer): Promise<DocumentFraming>;
  /**
   * Gira la imagen un múltiplo de 90°.
   *
   * Existe porque el reconocedor de texto lee UNA orientación: la horizontal.
   * Quien fotografía su cédula con el móvil en vertical entrega una tarjeta
   * tumbada, y sobre ella Tesseract no devuelve nada aprovechable. Medido con la
   * cédula sintética de `fixtures/identity-card.ts`: derecha se lee entera y
   * clasifica como BOLIVIA_CI; girada 90° devuelve 403 caracteres de ruido y
   * CERO palabras reconocibles. El pipeline necesita poder probar las otras
   * orientaciones, y necesita el buffer girado —no sólo el texto— porque después
   * hay que recortar el retrato de esa misma imagen.
   */
  rotate(input: Buffer, degrees: 90 | 180 | 270): Promise<Buffer>;
  /**
   * Reduce la imagen a un lado largo dado, sin ampliarla nunca.
   *
   * Existe para las SONDAS: los intentos que sólo tienen que contestar «¿esto
   * clasifica?» y cuyo texto no se usa para rellenar ningún campo. El coste del
   * reconocedor crece con los píxeles y la pregunta de la sonda no los necesita
   * —el rótulo de una cédula es lo más grande que hay impreso en ella—, así que
   * pagarlos es tiempo que se le cobra a quien está esperando una respuesta.
   *
   * Medido sobre una foto de móvil que NO es un documento: 6516 ms a 1350x1800,
   * 1038 ms a 600x800. El mismo texto que decide la clasificación sobrevive: la
   * cédula sintética reducida a 1000 px de lado largo entrega las mismas señales
   * y la misma evidencia (0,75) que a tamaño completo.
   */
  downscale(input: Buffer, longEdge: number): Promise<Buffer>;
}

// --- Rostros ---------------------------------------------------------------
