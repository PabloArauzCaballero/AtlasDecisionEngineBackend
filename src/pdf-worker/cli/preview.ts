/**
 * Vista previa desde la línea de órdenes (§21).
 *
 *     yarn pdf:preview generic-result-report
 *     yarn pdf:preview credit-analysis-report 1.0.0 --out=./tmp/credito.pdf
 *
 * Existe para cerrar el bucle de trabajo de quien maqueta un documento: cambiar el `.hbs`, ver
 * el PDF, repetir — sin levantar el motor, sin base de datos y sin un algoritmo que produzca
 * datos. Sin esto, cada iteración de diseño cuesta arrancar el backend entero.
 *
 * Sin argumentos, lista lo que hay. Un comando que falla diciendo «falta el template» y no dice
 * cuáles existen obliga a ir a buscarlo al código.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PdfWorkerModule } from '../pdf-worker.module';
import { LocalPdfGeneratorAdapter } from '../sdk/local-pdf-generator.adapter';

function argOf(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const [templateId, version] = positional;

  // `http: false`: el CLI no necesita rutas, y montarlas obligaría a que el puerto estuviera
  // libre para algo que nunca va a escuchar.
  const context = await NestFactory.createApplicationContext(
    PdfWorkerModule.register({ http: false }),
    { logger: ['error', 'warn'] },
  );

  try {
    const generator = context.get(LocalPdfGeneratorAdapter);
    const templates = await generator.listTemplates();

    if (!templateId) {
      write('Templates publicados:');
      for (const template of templates) {
        const flag = template.deprecated ? ' (obsoleto)' : '';
        write(`  ${template.id}@${template.version}${flag} — ${template.title}`);
      }
      write('\nUso: yarn pdf:preview <templateId> [version] [--out=ruta.pdf] [--brand=id]');
      return;
    }

    const result = await generator.preview({
      templateId,
      templateVersion: version,
      brandId: argOf('brand'),
      locale: argOf('locale'),
      timezone: argOf('timezone'),
    });

    const output = resolve(argOf('out') ?? `./tmp/pdf-preview/${result.filename}`);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, result.content ?? Buffer.alloc(0));

    write(`✔ ${result.template.id}@${result.template.version}`);
    write(`  archivo   ${output}`);
    write(`  tamaño    ${result.sizeBytes} bytes`);
    write(`  páginas   ${result.trace.pageCount ?? 'desconocido'}`);
    write(`  checksum  ${result.checksum}`);
    write(`  render    ${result.trace.renderDurationMs} ms (${result.trace.renderer})`);
  } finally {
    // Cierra el navegador. Sin esto el proceso no termina: Chromium sigue vivo y el CLI se
    // queda colgado sin decir por qué.
    await context.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
