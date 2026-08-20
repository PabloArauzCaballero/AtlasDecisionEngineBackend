import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation, type UndiciRequest } from '@opentelemetry/instrumentation-undici';
import { UNTRACED_HTTP_PATHS } from './telemetry.constants';
import type { TelemetryConfig } from './telemetry.types';

/**
 * Instrumentaciones automáticas, elegidas una a una.
 *
 * No se usa `auto-instrumentations-node`: habilita más de cuarenta parches —`fs`, `dns`, `net`,
 * `winston`…— de los que este backend sólo necesita cinco. El resto son spans por cada lectura
 * de fichero y cada resolución de nombre, que entierran la operación de negocio bajo ruido y
 * cuestan latencia en el camino caliente. Aquí se declara exactamente lo que hay:
 *
 * | Instrumentación | Qué cubre en este motor |
 * | --- | --- |
 * | `http` | Peticiones entrantes al API y salientes por el módulo `http` |
 * | `express` | Enrutado y middleware bajo NestJS |
 * | `pg` | Toda consulta de Prisma: usa `@prisma/adapter-pg` sobre un `Pool` de `pg` |
 * | `ioredis` | Caché, límites de tasa y reservas de idempotencia |
 * | `undici` | `fetch` global: proveedor de identidad y variables externas |
 *
 * No hay instrumentación de Prisma: el adaptador ya pasa por `pg`, y añadirla duplicaría cada
 * consulta en dos spans que describen la misma llamada.
 *
 * Los parámetros de los hooks van anotados EXPLÍCITAMENTE y no por inferencia contextual, y
 * conviene saber por qué antes de "limpiarlos".
 *
 * `@opentelemetry/instrumentation-undici@0.31` dependía de
 * `@opentelemetry/instrumentation@^0.221` mientras el resto de instrumentaciones fijan
 * `^0.220`. Para una versión 0.x el cursor `^` no cruza la minor, así que las dos peticiones
 * eran incompatibles y el árbol acababa con DOS copias de `@opentelemetry/instrumentation`.
 * Cada copia declara su propio `InstrumentationConfig`, de modo que qué copia ganara el
 * hoisting decidía si el literal de configuración ligaba con el tipo del constructor; cuando
 * no ligaba, TypeScript perdía el tipo contextual y fallaba con TS7006 sobre parámetros que
 * nadie había tocado.
 *
 * El efecto era desconcertante: `yarn build` pasaba en una máquina de desarrollo, cuyo
 * `node_modules` se había ido construyendo de forma incremental, y FALLABA en una instalación
 * limpia desde el lockfile — es decir, dentro de la imagen. La construcción del contenedor era
 * el único sitio donde el error se veía.
 *
 * La causa está resuelta: `instrumentation-undici` se fijó en `^0.30`, que depende de
 * `^0.220` como todo lo demás, y el árbol vuelve a tener UNA sola copia. Las anotaciones se
 * conservan igualmente porque no cuestan nada y hacen el archivo inmune a que la divergencia
 * reaparezca al subir versiones: si vuelve a haber dos copias, esto compilará con cualquiera
 * de las dos en vez de romper la imagen.
 */
export function buildInstrumentations(config: TelemetryConfig): Instrumentation[] {
  const exporterTarget = parseExporterTarget(config.tracesEndpoint);

  return [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request: IncomingMessage) => isUntracedPath(request.url),
      // El exportador OTLP habla por el módulo `http`. Sin esta exclusión, exportar un lote de
      // spans genera un span, cuya exportación genera otro: un bucle que se retroalimenta y
      // que sólo se nota cuando el colector ya está saturado.
      ignoreOutgoingRequestHook: (request: RequestOptions) =>
        isExporterRequest(request, exporterTarget),
      // Deliberadamente sin `headersToSpanAttributes`: capturar cabeceras traería
      // `authorization`, `cookie` y `x-api-key` al sistema de trazas.
    }),
    new ExpressInstrumentation(),
    // Se captura el TEXTO de la sentencia; los VALORES de los parámetros no. Un span con los
    // parámetros de un `insert` de evidencia llevaría al backend de trazas justo los datos
    // personales que el logger se cuida de no escribir.
    new PgInstrumentation({ enhancedDatabaseReporting: false }),
    new IORedisInstrumentation({
      // El valor almacenado nunca entra en el span: sólo el comando y sus argumentos serían
      // suficientes para filtrar el contenido de una caché tenant-scoped.
      dbStatementSerializer: (command) => command,
    }),
    new UndiciInstrumentation({
      ignoreRequestHook: (request: UndiciRequest) => isUntracedPath(request.path),
    }),
  ];
}

function isUntracedPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0];
  return UNTRACED_HTTP_PATHS.includes(path);
}

interface ExporterTarget {
  readonly host: string;
  readonly port: string;
}

/** Destino del exportador, para poder reconocer —y no trazar— sus propias peticiones. */
function parseExporterTarget(endpoint: string | undefined): ExporterTarget | undefined {
  if (endpoint === undefined) return undefined;
  try {
    const url = new URL(endpoint);
    return { host: url.hostname, port: url.port };
  } catch {
    // Un endpoint ilegible ya lo señala el exportador al arrancar; aquí sólo significa que no
    // se puede excluir por destino, nunca un fallo de arranque.
    return undefined;
  }
}

/** `RequestOptions` de Node admite `null` en host y hostname, de ahí la firma ancha. */
function isExporterRequest(
  request: {
    host?: string | null;
    hostname?: string | null;
    port?: number | string | null;
    path?: string | null;
  },
  target: ExporterTarget | undefined,
): boolean {
  if (target === undefined) return false;
  const host = request.hostname ?? request.host ?? '';
  const port = String(request.port ?? '');
  return host.split(':')[0] === target.host && (target.port === '' || port === target.port);
}
