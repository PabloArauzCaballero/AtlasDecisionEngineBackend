/**
 * Genera evidencia visual del generador documental.
 *
 *     yarn pdf:evidencia
 *
 * Produce, para cada template publicado: el PDF real —por el camino completo, el mismo que
 * atiende `POST /pdf/generate`—, una captura del VISOR de PDF con el documento abierto, y una
 * captura por página.
 *
 * **Por qué el visor y no una captura del HTML.** Capturar el HTML de partida sería más fácil y
 * probaría menos: enseñaría lo que el navegador pintó en pantalla, no lo que quedó impreso.
 * Todo lo que este worker existe para resolver —los saltos de página, la cabecera de tabla
 * repetida, el membrete y el pie en los márgenes, «Página X de Y»— sólo aparece DESPUÉS de
 * paginar. Una evidencia que no lo muestra no es evidencia de nada.
 *
 * Por eso se abre el archivo `.pdf` con el visor del navegador completo (canal `chromium`, no el
 * `headless shell`, que no lleva visor y se limita a descargarlo). La captura del visor lleva el
 * contador «N / M» a la vista: es la comprobación de que el archivo ABRE, y no sólo de que
 * empieza por `%PDF-`.
 *
 * El script AUDITA lo que dejó en disco. Una corrida puede terminar en verde y dejar capturas
 * de una pantalla en blanco; si alguna pesa menos que eso, se rechaza la corrida entera.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { chromium, type Browser } from 'playwright';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LocalPdfGeneratorAdapter } from '../sdk/local-pdf-generator.adapter';
import { REFERENCE_BRAND_ENV, REFERENCE_INSTANT } from '../infrastructure/config/reference-env';
import { TemplateRegistry } from '../infrastructure/registry/template-registry';
import { FixedClock } from '../infrastructure/observability/nest-logger.adapter';
import { PdfWorkerModule } from '../pdf-worker.module';

const OUTPUT = resolve('docs/pdf-worker/evidencia');
/** Una captura de una hoja A4 en blanco ronda los 8 KiB; por debajo, algo salió mal. */
const MIN_PNG_BYTES = 6_000;
/** Relación A4 a 1000 px de ancho. */
const VIEWPORT = { width: 1000, height: 1414 };

interface Registro {
  readonly template: string;
  readonly documentId: string;
  readonly paginas: number | undefined;
  readonly bytes: number;
  readonly checksum: string;
  readonly renderMs: number;
  readonly archivos: string[];
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function capturarPagina(browser: Browser, pdfPath: string, pagina: number): Promise<Buffer> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  try {
    // `toolbar=0&navpanes=0&view=Fit` los entiende el visor incorporado y deja la hoja sola,
    // sin la barra ni las miniaturas. Un cambio de fragmento NO recarga, así que cada página
    // es una navegación completa.
    const url = `${pathToFileURL(pdfPath).href}#toolbar=0&navpanes=0&view=Fit&page=${pagina}`;
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    // El visor es un complemento: no emite ningún evento del DOM que se pueda esperar. La
    // espera fija es fea y es lo que hay; el guardia de tamaño de más abajo es quien detecta
    // que se quedó corta.
    await page.waitForTimeout(2_500);
    return await page.screenshot();
  } finally {
    await context.close();
  }
}

