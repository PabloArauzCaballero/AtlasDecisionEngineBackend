import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { identityErrors } from '../domain/identity-domain.error';
import { IDENTITY_OPTIONS, type IdentityOptions } from '../identity-options';
import type {
  DocumentFraming,
  DocumentFramerPort,
  FaceBoundingBox,
  FaceCropPort,
  ImageNormalizerPort,
  ImageQuality,
  NormalizedImage,
} from '../ports/identity.ports';

/**
 * Normalización, medida de calidad y recorte de rostro con `sharp`.
 *
 * Absorbido del paquete original; el único cambio es de dónde salen los
 * ajustes: recibe `IdentityOptions` en vez del `IdentityConfigService` propio
 * del paquete, que arrastraba consigo un esquema de entorno entero. La
 * aritmética —los pesos del puntaje, los umbrales de aviso, el borde del
 * recorte— no se ha tocado.
 */

/** Lado largo de la imagen de trabajo normalizada, en píxeles. */
const NORMALIZED_LONG_EDGE = 1800;
/** Lado largo al que se remuestrea el recorte del rostro del documento. */
const FACE_CROP_LONG_EDGE = 480;

/**
 * Cuánto puede diferir un píxel del color de la esquina y seguir contando como
 * fondo. El valor por omisión de `sharp` (10) casi nunca dispara sobre una foto
 * real: un escritorio no es de un solo tono exacto.
 */
const TRIM_THRESHOLD = 28;

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
const RESOLUCION_SUFICIENTE = 300_000;

/**
 * Mínimo del área original que debe sobrevivir al recorte. Por debajo, lo que
 * se recortó fue el documento y no el fondo — y perder el número de la cédula
 * es peor que leer con escritorio alrededor.
 */
const MIN_AREA_TRAS_RECORTE = 0.25;

@Injectable()
export class SharpImageAdapter implements ImageNormalizerPort, FaceCropPort, DocumentFramerPort {
  constructor(@Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions) {}

