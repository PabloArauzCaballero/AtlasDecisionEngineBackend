#!/usr/bin/env node
/**
 * Lanza Jest con soporte de módulos ESM en su máquina virtual.
 *
 * Por qué hace falta: `pdfjs-dist` v5 es **ESM puro** —no publica ninguna
 * construcción CommonJS—, y el motor de extractos lo carga con un `import()`
 * dinámico. En producción eso funciona porque Node sabe cargar ESM desde
 * CommonJS; dentro de Jest no, porque sus módulos corren en una VM que sólo
 * resuelve ESM con `--experimental-vm-modules`. Sin el flag, el import falla en
 * milisegundos y todas las pruebas que leen un PDF caen con
 * `PDF_EXTRACTION_FAILED`, que parece un fallo del motor y no lo es.
 *
 * Por qué un lanzador y no `NODE_OPTIONS=... jest` en el script de npm: esa
 * forma no es portable a Windows, donde el script corre bajo `cmd.exe` y el
 * prefijo se interpreta como un comando. La alternativa habitual es añadir
 * `cross-env`, es decir, una dependencia más para exportar una variable.
 *
 * El flag sólo HABILITA la resolución de ESM; no cambia cómo se cargan los
 * módulos CommonJS, que es como se carga todo lo demás del repositorio.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jestBin = require.resolve('jest/bin/jest');

// Se concatena en vez de sustituir: quien invoque con su propio NODE_OPTIONS
// (un depurador, un límite de memoria en CI) no debe perderlo por esto.
const nodeOptions = [process.env.NODE_OPTIONS, '--experimental-vm-modules']
  .filter(Boolean)
  .join(' ');

const child = spawn(process.execPath, [jestBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on('exit', (code, signal) => {
  // Una señal no es un código de salida: propagarla como 0 haría pasar a CI un
  // proceso que en realidad fue abatido.
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
