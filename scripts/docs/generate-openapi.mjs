#!/usr/bin/env node
/**
 * Escribe el contrato OpenAPI a `openapi/openapi.json` desde la aplicación REAL.
 *
 * No hay una segunda descripción escrita a mano: el documento sale del mismo
 * `buildOpenApiDocument` que sirve `main.ts`, recorriendo los controladores compilados. Un
 * endpoint nuevo aparece aquí sin que nadie lo transcriba, y uno borrado desaparece — que es
 * la única forma de que el contrato publicado no se convierta en ficción.
 *
 * Requiere `yarn build` previo y una base de datos alcanzable: el módulo raíz abre la
 * conexión al inicializarse. Es un coste aceptable a cambio de generar el contrato desde la
 * aplicación de verdad y no desde una reconstrucción aproximada de sus rutas.
 *
 *   node scripts/docs/generate-openapi.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outputDirectory = join(repoRoot, 'openapi');

async function loadDist(relativePath) {
  const target = join(repoRoot, 'dist', relativePath);
  try {
    return await import(pathToFileURL(target).href);
  } catch (error) {
    throw new Error(
      `No se pudo cargar dist/${relativePath}. Ejecute "yarn build" primero. Causa: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function main() {
  process.env.SWAGGER_ENABLED ??= 'true';
  // La generación no atiende tráfico ni debe sembrar nada: arrancar los trabajos de fondo
  // solo añadiría escrituras y ruido a un comando que únicamente lee metadatos de rutas.
  process.env.WORKER_ROLE = 'API';
  process.env.STARTUP_SEED_ENABLED = 'false';
  process.env.OTEL_ENABLED = 'false';

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await loadDist('app.module.js');
  const { buildOpenApiDocument } = await loadDist('common/openapi/openapi-document.js');

  // `abortOnError: false` es deliberado: con el valor por defecto, un fallo al inicializar el
  // módulo raíz hace que Nest aborte el proceso **sin lanzar**, y con el logger apagado el
  // comando terminaba en código 1 sin una sola línea de explicación. Así el error llega aquí.
  const app = await NestFactory.create(AppModule, { logger: ['error'], abortOnError: false });
  await app.init();
  try {
    const { ConfigService } = await import('@nestjs/config');
    const config = app.get(ConfigService);
    const document = buildOpenApiDocument(app, {
      apiVersion: config.get('API_VERSION') ?? 'v1',
      buildVersion: config.get('BUILD_VERSION') ?? '0.0.0',
      commitSha: config.get('COMMIT_SHA') ?? 'local',
    });

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      join(outputDirectory, 'openapi.json'),
      `${JSON.stringify(document, null, 2)}\n`,
      'utf8',
    );

    const operations = Object.values(document.paths ?? {}).flatMap((item) =>
      Object.entries(item ?? {}).filter(([method]) =>
        ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'].includes(method),
      ),
    );
    console.log(
      `openapi/openapi.json escrito: ${Object.keys(document.paths ?? {}).length} rutas, ` +
        `${operations.length} operaciones, ${Object.keys(document.components?.schemas ?? {}).length} esquemas.`,
    );
  } finally {
    await app.close();
  }
}

await main().catch((error) => {
  // La traza completa, no solo el mensaje: un fallo al inicializar el módulo raíz suele
  // llegar con `message` vacío y sin ella el comando falla en silencio.
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
