/**
 * Copia las plantillas del generador documental a `dist/`, de forma DETERMINISTA.
 *
 * `nest-cli.json` ya declara estos mismos archivos en `compilerOptions.assets`, y aun así hace
 * falta este guion. El motivo está medido, no supuesto: la copia de recursos del CLI de Nest se
 * apoya en un observador de ficheros (chokidar) que emite los archivos existentes de forma
 * ASÍNCRONA, y `nest build` cierra los observadores en cuanto termina de compilar. En un disco
 * local con la caché caliente la copia gana la carrera; dentro de la imagen Docker, sobre
 * overlayfs y en frío, la pierde — misma configuración, mismo código, cero archivos copiados y
 * ni un aviso.
 *
 * El fallo resultante es de los peores: la imagen se construye, el contenedor arranca, la sonda
 * de salud responde `ok` —el registro de templates vive en el código compilado, no en los
 * `.hbs`— y el defecto sólo aparece en la PRIMERA petición, con un 500. Así se descubrió.
 *
 * Por eso este guion es parte de `yarn build` y no un paso del Dockerfile: el artefacto tiene
 * que salir completo también en local y en CI, no sólo en la imagen.
 *
 * Falla si no copia nada. Un copiador silencioso que no copia es exactamente el problema que
 * viene a resolver.
 */
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

const ORIGEN = resolve('src/pdf-worker/templates');
const DESTINO = resolve(process.env.PDF_TEMPLATES_OUT_DIR ?? 'dist/pdf-worker/templates');

/** Lo que el runtime lee del disco por ruta. El código TypeScript ya lo compila `tsc`. */
const EXTENSIONES = new Set([
  '.hbs',
  '.css',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.woff2',
  '.woff',
  '.ttf',
]);

async function recolectar(directorio) {
  const entradas = await readdir(directorio, { withFileTypes: true });
  const encontrados = [];
  for (const entrada of entradas) {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...(await recolectar(ruta)));
    else if (EXTENSIONES.has(extname(entrada.name).toLowerCase())) encontrados.push(ruta);
  }
  return encontrados;
}

async function main() {
  const info = await stat(ORIGEN).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error(`No existe el directorio de plantillas: ${ORIGEN}`);
  }

  const archivos = await recolectar(ORIGEN);
  if (archivos.length === 0) {
    throw new Error(`No se encontró ninguna plantilla que copiar en ${ORIGEN}`);
  }

  for (const archivo of archivos) {
    const destino = join(DESTINO, relative(ORIGEN, archivo));
    await mkdir(dirname(destino), { recursive: true });
    await cp(archivo, destino);
  }

  // Comprobación de sanidad sobre lo que quedó EN DISCO, no sobre lo que se intentó copiar: es
  // la diferencia entre «el guion se ejecutó» y «el artefacto está completo».
  const copiados = await recolectar(DESTINO);
  if (copiados.length !== archivos.length) {
    throw new Error(
      `Se esperaban ${archivos.length} plantillas en ${DESTINO} y hay ${copiados.length}.`,
    );
  }
  process.stdout.write(`Plantillas del PDF worker copiadas: ${copiados.length} archivos\n`);
}

await main().catch((error) => {
  process.stderr.write(`✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
