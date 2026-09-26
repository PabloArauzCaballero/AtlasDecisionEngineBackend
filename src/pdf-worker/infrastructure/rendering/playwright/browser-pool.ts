/**
 * Un navegador vivo, N contextos efímeros y un semáforo (§36).
 *
 * Lanzar Chromium cuesta entre 250 y 600 ms; imprimir un informe corriente, entre 300 y 900.
 * Arrancar uno por documento más que duplica la latencia y multiplica la memoria por el número
 * de peticiones simultáneas, que es exactamente cómo un generador de PDF tumba un contenedor.
 *
 * Lo que NO se reutiliza es el contexto. Un `BrowserContext` por documento cuesta ~15 ms y
 * garantiza que ningún estado —cookies, almacenamiento, caché— cruce de un documento al
 * siguiente. Compartirlo ahorraría poco y abriría la puerta a que dos informes de dos
 * organizaciones distintas se contaminaran.
 *
 * El semáforo acota los renders simultáneos. Sin él, veinte peticiones a la vez abren veinte
 * pestañas y el contenedor muere por memoria antes de terminar ninguna; con él, esperan, y si
 * la espera se agota se responde 429 —que es información útil— en vez de agotar el reloj.
 */
import { chromium, type Browser, type BrowserContext } from 'playwright';
import {
  PdfRenderError,
  RenderCapacityExceededError,
} from '../../../domain/errors/pdf-worker.errors';

export interface BrowserPoolOptions {
  readonly concurrency: number;
  readonly queueTimeoutMs: number;
  readonly headless: boolean;
  readonly executablePath?: string;
  /** El payload ya está validado y las plantillas no llevan scripts: por defecto, sin JS. */
  readonly javaScriptEnabled: boolean;
}

type Waiter = { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class BrowserPool {
  private browser?: Browser;
  private launching?: Promise<Browser>;
  private active = 0;
  private readonly waiting: Waiter[] = [];
  private closed = false;

  constructor(private readonly options: BrowserPoolOptions) {}

  get activeRenders(): number {
    return this.active;
  }

  get maxConcurrency(): number {
    return this.options.concurrency;
  }

  /**
   * Ejecuta `work` con un contexto propio, garantizando el cierre.
   *
   * El `finally` no es decoración: un contexto que no se cierra deja un proceso hijo de
   * Chromium vivo, y basta un error cada cien renders para que el contenedor acabe con
   * decenas de zombis y sin memoria. El fallo no aparece donde se produce, sino tres horas
   * después y en otra petición.
   */
  async withContext<T>(work: (context: BrowserContext) => Promise<T>): Promise<T> {
    await this.acquire();
    let context: BrowserContext | undefined;
    try {
      const browser = await this.ensureBrowser();
      context = await browser.newContext({
        javaScriptEnabled: this.options.javaScriptEnabled,
        // Fija el resultado: una escala de dispositivo distinta cambia el rasterizado de las
        // imágenes y rompe la comparación visual del §46 sin que nada haya cambiado.
        deviceScaleFactor: 1,
        viewport: { width: 1240, height: 1754 },
        // El documento es autocontenido; que el navegador no anuncie idioma ni zona evita que
        // un `Intl` dentro de la página —si algún día se habilita JS— dependa del anfitrión.
        locale: 'en-US',
        timezoneId: 'UTC',
        reducedMotion: 'reduce',
        colorScheme: 'light',
      });
      return await work(context);
    } finally {
      await context?.close().catch(() => undefined);
      this.release();
    }
  }

  async version(): Promise<string | undefined> {
    if (!this.browser?.isConnected()) return undefined;
    return this.browser.version();
  }

  async isReady(): Promise<boolean> {
    if (this.closed) return false;
    try {
      const browser = await this.ensureBrowser();
      return browser.isConnected();
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new PdfRenderError('el worker se está apagando'));
    }
    const browser = this.browser;
    this.browser = undefined;
    this.launching = undefined;
    await browser?.close().catch(() => undefined);
  }

  /**
   * Devuelve el navegador, relanzándolo si murió.
   *
   * Chromium se cae —por memoria, por una página patológica, porque el orquestador apretó el
   * límite del contenedor— y `isConnected()` pasa a `false`. Sin esta comprobación, la primera
   * caída convierte a la réplica en un servidor que responde 502 a todo para siempre, sano a
   * ojos del orquestador porque el proceso de Node sigue vivo.
   */
  private async ensureBrowser(): Promise<Browser> {
    if (this.closed) throw new PdfRenderError('el worker se está apagando');
    if (this.browser?.isConnected()) return this.browser;
    this.browser = undefined;
    this.launching ??= this.launch();
    try {
      this.browser = await this.launching;
      return this.browser;
    } finally {
      this.launching = undefined;
    }
  }

  private async launch(): Promise<Browser> {
    try {
      return await chromium.launch({
        headless: this.options.headless,
        executablePath: this.options.executablePath,
        args: [
          // `/dev/shm` son 64 MiB en un contenedor por defecto y Chromium los agota
          // rasterizando una página grande; con esto usa `/tmp`, que sí tiene sitio.
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-sandbox',
          '--font-render-hinting=none',
          '--disable-lcd-text',
          '--hide-scrollbars',
          '--mute-audio',
        ],
      });
    } catch (error) {
      throw new PdfRenderError(
        'no se pudo iniciar el navegador. ¿Está instalado Chromium («npx playwright install ' +
          'chromium») y sus dependencias del sistema?',
        {},
        error,
      );
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.options.concurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiting.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(
          new RenderCapacityExceededError(this.options.concurrency, this.options.queueTimeoutMs),
        );
      }, this.options.queueTimeoutMs);
      timer.unref?.();
      this.waiting.push({ resolve, reject, timer });
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (!next) {
      this.active -= 1;
      return;
    }
    // El carril no se libera y se vuelve a pedir: se CEDE. Bajar `active` y dejar que el
    // siguiente lo reclame permite que una petición recién llegada se cuele delante de otra
    // que ya llevaba esperando, y la espera del que estaba en cola deja de tener techo.
    clearTimeout(next.timer);
    next.resolve();
  }
}
