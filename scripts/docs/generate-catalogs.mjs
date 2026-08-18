#!/usr/bin/env node
/**
 * Genera las páginas del portal que DEBEN seguir al código: catálogo de módulos, de
 * endpoints, de entidades, de eventos, de errores y de configuración.
 *
 * La alternativa —escribirlas a mano— produce documentación que envejece en silencio: una
 * tabla de endpoints copiada queda obsoleta con el primer despliegue y nadie se entera hasta
 * que un integrador se queda bloqueado. Aquí cada página se deriva de una fuente única:
 *
 *   módulos y endpoints ← openapi/openapi.json (generado de los controladores reales)
 *   entidades            ← prisma/schema.prisma
 *   eventos              ← src/common/events/*
 *   errores              ← los DomainException lanzados en src/
 *   configuración        ← src/common/config/env.schema.ts
 *
 * Las páginas llevan un aviso de generación para que nadie las edite a mano y pierda su
 * trabajo en la siguiente ejecución.
 *
 *   node scripts/docs/generate-catalogs.mjs
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const docsRoot = join(repoRoot, 'docs');
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'];

const BANNER = (source) =>
  `<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.\n` +
  `     Fuente: ${source}. Ejecute \`yarn docs:catalog\` tras cambiar el código. -->\n`;

async function readTextFiles(directory, extension) {
  const output = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(extension)) {
        output.push({
          path: full.replace(repoRoot, '').replace(/\\/g, '/').replace(/^\//, ''),
          content: await readFile(full, 'utf8'),
        });
      }
    }
  }
  await walk(directory);
  return output;
}

/** Escapa el carácter que rompería una celda de tabla Markdown. */
const cell = (value) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// Endpoints y módulos, desde el contrato
// ---------------------------------------------------------------------------
async function generateApiCatalog(spec) {
  const byTag = new Map();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!HTTP_METHODS.includes(method)) continue;
      for (const tag of operation.tags ?? ['(sin etiqueta)']) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag).push({ path, method: method.toUpperCase(), operation });
      }
    }
  }

  const tagDescriptions = new Map((spec.tags ?? []).map((tag) => [tag.name, tag.description]));
  const lines = [
    BANNER('openapi/openapi.json'),
    '# Catálogo de endpoints',
    '',
    `Contrato **${spec.info?.version}** · ${Object.keys(spec.paths ?? {}).length} rutas · ` +
      `${[...byTag.values()].reduce((total, list) => total + list.length, 0)} operaciones.`,
    '',
    'La referencia interactiva completa —con esquemas, ejemplos y la posibilidad de probar cada',
    'llamada— está en `/docs/{API_VERSION}/reference` del propio backend. Esta página existe para',
    'buscar y enlazar desde el portal.',
    '',
  ];

  for (const tag of [...byTag.keys()].sort((a, b) => a.localeCompare(b))) {
    lines.push(`## ${tag}`, '');
    const description = tagDescriptions.get(tag);
    if (description) lines.push(description, '');
    lines.push('| Método | Ruta | Operación | Resumen |', '| --- | --- | --- | --- |');
    for (const entry of byTag.get(tag).sort((a, b) => a.path.localeCompare(b.path))) {
      lines.push(
        `| \`${entry.method}\` | \`${entry.path}\` | \`${cell(entry.operation.operationId)}\` | ${cell(entry.operation.summary)} |`,
      );
    }
    lines.push('');
  }
  await writeFile(join(docsRoot, 'api', 'endpoint-catalog.md'), lines.join('\n'), 'utf8');
  return byTag;
}