  async normalize(input: Buffer): Promise<NormalizedImage> {
    const quality = await this.assess(input);
    const buffer = await sharp(input, {
      limitInputPixels: this.options.maxImagePixels,
      failOn: 'warning',
    })
      .rotate()
      // Ampliar está permitido a propósito: una foto de móvil de 900x1600
      // dejada a su tamaño nativo da un recorte de rostro de unos 180x230 px,
      // justo en el límite de lo que un comparador acepta.
      .resize({
        width: NORMALIZED_LONG_EDGE,
        height: NORMALIZED_LONG_EDGE,
        fit: 'inside',
        withoutEnlargement: false,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    return { buffer, mimeType: 'image/jpeg', quality };
  }

  async assess(input: Buffer): Promise<ImageQuality> {
    const image = sharp(input, {
      limitInputPixels: this.options.maxImagePixels,
      failOn: 'warning',
    });
    const [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
    // La orientación EXIF 5-8 intercambia los ejes; se informan las dimensiones
    // con las que el pipeline va a trabajar de verdad, no las almacenadas.
    const swapAxes = typeof metadata.orientation === 'number' && metadata.orientation >= 5;
    const width = (swapAxes ? metadata.height : metadata.width) ?? 0;
    const height = (swapAxes ? metadata.width : metadata.height) ?? 0;
    const means = stats.channels.slice(0, 3).map((channel) => channel.mean / 255);
    const deviations = stats.channels.slice(0, 3).map((channel) => channel.stdev / 128);
    const brightness = means.length ? means.reduce((a, b) => a + b, 0) / means.length : 0;
    const contrast = deviations.length
      ? Math.min(1, deviations.reduce((a, b) => a + b, 0) / deviations.length)
      : 0;
    const sharpness = typeof stats.sharpness === 'number' ? stats.sharpness : null;

    const warnings: string[] = [];
    if (
      width < this.options.minImageWidth ||
      height < this.options.minImageHeight ||
      width * height < this.options.minImagePixels
    ) {
      warnings.push('LOW_RESOLUTION');
    }
    if (brightness < 0.12) warnings.push('UNDEREXPOSED');
    if (brightness > 0.92) warnings.push('OVEREXPOSED');
    if (contrast < 0.08) warnings.push('LOW_CONTRAST');
    if (sharpness !== null && sharpness < 1) warnings.push('POSSIBLE_BLUR');

    const resolutionScore = Math.min(1, (width * height) / RESOLUCION_SUFICIENTE);
    const exposureScore = 1 - Math.min(1, Math.abs(brightness - 0.5) * 1.7);
    const sharpnessScore = sharpness === null ? 0.7 : Math.min(1, sharpness / 5);
    const score = Math.max(
      0,
      Math.min(
        1,
        resolutionScore * 0.35 + exposureScore * 0.2 + contrast * 0.2 + sharpnessScore * 0.25,
      ),
    );
    return { score, width, height, brightness, contrast, sharpness, warnings };
  }

  /**
   * Quita el fondo que rodea al documento.
   *
   * `trim` de `sharp` recorta el borde uniforme a partir del color de las
   * esquinas: sobre una foto de una cédula encima de un escritorio, ese borde
   * ES el escritorio. Es lo que hay sin traerse un detector de bordes completo,
   * y tiene dos propiedades que lo hacen seguro:
   *
   * - Sobre un fondo movido o con textura no encuentra borde uniforme y devuelve
   *   la imagen intacta. No inventa un recorte.
   * - Un recorte que se pasa de listo se DESCARTA aquí mismo: si sobrevive menos
   *   de la cuarta parte del área, casi seguro se comió el documento y no el
   *   fondo, y perder el número de la cédula es peor que leer con escritorio
   *   alrededor. En ese caso se devuelve la original.
   *
   * Y aun así el pipeline no se juega la lectura a esto: si el recorte no se
   * deja clasificar, vuelve a intentarlo con la imagen entera antes de rechazar.
   */
  async frame(input: Buffer): Promise<DocumentFraming> {
    const original = { buffer: input, recortado: false, areaConservada: 1 };
    try {
      const antes = await sharp(input).metadata();
      const recortada = await sharp(input, { limitInputPixels: this.options.maxImagePixels })
        // Umbral alto: un escritorio no es de un solo tono exacto, y con el
        // valor por omisión (10) el recorte casi nunca se dispara sobre una
        // foto real.
        .trim({ threshold: TRIM_THRESHOLD })
        .toBuffer();
      const despues = await sharp(recortada).metadata();

      const areaAntes = (antes.width ?? 0) * (antes.height ?? 0);
      const areaDespues = (despues.width ?? 0) * (despues.height ?? 0);
      if (areaAntes === 0 || areaDespues === 0) return original;

      const areaConservada = areaDespues / areaAntes;
      if (areaConservada >= 1) return original;
      if (areaConservada < MIN_AREA_TRAS_RECORTE) return original;
      return { buffer: recortada, recortado: true, areaConservada };
    } catch {
      // `trim` lanza cuando la imagen es de un solo color: no hay nada que
      // recortar, y eso no es un fallo del que haya que enterarse.
      return original;
    }
  }

  /**
   * Gira la imagen un cuarto de vuelta, media o tres cuartos, SIN PÉRDIDA.
   *
   * El PNG no es un detalle de implementación: `normalize` ya entregó un JPEG de
   * calidad 88, así que reencodar aquí a JPEG añadiría una SEGUNDA generación
   * con pérdida sobre una imagen que todavía tiene que dar dos cosas muy finas
   * —las cifras del número y de las fechas, y el retrato del que sale el
   * descriptor biométrico—.
   *
   * Se probó con JPEG y se midió: enderezando la misma cédula, el parecido caía
   * de 0,9011 a 0,8707 —por debajo del umbral de aprobación (0,8824), o sea que
   * un documento correcto terminaba en revisión manual— y a media vuelta el
   * reconocedor perdía además el número de cédula y la fecha de caducidad. Con
   * PNG el giro cuesta unos kilobytes de memoria y no cuesta datos.
   */
  async rotate(input: Buffer, degrees: 90 | 180 | 270): Promise<Buffer> {
    return sharp(input, { limitInputPixels: this.options.maxImagePixels })
      .rotate(degrees)
      .png({ compressionLevel: 6 })
      .toBuffer();
  }

  /**
   * `withoutEnlargement` es la mitad del contrato: reducir nunca debe AMPLIAR.
   * Una sonda que agrandara una imagen pequeña costaría más que el intento que
   * viene a abaratar, que es justo lo contrario de para lo que existe.
   */
  async downscale(input: Buffer, longEdge: number): Promise<Buffer> {
    return sharp(input, {
      limitInputPixels: this.options.maxImagePixels,
      failOn: 'warning',
    })
      .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  }

  /**
   * Recorta un rostro detectado con margen alrededor de la caja del proveedor.
   *
   * Los comparadores aciertan bastante más con contexto alrededor de la cabeza
   * que con una caja ceñida a ella, y el retrato impreso en una tarjeta ID-1 ya
   * es pequeño de por sí. Un recorte que sale por debajo del mínimo se rechaza
   * aquí en vez de enviarse a producir una comparación poco fiable.
   */
  async crop(input: Buffer, box: FaceBoundingBox): Promise<Buffer> {
    const padding = this.options.faceCropPaddingRatio;
    const minimum = this.options.minDocumentFacePx;
    const metadata = await sharp(input).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    const padX = box.width * padding;
    const padY = box.height * padding;
    const left = Math.max(0, Math.floor((box.left - padX) * width));
    const top = Math.max(0, Math.floor((box.top - padY) * height));
    const cropWidth = Math.max(
      1,
      Math.min(width - left, Math.ceil((box.width + 2 * padX) * width)),
    );
    const cropHeight = Math.max(
      1,
      Math.min(height - top, Math.ceil((box.height + 2 * padY) * height)),
    );

    if (cropWidth < minimum || cropHeight < minimum) {
      throw identityErrors.documentFaceTooSmall(cropWidth, cropHeight, minimum);
    }

    return sharp(input)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize({
        width: FACE_CROP_LONG_EDGE,
        height: FACE_CROP_LONG_EDGE,
        fit: 'inside',
        withoutEnlargement: false,
      })
      .jpeg({ quality: 95 })
      .toBuffer();
  }
}
