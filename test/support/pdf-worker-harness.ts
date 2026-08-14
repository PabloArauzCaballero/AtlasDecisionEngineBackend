/**
 * Arnés de pruebas del generador documental.
 *
 * Monta el módulo REAL —Handlebars real, plantillas reales, marcas reales, precedencia real— y
 * sustituye únicamente el motor de impresión. Esa elección es la que hace útiles a las pruebas
 * unitarias de este worker: con dobles de todo, pasarían aunque el layout hubiera dejado de
 * incluir el pie; con el motor real, harían falta 400 MiB de Chromium para saber si una tabla
 * lleva `<thead>`.
 *
 * El reloj va congelado. `createdAt` se imprime en el pie y viaja en la ficha; con el reloj
 * real no hay forma de afirmar sobre él sin margen de un segundo.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import type {
  PdfRenderInput,
  PdfRendererPort,
  PdfRenderResult,
  RendererHealth,
} from '../../src/pdf-worker/application/ports/pdf-renderer.port';
import { PDF_RENDERER_PORT } from '../../src/pdf-worker/application/ports/pdf-renderer.port';
import type { ClockPort } from '../../src/pdf-worker/application/ports/runtime.ports';
import { FixedClock } from '../../src/pdf-worker/infrastructure/observability/nest-logger.adapter';
import { PdfWorkerModule } from '../../src/pdf-worker/pdf-worker.module';

export const FROZEN_AT = new Date('2026-01-15T12:00:00.000Z');

/**
 * Motor de impresión falso que devuelve bytes con la firma `%PDF-` y GUARDA la entrada.
 *
 * Guardar la entrada es la mitad del valor: permite afirmar sobre el HTML compuesto —que el
 * pie lleva los ganchos de numeración, que el payload salió escapado, que no hay una sola URL
 * remota— sin abrir un PDF.
 */
export class FakeRenderer implements PdfRendererPort {
  readonly name = 'fake';
  readonly calls: PdfRenderInput[] = [];

  /** Fuerza un fallo en la siguiente llamada, para ejercitar el camino de error. */
  failWith?: Error;

  async render(input: PdfRenderInput): Promise<PdfRenderResult> {
    this.calls.push(input);
    if (this.failWith) {
      const error = this.failWith;
      this.failWith = undefined;
      throw error;
    }
    const content = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from(`/Type /Pages /Count 3\n`),
      Buffer.from(input.html.slice(0, 64)),
    ]);
    return { content, durationMs: 12, renderer: this.name, pageCount: 3 };
  }

  async health(): Promise<RendererHealth> {
    return { available: true, renderer: this.name, engineVersion: 'fake-1' };
  }

  async shutdown(): Promise<void> {}

  get lastCall(): PdfRenderInput {
    const last = this.calls.at(-1);
    if (!last) throw new Error('El motor de impresión no recibió ninguna llamada.');
    return last;
  }
}

export interface Harness {
  readonly module: TestingModule;
  readonly renderer: FakeRenderer;
  close(): Promise<void>;
}

export interface HarnessOptions {
  readonly clock?: ClockPort;
  /**
   * Usa `env` TAL CUAL, sin los valores del arnés.
   *
   * Lo necesita la regresión visual: su referencia se tomó con un entorno concreto y publicado
   * (`REFERENCE_BRAND_ENV`), y mezclarlo con los del arnés compondría otro membrete — es decir,
   * otra huella.
   */
  readonly replaceEnv?: boolean;
}

export async function createPdfWorkerHarness(
  env: NodeJS.ProcessEnv = {},
  options: HarnessOptions = {},
): Promise<Harness> {
  const renderer = new FakeRenderer();
  const module = await Test.createTestingModule({
    imports: [
      PdfWorkerModule.register({
        http: false,
        clock: options.clock ?? new FixedClock(FROZEN_AT),
        // Entorno EXPLÍCITO y no `process.env`: una variable suelta en la máquina de quien
        // ejecuta las pruebas cambiaría el membrete y con él las afirmaciones sobre el HTML.
        env: options.replaceEnv
          ? env
          : {
              PDF_ORG_NAME: 'Cooperativa Nuñez & Peñaranda',
              PDF_ORG_LEGAL_NAME: 'Cooperativa Nuñez y Peñaranda S.A.',
              PDF_ORG_TAX_ID: 'NIT 1023456789',
              PDF_ORG_ADDRESS: 'Av. Ballivián 1234, La Paz',
              PDF_ORG_EMAIL: 'documentos@example.bo',
              PDF_FOOTER_TEXT: 'Documento generado automáticamente.',
              PDF_STORAGE_ENABLED: 'true',
              PDF_STORAGE_PROVIDER: 'memory',
              ...env,
            },
      }),
    ],
  })
    .overrideProvider(PDF_RENDERER_PORT)
    .useValue(renderer)
    .compile();

  await module.init();
  return {
    module,
    renderer,
    close: async () => {
      await module.close();
    },
  };
}
