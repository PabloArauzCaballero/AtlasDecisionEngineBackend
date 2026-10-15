#!/usr/bin/env node
/**
 * Espeja en `docs/` las reglas de diseño y las skills que hoy solo viven en `.claude/`.
 *
 * `.claude/rules/**` y `.claude/skills/**` son la fuente canónica: la herramienta de asistencia
 * las carga por ruta y por nombre, así que moverlas rompería su carga. Pero su contenido —qué
 * arquitectura, seguridad, datos y pruebas se exigen a este backend— es documentación de diseño
 * de pleno derecho, y una carpeta oculta no es un lugar donde alguien la busque.
 *
 * Copiar a mano crearía dos verdades que se separan en silencio. Por eso el espejo se genera:
 *
 *   docs/design-rules/<regla>.md  ←  .claude/rules/<regla>.md
 *   docs/skills/<skill>.md        ←  .claude/skills/<skill>/SKILL.md
 *
 * Con `--check` no escribe: compara y falla si el espejo quedó atrás. Ese modo es el que corre
 * en `yarn docs:validate`, de forma que editar una regla sin regenerar rompa el gate en vez de
 * publicar una página obsoleta.
 *
 *   node scripts/docs/generate-vault.mjs           # regenera
 *   node scripts/docs/generate-vault.mjs --check   # verifica sin escribir
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const claudeRoot = join(repoRoot, '.claude');
const docsRoot = join(repoRoot, 'docs');
const checkOnly = process.argv.includes('--check');

const BANNER = (source) =>
  `<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.\n` +
  `     Fuente: ${source}. Ejecute \`yarn docs:vault\` tras cambiarla. -->`;

/** Etiquetas de Obsidian por regla. Sin acentos: una etiqueta se escribe, no se lee. */
const RULE_TAGS = {
  '00': 'gobernanza',
  10: 'arquitectura',
  20: 'clean-code',
  30: 'seguridad',
  40: 'observabilidad',
  50: 'rendimiento',
  60: 'pruebas',
  70: 'dependencias',
  80: 'datos',
  90: 'documentacion',
};

/**
 * Separa el frontmatter YAML del cuerpo. No se usa un parser de YAML: el único campo que
 * interesa es `paths`, una lista de cadenas entre comillas, y añadir una dependencia para eso
 * sería desproporcionado (ver `.claude/rules/70-library-selection.md`).
 */
function splitFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: '', body: raw.trim() };
  return { meta: match[1], body: raw.slice(match[0].length).trim() };
}

const metaField = (meta, field) => meta.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))?.[1]?.trim();