// ---------------------------------------------------------------------------
// Un módulo, una página
// ---------------------------------------------------------------------------
async function generateModulePages(spec, byTag) {
  const moduleDirectory = join(repoRoot, 'src', 'modules');
  const modules = (await readdir(moduleDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const sources = await readTextFiles(moduleDirectory, '.ts');
  const index = [
    BANNER('src/modules/ y openapi/openapi.json'),
    '# Módulos',
    '',
    'Un módulo por dominio, registrado en `src/app.module.ts`. Cada página se genera del código',
    'real: sus controladores, sus etiquetas de API, sus roles exigidos y sus códigos de error.',
    '',
    '| Módulo | Endpoints | Roles exigidos | Ficheros |',
    '| --- | ---: | --- | ---: |',
  ];

  await mkdir(join(docsRoot, 'modules'), { recursive: true });
  for (const name of modules) {
    const moduleSources = sources.filter((file) => file.path.includes(`src/modules/${name}/`));
    const tags = new Set();
    const roles = new Set();
    const errors = new Set();
    const providers = new Set();
    for (const file of moduleSources) {
      for (const match of file.content.matchAll(/@ApiTags\('([^']+)'\)/g)) tags.add(match[1]);
      for (const match of file.content.matchAll(/@Roles\(([^)]*)\)/g)) {
        for (const role of match[1].matchAll(/'([A-Z_]+)'/g)) roles.add(role[1]);
      }
      for (const match of file.content.matchAll(/new DomainException\(\s*'([A-Z0-9_]+)'/g)) {
        errors.add(match[1]);
      }
      for (const match of file.content.matchAll(/export class (\w+)/g)) providers.add(match[1]);
    }

    const endpoints = [...tags].flatMap((tag) => byTag.get(tag) ?? []);
    const readme = moduleSources.find((file) => file.path.endsWith('README.md'));
    const page = [
      BANNER(`src/modules/${name}/`),
      `# Módulo \`${name}\``,
      '',
      readme?.content ?? '',
      '## Responsabilidad',
      '',
      `Código: [\`src/modules/${name}/\`](https://github.com/) · ${moduleSources.length} ficheros TypeScript.`,
      '',
      tags.size
        ? `Etiquetas de API: ${[...tags].map((tag) => `**${tag}**`).join(', ')}.`
        : 'No expone endpoints HTTP.',
      '',
    ];

    if (endpoints.length) {
      page.push(
        '## Endpoints',
        '',
        '| Método | Ruta | Operación | Resumen |',
        '| --- | --- | --- | --- |',
      );
      for (const entry of endpoints.sort((a, b) => a.path.localeCompare(b.path))) {
        page.push(
          `| \`${entry.method}\` | \`${entry.path}\` | \`${cell(entry.operation.operationId)}\` | ${cell(entry.operation.summary)} |`,
        );
      }
      page.push('');
    }

    page.push('## Autorización', '');
    page.push(
      roles.size
        ? `Roles exigidos por sus rutas: ${[...roles]
            .sort()
            .map((role) => `\`${role}\``)
            .join(', ')}. La decisión es del servidor (\`RolesGuard\`), nunca del frontend.`
        : 'Este módulo no declara roles: o no expone rutas, o son públicas por diseño.',
      '',
    );

    page.push('## Códigos de error propios', '');
    page.push(
      errors.size
        ? [...errors]
            .sort()
            .map((code) => `- \`${code}\``)
            .join('\n')
        : 'No lanza `DomainException` propias.',
      '',
    );

    page.push('## Clases exportadas', '');
    page.push(
      [...providers]
        .sort()
        .map((provider) => `- \`${provider}\``)
        .join('\n') || '—',
      '',
    );

    await writeFile(join(docsRoot, 'modules', `${name}.md`), page.join('\n'), 'utf8');
    index.push(
      `| [\`${name}\`](${name}.md) | ${endpoints.length} | ${[...roles].sort().join(', ') || '—'} | ${moduleSources.length} |`,
    );
  }
  await writeFile(join(docsRoot, 'modules', 'index.md'), `${index.join('\n')}\n`, 'utf8');
  return modules;
}

// ---------------------------------------------------------------------------
// Entidades, desde el esquema de Prisma
// ---------------------------------------------------------------------------
async function generateEntityCatalog() {
  const schema = await readFile(join(repoRoot, 'prisma', 'schema.prisma'), 'utf8');
  const models = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)].map(([, name, body]) => {
    const table = body.match(/@@map\("([^"]+)"\)/)?.[1] ?? name;
    const fields = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//') && !line.startsWith('@@'))
      .map((line) => {
        const [fieldName, type, ...rest] = line.split(/\s+/);
        return { name: fieldName, type, attributes: rest.join(' ') };
      })
      .filter((field) => field.type && /^[A-Za-z]/.test(field.type));
    const indexes = [...body.matchAll(/@@(index|unique)\(([^)]*)\)/g)].map(
      ([, kind, definition]) => `${kind}(${definition.trim()})`,
    );
    const relations = fields.filter((field) => field.attributes.includes('@relation'));
    return { name, table, fields, indexes, relations };
  });

  const lines = [
    BANNER('prisma/schema.prisma'),
    '# Catálogo de entidades',
    '',
    `${models.length} modelos persistentes. El nombre técnico es el de la tabla; el nombre del`,
    'modelo es el que usa el código. Las restricciones e índices son los declarados en el',
    'esquema, que es la fuente que las migraciones aplican.',
    '',
    '| Modelo | Tabla | Campos | Índices | Relaciones |',
    '| --- | --- | ---: | ---: | ---: |',
    ...models
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (model) =>
          `| [\`${model.name}\`](#${model.name.toLowerCase()}) | \`${model.table}\` | ${model.fields.length} | ${model.indexes.length} | ${model.relations.length} |`,
      ),
    '',
  ];

  for (const model of models.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(
      `## ${model.name}`,
      '',
      `Tabla \`${model.table}\`.`,
      '',
      '| Campo | Tipo | Atributos |',
      '| --- | --- | --- |',
      ...model.fields.map(
        (field) => `| \`${field.name}\` | \`${field.type}\` | ${cell(field.attributes) || '—'} |`,
      ),
      '',
    );
    if (model.indexes.length) {
      lines.push(
        'Índices y restricciones:',
        '',
        ...model.indexes.map((entry) => `- \`${entry}\``),
        '',
      );
    }
  }
  await writeFile(join(docsRoot, 'data', 'entity-catalog.md'), `${lines.join('\n')}\n`, 'utf8');
  return models;
}

