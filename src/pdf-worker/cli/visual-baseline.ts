/**
 * Toma la huella visual de cada template (§46).
 *
 *     yarn pdf:visual:baseline            # muestra las huellas actuales y las diferencias
 *     yarn pdf:visual:baseline --write    # las fija como referencia
 *
 * **Qué cubre y qué no**, porque una herramienta de evidencia que promete de más es peor que
 * ninguna: la huella se toma sobre el HTML COMPUESTO —plantilla, parciales, hojas de estilo,
 * tokens de la marca, membrete, pie, datos del fixture— con el reloj y el identificador de
 * documento fijados. Detecta el cambio accidental en cualquiera de esas piezas.
 *
 * NO detecta un cambio en el motor de impresión: otra versión de Chromium puede paginar
 * distinto con el mismo HTML. Para eso hace falta comparar imágenes, y `--png` deja las
 * capturas en disco para que una persona las mire. El PDF, en cambio, no sirve como referencia
 * byte a byte: lleva una `/CreationDate` que cambia en cada ejecución.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ComposeHtmlUseCase } from '../application/use-cases/compose-html/compose-html.use-case';
import { REFERENCE_BRAND_ENV, REFERENCE_INSTANT } from '../infrastructure/config/reference-env';
import { FixedClock } from '../infrastructure/observability/nest-logger.adapter';
import { TemplateRegistry } from '../infrastructure/registry/template-registry';
import { PdfWorkerModule } from '../pdf-worker.module';

const BASELINE_FILE = resolve('docs/pdf-worker/visual-baseline.json');

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const shouldWrite = process.argv.includes('--write');
  // Dos cosas se fijan al COMPONER el módulo, no después:
  //
  //  · El reloj. Es la única dependencia no determinista del camino de composición, y
  //    parchearlo desde fuera dejaría al caso de uso ya construido con el real.
  //  · El entorno, compartido con la prueba que compara la referencia. Con `process.env`, una
  //    variable `PDF_ORG_*` suelta en la máquina de quien escribe la referencia cambiaría el
  //    membrete y la comparación fallaría en todas las demás máquinas.
  const context = await NestFactory.createApplicationContext(
    PdfWorkerModule.register({
      http: false,
      clock: new FixedClock(REFERENCE_INSTANT),
      env: { ...REFERENCE_BRAND_ENV },
    }),
    { logger: ['error'] },
  );

  try {
    const useCase = context.get(ComposeHtmlUseCase);
    const registry = context.get(TemplateRegistry);
    const current: Record<string, string> = {};

    for (const contract of registry.listTemplates()) {
      for (const version of registry.listVersions(contract.id)) {
        const key = `${contract.id}@${version}`;
        const composed = await useCase.execute({
          templateId: contract.id,
          templateVersion: version,
        });
        current[key] = createHash('sha256')
          .update(`${composed.html}\n${composed.headerHtml}\n${composed.footerHtml}`)
          .digest('hex');
      }
    }

    const previous = await readBaseline();
    const changed = Object.keys(current).filter(
      (key) => previous[key] && previous[key] !== current[key],
    );
    const added = Object.keys(current).filter((key) => !previous[key]);
    const removed = Object.keys(previous).filter((key) => !current[key]);

    for (const key of Object.keys(current).sort()) write(`  ${key}  ${current[key].slice(0, 16)}`);
    if (added.length) write(`\n+ nuevos: ${added.join(', ')}`);
    if (removed.length) write(`- retirados: ${removed.join(', ')}`);
    if (changed.length) write(`~ CAMBIADOS: ${changed.join(', ')}`);

    if (shouldWrite) {
      await mkdir(resolve('docs/pdf-worker'), { recursive: true });
      await writeFile(BASELINE_FILE, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
      write(`\n✔ referencia escrita en ${BASELINE_FILE}`);
      return;
    }
    if (changed.length > 0) {
      write(
        '\n✖ Hay cambios visuales sin aprobar. Revíselos y, si son intencionados, ejecute --write.',
      );
      process.exitCode = 1;
    }
  } finally {
    await context.close();
  }
}

async function readBaseline(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(BASELINE_FILE, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