const metaList = (meta, field) => {
  const block = meta.split(new RegExp(`^${field}:\\s*$`, 'm'))[1];
  if (!block) return [];
  const items = [];
  for (const line of block.split('\n')) {
    // El salto de línea que sigue a `paths:` deja una primera entrada vacía; no es el final
    // de la lista.
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s*(.+)$/);
    if (!item) break;
    items.push(item[1].trim().replace(/^["']|["']$/g, ''));
  }
  return items;
};

/** Extrae el `# Título` del cuerpo y devuelve el resto, para poder insertar la ficha debajo. */
function splitTitle(body) {
  const lines = body.split('\n');
  const index = lines.findIndex((line) => line.startsWith('# '));
  if (index === -1) return { title: null, rest: body };
  return {
    title: lines[index].slice(2).trim(),
    rest: lines.slice(index + 1).join('\n').trim(),
  };
}

/**
 * El título va entre comillas: un `:` o un `#` en un título de regla convertiría el frontmatter
 * en YAML inválido, y `JSON.stringify` produce exactamente un escalar de comillas dobles válido.
 */
const frontmatter = (title, tags) =>
  ['---', `title: ${JSON.stringify(title)}`, 'tags:', ...tags.map((tag) => `  - ${tag}`), '---'].join(
    '\n',
  );

const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();

const code = (values) => values.map((value) => `\`${value}\``).join(' · ');

// ---------------------------------------------------------------------------
// Reglas de diseño
// ---------------------------------------------------------------------------
async function collectRules() {
  const directory = join(claudeRoot, 'rules');
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();
  const rules = [];
  for (const name of names) {
    const source = `.claude/rules/${name}`;
    const { meta, body } = splitFrontmatter(await readFile(join(directory, name), 'utf8'));
    const { title, rest } = splitTitle(body);
    rules.push({
      name,
      source,
      slug: name.replace(/\.md$/, ''),
      prefix: name.slice(0, 2),
      title: title ?? name,
      paths: metaList(meta, 'paths'),
      body: rest,
    });
  }
  return rules;
}

function renderRule(rule) {
  const scope = rule.paths.length
    ? `Se aplica al editar ${code(rule.paths)}.`
    : 'Se aplica a todo el repositorio, sin restricción de ruta.';
  const loading = rule.paths.length
    ? 'la herramienta de asistencia carga la regla automáticamente al tocar esas rutas'
    : 'la herramienta de asistencia carga la regla en toda sesión sobre este repositorio';
  return [
    frontmatter(rule.title, ['reglas-de-diseno', RULE_TAGS[rule.prefix] ?? 'general']),
    BANNER(rule.source),
    '',
    `# ${rule.title}`,
    '',
    '!!! abstract "Ficha de la regla"',
    `    **Fuente canónica:** \`${rule.source}\` — esta página es su espejo generado.`,
    '',
    `    **Alcance:** ${scope}`,
    '',
    `    **Cómo se aplica:** ${loading}; una persona la aplica en revisión de código. La regla`,
    '    no sustituye a las pruebas ni a los controles de CI.',
    '',
    rule.body,
    '',
  ].join('\n');
}

function renderRulesIndex(rules) {
  const rows = rules.map(
    (rule) =>
      `| [${cell(rule.title)}](${rule.slug}.md) | \`${rule.name}\` | ` +
      `${rule.paths.length ? code(rule.paths) : 'todo el repositorio'} |`,
  );
  return [
    frontmatter('Reglas de diseño', ['reglas-de-diseno', 'indice']),
    BANNER('.claude/rules/'),
    '',
    '# Reglas de diseño',
    '',
    'Estas reglas fijan qué se considera un cambio aceptable en este backend: precedencia de',
    'requisitos, forma de los módulos NestJS, invariantes de seguridad, uso de Prisma y',
    'PostgreSQL, evidencia exigida a una prueba y criterios para incorporar una dependencia.',
    'A nivel de negocio protegen las garantías que la plataforma promete —decisiones',
    'reproducibles, aisladas por tenant y auditables—; a nivel de sistema evitan que cada',
    'contribución reinvente una convención ya resuelta.',
    '',
    '!!! warning "Páginas generadas"',
    '    La fuente canónica vive en `.claude/rules/`, porque la herramienta de asistencia las',
    '    carga desde ahí por ruta de archivo. Estas páginas son un espejo: edite la regla en su',
    '    origen y ejecute `yarn docs:vault`. `yarn docs:validate` falla si el espejo se separa',
    '    de la fuente.',
    '',
    '| Regla | Archivo fuente | Alcance |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '## Cómo se relacionan con el resto de la documentación',
    '',
    'Una regla dice *qué exigir*; el documento de dominio dice *cómo está construido*. Cuando',
    'ambos hablan del mismo tema, el orden de precedencia es el de',
    '[gobernanza](00-governance.md): requisitos aprobados, luego contratos y migraciones',
    'vigentes, luego el código y sus pruebas, y solo al final un supuesto documentado.',
    '',
    '- Seguridad → [arquitectura de seguridad](../security/security-architecture.md) ·',
    '  [aislamiento por tenant](../security/tenant-isolation.md)',
    '- Datos → [arquitectura de datos](../data/data-architecture.md) ·',
    '  [migraciones](../data/migrations.md)',
    '- Pruebas → [estrategia de pruebas](../testing/strategy.md)',
    '- Documentación → [política de documentación](../governance/documentation-policy.md)',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
async function collectSkills() {
  const directory = join(claudeRoot, 'skills');
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const skills = [];
  for (const name of entries) {
    const source = `.claude/skills/${name}/SKILL.md`;
    const raw = await readFile(join(directory, name, 'SKILL.md'), 'utf8');
    const { meta, body } = splitFrontmatter(raw);
    const { title, rest } = splitTitle(body);
    skills.push({
      name: metaField(meta, 'name') ?? name,
      source,
      slug: name,
      title: title ?? name,
      description: metaField(meta, 'description') ?? '',
      body: rest,
    });
  }
  return skills;
}

function renderSkill(skill) {
  return [
    frontmatter(skill.title, ['skills', 'entorno-asistido']),
    BANNER(skill.source),
    '',
    `# ${skill.title}`,
    '',
    '!!! abstract "Ficha de la skill"',
    `    **Invocación:** \`${skill.name}\` · **Fuente canónica:** \`${skill.source}\``,
    '',
    `    **Descripción registrada:** ${skill.description}`,
    '',
    '    **Naturaleza:** es un procedimiento, no una autorización. No habilita tocar producción,',
    '    publicar cambios ni reiniciar datos.',
    '',
    skill.body,
    '',
  ].join('\n');
}

function renderSkillsIndex(skills) {
  // El título de cada skill repite «— Atlas Decision Engine (backend)»; en una tabla de este
  // repositorio eso es ruido, así que la celda usa solo lo que va antes del guion largo.
  const rows = skills.map(
    (skill) =>
      `| [${cell(skill.title.split('—')[0].trim())}](${skill.slug}.md) | \`${skill.name}\` | ` +
      `${cell(skill.description)} |`,
  );
  return [
    frontmatter('Skills del proyecto', ['skills', 'entorno-asistido', 'indice']),
    BANNER('.claude/skills/'),
    '',
    '# Skills del proyecto',
    '',
    'Una skill es un procedimiento repetible escrito una sola vez: qué fuentes leer, en qué',
    'fases avanzar, qué comandos están permitidos, qué evidencia hay que dejar y cuándo',
    'detenerse. Su valor de negocio es que la revisión de un cambio no dependa de quién la haga;',
    'su valor de sistema es que los gates y las invariantes que protegen la plataforma se',
    'ejecuten siempre en el mismo orden y con la misma exigencia de prueba.',
    '',
    '| Skill | Nombre de invocación | Cuándo usarla |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '!!! warning "Páginas generadas"',
    '    La fuente canónica vive en `.claude/skills/<skill>/SKILL.md`. Estas páginas son su',
    '    espejo: edite la skill en su origen y ejecute `yarn docs:vault`.',
    '',
    '## Qué NO es una skill',
    '',
    'Ninguna de estas skills concede permisos. Las prohibiciones de',
    '[gobernanza](../design-rules/00-governance.md) siguen vigentes durante su ejecución:',
    'nada de `git push`, `prisma migrate reset`, borrado de datos, acceso a producción ni uso',
    'de secretos sin aprobación explícita. Una skill que exige evidencia tampoco la sustituye:',
    'un `PASS` sin la salida real del gate no es un `PASS`.',
    '',
    'El catálogo de skills provistas por el entorno —las que no viven en este repositorio y por',
    'tanto no están versionadas con él— se explica en',
    '[skills del entorno](entorno.md).',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
async function emit(relativePath, content) {
  const target = join(docsRoot, relativePath);
  if (checkOnly) {
    let current = null;
    try {
      current = await readFile(target, 'utf8');
    } catch {
      return { relativePath, status: 'falta' };
    }
    return current === content
      ? { relativePath, status: 'ok' }
      : { relativePath, status: 'desactualizado' };
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  return { relativePath, status: 'escrito' };
}

async function main() {
  const rules = await collectRules();
  const skills = await collectSkills();

  const results = [
    await emit('design-rules/index.md', renderRulesIndex(rules)),
    ...(await Promise.all(
      rules.map((rule) => emit(`design-rules/${rule.slug}.md`, renderRule(rule))),
    )),
    await emit('skills/index.md', renderSkillsIndex(skills)),
    ...(await Promise.all(
      skills.map((skill) => emit(`skills/${skill.slug}.md`, renderSkill(skill))),
    )),
  ];

  const stale = results.filter((result) => result.status !== 'ok' && result.status !== 'escrito');
  console.log(
    `Espejo de la bóveda: ${rules.length} reglas · ${skills.length} skills · ` +
      `${results.length} páginas ${checkOnly ? 'verificadas' : 'generadas'}.`,
  );
  if (checkOnly && stale.length) {
    console.error('\nPáginas fuera de sincronía con `.claude/` (ejecute `yarn docs:vault`):');
    console.error(stale.map((result) => `- ${result.relativePath} (${result.status})`).join('\n'));
    process.exitCode = 1;
  } else if (checkOnly) {
    console.log('El espejo coincide con la fuente canónica.');
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
