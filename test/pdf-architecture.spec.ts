/**
 * La arquitectura, comprobada leyendo los imports (§2, §48).
 *
 * Un diagrama en un README envejece en silencio. Esta prueba recorre los archivos y afirma lo
 * que el diagrama promete: que el dominio no depende de nada, que la aplicación no conoce
 * Playwright ni Handlebars ni el disco, y que el worker no importa nada del motor anfitrión.
 *
 * Sin ella, el primer `import { chromium }` dentro de un caso de uso «porque hacía falta para
 * una cosa» no pone nada en rojo, y a partir de ahí la separación ya no es cierta aunque siga
 * escrita.
 */
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../src/pdf-worker');

/** Paquetes y rutas que una capa NO puede nombrar. */
const PROHIBIDO_EN_DOMINIO = [
  'playwright',
  'handlebars',
  'zod',
  'prom-client',
  '@nestjs/',
  'node:fs',
  'node:path',
  '../../infrastructure',
  '../infrastructure',
  '../../presentation',
  '../../../common',
];

const PROHIBIDO_EN_APLICACION = [
  'playwright',
  'handlebars',
  'prom-client',
  'node:fs',
  '../../infrastructure',
  '../../../infrastructure',
  '../../presentation',
  '../../../presentation',
];

/** El worker no puede depender del motor que lo hospeda: es lo que permite sacarlo aparte. */
const PROHIBIDO_EN_TODO = ['../common/', '../modules/', '../../common/', '../../modules/'];

const IMPORT = /^\s*(?:import|export)\b[\s\S]*?from\s+['"]([^'"]+)['"]/gm;

async function ficheros(directorio: string): Promise<string[]> {
  const entradas = await readdir(directorio, { withFileTypes: true });
  const resultado: string[] = [];
  for (const entrada of entradas) {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) resultado.push(...(await ficheros(ruta)));
    else if (extname(entrada.name) === '.ts') resultado.push(ruta);
  }
  return resultado;
}

async function importsDe(fichero: string): Promise<string[]> {
  const fuente = await readFile(fichero, 'utf8');
  return [...fuente.matchAll(IMPORT)].map((coincidencia) => coincidencia[1]);
}

async function infracciones(carpeta: string, prohibidos: readonly string[]): Promise<string[]> {
  const encontradas: string[] = [];
  for (const fichero of await ficheros(join(ROOT, carpeta))) {
    for (const especificador of await importsDe(fichero)) {
      const prohibido = prohibidos.find(
        (patron) => especificador === patron || especificador.startsWith(patron),
      );
      if (prohibido) {
        encontradas.push(`${relative(ROOT, fichero)} → ${especificador}`);
      }
    }
  }
  return encontradas;
}

describe('Arquitectura del generador documental', () => {
  it('el dominio no depende de nada: ni framework, ni validador, ni disco', async () => {
    expect(await infracciones('domain', PROHIBIDO_EN_DOMINIO)).toEqual([]);
  });

  it('la aplicación no conoce Playwright, Handlebars ni el sistema de archivos', async () => {
    // `@nestjs/common` SÍ se admite aquí: `@Injectable` y `@Inject` son metadatos de
    // composición, no comportamiento, y sin ellos el cableado se haría a mano en el módulo con
    // una lista de posiciones que se desincroniza al primer parámetro nuevo.
    expect(await infracciones('application', PROHIBIDO_EN_APLICACION)).toEqual([]);
  });

  it('sólo el adaptador de renderizado importa Playwright', async () => {
    const conPlaywright: string[] = [];
    for (const fichero of await ficheros(ROOT)) {
      const especificadores = await importsDe(fichero);
      if (especificadores.some((nombre) => nombre.startsWith('playwright'))) {
        conPlaywright.push(relative(ROOT, fichero).replace(/\\/g, '/'));
      }
    }
    expect(conPlaywright.sort()).toEqual([
      // El CLI de evidencia abre el PDF ya generado con el VISOR del navegador; no imprime.
      'cli/evidencia.ts',
      'infrastructure/rendering/playwright/browser-pool.ts',
      'infrastructure/rendering/playwright/playwright-pdf-renderer.adapter.ts',
    ]);
  });

  it('sólo el adaptador de plantillas importa Handlebars', async () => {
    const conHandlebars: string[] = [];
    for (const fichero of await ficheros(ROOT)) {
      const especificadores = await importsDe(fichero);
      if (especificadores.some((nombre) => nombre === 'handlebars')) {
        conHandlebars.push(relative(ROOT, fichero).replace(/\\/g, '/'));
      }
    }
    expect(conHandlebars.sort()).toEqual([
      'infrastructure/templates/handlebars/handlebars-helpers.ts',
      'infrastructure/templates/handlebars/handlebars-template-engine.adapter.ts',
    ]);
  });

  it('el worker no importa nada del motor anfitrión', async () => {
    // Es la propiedad que hace que sacarlo a su propio despliegue sea borrar una línea de
    // `app.module.ts`, y no desenredar dependencias.
    const encontradas: string[] = [];
    for (const fichero of await ficheros(ROOT)) {
      for (const especificador of await importsDe(fichero)) {
        if (PROHIBIDO_EN_TODO.some((patron) => especificador.startsWith(patron))) {
          encontradas.push(`${relative(ROOT, fichero)} → ${especificador}`);
        }
      }
    }
    expect(encontradas).toEqual([]);
  });

  it('ninguna hoja de estilo escribe un color literal fuera de tokens.css', async () => {
    // Un `#0f172a` suelto sobrevive al cambio de marca y produce un documento con dos
    // identidades: la de la organización en el membrete y la de quien programó, en la tabla.
    const infractoras: string[] = [];
    const estilos = (await ficheros(join(ROOT, 'templates')))
      .concat(await hojasCss(join(ROOT, 'templates')))
      .filter((fichero) => fichero.endsWith('.css'));

    for (const hoja of estilos) {
      if (hoja.endsWith('tokens.css')) continue;
      const contenido = await readFile(hoja, 'utf8');
      if (/#[0-9a-fA-F]{3,8}\b/.test(contenido.replace(/\/\*[\s\S]*?\*\//g, ''))) {
        infractoras.push(relative(ROOT, hoja));
      }
    }
    expect(infractoras).toEqual([]);
  });
});

async function hojasCss(directorio: string): Promise<string[]> {
  const entradas = await readdir(directorio, { withFileTypes: true });
  const resultado: string[] = [];
  for (const entrada of entradas) {
    const ruta = join(directorio, entrada.name);
    if (entrada.isDirectory()) resultado.push(...(await hojasCss(ruta)));
    else if (extname(entrada.name) === '.css') resultado.push(ruta);
  }
  return resultado;
}