async function capturarVisor(browser: Browser, pdfPath: string): Promise<Buffer> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await page.goto(pathToFileURL(pdfPath).href, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(2_500);
    return await page.screenshot();
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });

  const context = await NestFactory.createApplicationContext(
    // Reloj congelado: la fecha va impresa en el pie y en los metadatos, y una evidencia que
    // cambia en cada corrida no se puede comparar con la anterior.
    PdfWorkerModule.register({
      http: false,
      clock: new FixedClock(REFERENCE_INSTANT),
      // El MISMO membrete y el mismo instante que la huella visual: así una captura y una
      // referencia siempre hablan del mismo documento.
      env: { ...REFERENCE_BRAND_ENV },
    }),
    { logger: ['error', 'warn'] },
  );

  let viewer: Browser | undefined;
  const registros: Registro[] = [];

  try {
    const generator = context.get(LocalPdfGeneratorAdapter);
    const registry = context.get(TemplateRegistry);

    try {
      // Canal `chromium`: el navegador COMPLETO. El `headless shell` que usa el renderizador no
      // incluye el visor de PDF y responde «Download is starting» en vez de pintarlo.
      viewer = await chromium.launch({
        channel: 'chromium',
        headless: true,
        args: ['--no-sandbox'],
      });
    } catch (error) {
      write(
        `⚠ Sin visor de PDF (${error instanceof Error ? error.message.split('\n')[0] : 'error'}). ` +
          'Se generarán los PDF pero no las capturas: instale el navegador completo con ' +
          '«npx playwright install chromium».',
      );
    }

    for (const contract of registry.listTemplates()) {
      for (const version of registry.listVersions(contract.id)) {
        const etiqueta = `${contract.id}@${version}`;
        const resultado = await generator.preview({
          templateId: contract.id,
          templateVersion: version,
        });
        const base = `${contract.id}-${version}`;
        const pdfPath = join(OUTPUT, `${base}.pdf`);
        await writeFile(pdfPath, resultado.content ?? Buffer.alloc(0));

        const archivos = [`${base}.pdf`];
        if (viewer) {
          const visor = await capturarVisor(viewer, pdfPath);
          await writeFile(join(OUTPUT, `${base}-visor.png`), visor);
          archivos.push(`${base}-visor.png`);
          auditar(`${base}-visor.png`, visor);

          const total = Math.min(resultado.trace.pageCount ?? 1, 6);
          for (let pagina = 1; pagina <= total; pagina += 1) {
            const shot = await capturarPagina(viewer, pdfPath, pagina);
            const nombre = `${base}-pagina-${pagina}.png`;
            await writeFile(join(OUTPUT, nombre), shot);
            archivos.push(nombre);
            auditar(nombre, shot);
          }
        }

        registros.push({
          template: etiqueta,
          documentId: resultado.documentId,
          paginas: resultado.trace.pageCount,
          bytes: resultado.sizeBytes,
          checksum: resultado.checksum,
          renderMs: resultado.trace.renderDurationMs,
          archivos,
        });
        write(
          `✔ ${etiqueta.padEnd(34)} ${String(resultado.trace.pageCount ?? '?').padStart(2)} pág · ` +
            `${String(resultado.sizeBytes).padStart(7)} B · ${resultado.trace.renderDurationMs} ms`,
        );
      }
    }

    await writeFile(
      join(OUTPUT, 'evidencia.json'),
      `${JSON.stringify(registros, null, 2)}\n`,
      'utf8',
    );
    await writeFile(join(OUTPUT, 'README.md'), indice(registros, Boolean(viewer)), 'utf8');
    write(`\n✔ Evidencia en ${OUTPUT}`);
  } finally {
    await viewer?.close().catch(() => undefined);
    await context.close();
  }
}

/**
 * Rechaza una captura sospechosamente pequeña.
 *
 * Una corrida de capturas puede terminar en verde y dejar veinte fotos de una pantalla en
 * blanco —porque la espera se quedó corta, porque el visor no llegó a pintar—. Sin este
 * guardia, «se generó la evidencia» y «la evidencia sirve» son indistinguibles.
 */
function auditar(nombre: string, contenido: Buffer): void {
  if (contenido.byteLength < MIN_PNG_BYTES) {
    throw new Error(
      `La captura «${nombre}» pesa ${contenido.byteLength} B, menos que una pantalla en blanco. ` +
        'Probablemente el visor no llegó a pintar el documento.',
    );
  }
}

function indice(registros: readonly Registro[], conCapturas: boolean): string {
  const filas = registros
    .map(
      (registro) =>
        `| \`${registro.template}\` | ${registro.paginas ?? '?'} | ${registro.bytes.toLocaleString('es-BO')} | ` +
        `${registro.renderMs} ms | \`${registro.checksum.slice(0, 16)}…\` |`,
    )
    .join('\n');

  const capturas = registros
    .flatMap((registro) =>
      registro.archivos
        .filter((archivo) => archivo.endsWith('.png'))
        .map((archivo) => `### ${registro.template} — ${archivo}\n\n![${archivo}](./${archivo})\n`),
    )
    .join('\n');

  return [
    '# Evidencia del PDF Generator Worker',
    '',
    'Generada por `yarn pdf:evidencia`. Cada PDF sale del camino COMPLETO —el mismo que atiende',
    '`POST /pdf/generate`— con el reloj congelado en `2026-02-11T15:30:00Z` para que dos corridas',
    'sean comparables.',
    '',
    'Las capturas son del **visor de PDF del navegador con el archivo abierto**, no del HTML de',
    'partida. Es la diferencia entre enseñar lo que se pintó en pantalla y lo que quedó impreso:',
    'los saltos de página, la cabecera de tabla repetida, el membrete y el pie en los márgenes y',
    '«Página X de Y» sólo existen después de paginar.',
    '',
    '| Template | Páginas | Bytes | Render | Checksum (SHA-256) |',
    '| --- | ---: | ---: | ---: | --- |',
    filas,
    '',
    conCapturas ? '## Capturas\n' : '> Sin capturas: no había navegador completo disponible.\n',
    capturas,
  ].join('\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
