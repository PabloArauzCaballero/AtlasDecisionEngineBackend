import { dirname } from 'node:path';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createWorker, type Worker } from 'tesseract.js';
import type { DocumentOcrInput, DocumentOcrPort, DocumentOcrResult } from '../ports/identity.ports';

/**
 * Lectura real del documento, en el propio proceso y sin credenciales.
 *
 * Es lo que convierte «¿esto es un documento?» en una pregunta que se puede
 * responder. Con el proveedor sintético el OCR devolvía SIEMPRE la misma cédula
 * boliviana, así que una foto de un gato terminaba VERIFICADA: el pipeline
 * funcionaba y la comprobación no comprobaba nada.
 *
 * Tesseract corre sobre WebAssembly y los datos del idioma llegan como paquete
 * de npm (`@tesseract.js-data/spa`), no de una CDN: el contenedor no abre una
 * sola conexión de red para leer un documento, que es justo lo que no debe
 * hacer un proceso que maneja la cédula de una persona.
 *
 * Medido en este repositorio: una tarjeta legible tarda ~700 ms con confianza
 * 95; una imagen sin texto tarda ~90 ms y devuelve cadena vacía. Esa cadena
 * vacía es la señal, y quien decide qué hacer con ella es el pipeline.
 */
@Injectable()
export class TesseractOcrAdapter implements DocumentOcrPort, OnModuleDestroy {
  private readonly logger = new Logger(TesseractOcrAdapter.name);
  /**
   * Un worker, creado en la primera lectura y reutilizado.
   *
   * Arrancarlo cuesta segundos —carga el wasm y descomprime el modelo del
   * idioma—, así que crearlo por ejecución convertiría el arranque en la parte
   * cara de leer un documento. Perezoso porque un proceso con el worker apagado
   * no debe pagar esa carga.
   */
  private worker?: Promise<Worker>;

  async extract(input: DocumentOcrInput): Promise<DocumentOcrResult> {
    const worker = await this.instance();
    const { data } = await worker.recognize(input.image);

    /*
     * Las líneas se parten del texto de la página y no se piden como bloques.
     *
     * `recognize` sólo devuelve la estructura por bloques si se le pide, y esa
     * estructura es detalle interno de Tesseract: atarse a ella obliga a
     * seguirla en cada actualización. Se intentó, para filtrar por confianza las
     * palabras que el reconocedor saca del RETRATO, y no sirve: medido sobre una
     * cédula legible, esos glifos llegan con 60, 83 y 94 —está seguro de lo que
     * ve— mientras que el `N°` que precede al número llega con 28. Filtrar por
     * ahí tiraba un anclaje real y dejaba pasar el ruido. Se limpia donde se
     * puede distinguir, que es en el analizador.
     */
    const confidence = typeof data.confidence === 'number' ? data.confidence / 100 : null;
    const lines = (data.text ?? '')
      .split('\n')
      .map((text) => ({ text: text.replace(/\s+/g, ' ').trim(), confidence }))
      .filter((line) => line.text.length > 0);

    return {
      rawText: data.text ?? '',
      lines,
      provider: 'tesseract',
      modelVersion: 'spa-4.0.0',
    };
  }

  async health(): Promise<{ ready: boolean; detail?: string }> {
    try {
      await this.instance();
      return { ready: true };
    } catch (error) {
      return { ready: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) return;
    const worker = await this.worker.catch(() => null);
    await worker?.terminate();
  }

  private instance(): Promise<Worker> {
    this.worker ??= this.create();
    return this.worker;
  }

  private async create(): Promise<Worker> {
    // Rutas resueltas desde `node_modules`, NO escritas a mano: en la imagen de
    // producción el árbol se poda, y una ruta fija apuntaría a un directorio
    // que allí no existe.
    const langPath = dirname(require.resolve('@tesseract.js-data/spa/4.0.0/spa.traineddata.gz'));
    const corePath = dirname(require.resolve('tesseract.js-core/package.json'));
    this.logger.log(`Cargando OCR local (spa) desde ${langPath}`);
    return createWorker('spa', 1, { langPath, corePath, gzip: true, logger: () => undefined });
  }
}