// ---------------------------------------------------------------------------
// Eventos de dominio
// ---------------------------------------------------------------------------
async function generateEventCatalog() {
  // El catálogo es el objeto `DecisionEventType`: cada entrada es CLAVE: 'valor.publicado'.
  // Se lee de ahí y no de un listado propio para que un evento nuevo aparezca solo.
  const typesFile = await readFile(
    join(repoRoot, 'src', 'common', 'events', 'event-types.ts'),
    'utf8',
  );
  const catalogBody =
    typesFile.match(/export const DecisionEventType = \{([\s\S]*?)\n\} as const;/)?.[1] ?? '';
  const types = [...catalogBody.matchAll(/(\w+):\s*'([^']+)'/g)].map(([, key, value]) => ({
    key,
    value,
  }));

  const sources = await readTextFiles(join(repoRoot, 'src'), '.ts');
  const producers = new Map(types.map((type) => [type.key, new Set()]));
  const consumers = new Map(types.map((type) => [type.key, new Set()]));
  for (const file of sources) {
    if (file.path.includes('src/common/events/event-types.ts')) continue;
    for (const type of types) {
      if (!file.content.includes(`DecisionEventType.${type.key}`)) continue;
      // `publish(` marca a quien lo emite; `on(`/`subscribe(` a quien lo consume. La
      // distinción importa: un evento sin consumidor es trabajo que nadie recoge.
      if (/publish\s*\(/.test(file.content)) producers.get(type.key).add(file.path);
      if (/\b(on|subscribe|handle)\s*\(/.test(file.content)) consumers.get(type.key).add(file.path);
    }
  }

  const lines = [
    BANNER('src/common/events/event-types.ts y src/'),
    '# Catálogo de eventos de dominio',
    '',
    `${types.length} tipos de evento versionados. Todo evento se escribe en la MISMA transacción`,
    'que el cambio de negocio que lo produce (outbox transaccional) y se despacha después; ver',
    '[semántica de entrega](delivery-semantics.md).',
    '',
    'Romper la forma de un payload significa **subir `schemaVersion` en el sobre**, nunca mutar',
    'el tipo existente: hay consumidores que ya procesaron eventos con la forma anterior y la',
    'auditoría los conserva.',
    '',
    '| Evento | Constante | Productor | Consumidor |',
    '| --- | --- | --- | --- |',
    ...types.map(
      (type) =>
        `| \`${type.value}\` | \`DecisionEventType.${type.key}\` | ${[...producers.get(type.key)].map((path) => `\`${path}\``).join('<br>') || '—'} | ${[...consumers.get(type.key)].map((path) => `\`${path}\``).join('<br>') || '—'} |`,
    ),
    '',
  ];
  await writeFile(join(docsRoot, 'events', 'event-catalog.md'), `${lines.join('\n')}\n`, 'utf8');
  return types.map((type) => type.value);
}

// ---------------------------------------------------------------------------
// Códigos de error
// ---------------------------------------------------------------------------
async function generateErrorCatalog() {
  const sources = await readTextFiles(join(repoRoot, 'src'), '.ts');
  const byCode = new Map();
  for (const file of sources) {
    for (const match of file.content.matchAll(
      /new DomainException\(\s*'([A-Z0-9_]+)',\s*(?:`([^`]*)`|'([^']*)')?/g,
    )) {
      const code = match[1];
      if (!byCode.has(code))
        byCode.set(code, { files: new Set(), sample: match[2] ?? match[3] ?? '' });
      byCode.get(code).files.add(file.path);
    }
  }
  const codes = [...byCode.keys()].sort();
  const lines = [
    BANNER('src/**/*.ts (llamadas a new DomainException)'),
    '# Catálogo de códigos de error',
    '',
    `${codes.length} códigos de dominio. Todos viajan en el mismo sobre (\`ProblemDetails\`), con`,
    'el código en `title` y en `error.code`; ver `docs/api/error-model.md`.',
    '',
    '| Código | Mensaje de referencia | Origen |',
    '| --- | --- | --- |',
    ...codes.map((code) => {
      const entry = byCode.get(code);
      return `| \`${code}\` | ${cell(entry.sample) || '—'} | ${[...entry.files][0] ? `\`${[...entry.files][0]}\`` : '—'} |`;
    }),
    '',
  ];
  await writeFile(join(docsRoot, 'api', 'error-catalog.md'), `${lines.join('\n')}\n`, 'utf8');
  return codes;
}

// ---------------------------------------------------------------------------
// Variables de entorno
// ---------------------------------------------------------------------------
async function generateEnvironmentCatalog() {
  const schema = await readFile(join(repoRoot, 'src', 'common', 'config', 'env.schema.ts'), 'utf8');
  const entries = [];
  const lines = schema.split('\n');
  let comment = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) {
      comment.push(trimmed.replace(/^\/\/\s?/, ''));
      continue;
    }
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*):\s*(.*)$/);
    if (match) {
      const definition = match[2];
      const required =
        !/optional\(\)|\.default\(/.test(definition) && !/^optional/.test(definition);
      const defaultValue = definition.match(/\.default\(([^)]*)\)/)?.[1];
      entries.push({
        name: match[1],
        required,
        default: defaultValue,
        description: comment.join(' '),
      });
    }
    if (!trimmed.startsWith('//')) comment = [];
  }

  const out = [
    BANNER('src/common/config/env.schema.ts'),
    '# Variables de entorno',
    '',
    `${entries.length} variables declaradas. El esquema se valida al arrancar: un valor ausente o`,
    'fuera de rango impide el arranque en vez de degradar el comportamiento en caliente.',
    '',
    '| Variable | Obligatoria | Valor por defecto | Para qué |',
    '| --- | --- | --- | --- |',
    ...entries.map(
      (entry) =>
        `| \`${entry.name}\` | ${entry.required ? '**sí**' : 'no'} | ${entry.default ? `\`${cell(entry.default)}\`` : '—'} | ${cell(entry.description) || '—'} |`,
    ),
    '',
  ];
  await writeFile(
    join(docsRoot, 'getting-started', 'environment-variables.md'),
    `${out.join('\n')}\n`,
    'utf8',
  );
  return entries;
}

async function main() {
  const spec = JSON.parse(await readFile(join(repoRoot, 'openapi', 'openapi.json'), 'utf8'));
  for (const directory of ['api', 'data', 'events', 'modules', 'getting-started', 'reports']) {
    await mkdir(join(docsRoot, directory), { recursive: true });
  }

  const byTag = await generateApiCatalog(spec);
  const modules = await generateModulePages(spec, byTag);
  const models = await generateEntityCatalog();
  const events = await generateEventCatalog();
  const errors = await generateErrorCatalog();
  const environment = await generateEnvironmentCatalog();

  const summary = {
  // Sin marca de tiempo a propósito: este JSON está versionado y CI lo regenera para
  // comprobar que no quedó atrás. Un `generatedAt` cambia en cada corrida sin que cambie
  // nada medido, así que el gate no podía pasar nunca y el archivo ensuciaba todos los
  // diffs. Cuándo se generó lo dice el commit que lo trae.
    modules: modules.length,
    endpoints: [...byTag.values()].reduce((total, list) => total + list.length, 0),
    entities: models.length,
    events: events.length,
    errorCodes: errors.length,
    environmentVariables: environment.length,
  };
  await writeFile(
    join(docsRoot, 'reports', 'catalog-metrics.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `Catálogos generados: ${summary.modules} módulos, ${summary.endpoints} endpoints, ` +
      `${summary.entities} entidades, ${summary.events} eventos, ${summary.errorCodes} códigos de error, ` +
      `${summary.environmentVariables} variables de entorno.`,
  );
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
