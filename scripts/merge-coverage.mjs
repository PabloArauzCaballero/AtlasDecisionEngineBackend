#!/usr/bin/env node
/**
 * Une la cobertura de las dos baterías en un solo informe.
 *
 * Por qué hace falta: el proyecto tiene DOS configuraciones de Jest —unitaria/integración y
 * e2e— y cada una mide por su cuenta. Medir solo la primera hacía que los controladores
 * apareciesen al 10% y los módulos de Nest al 0%, no porque nadie los ejercite, sino porque
 * quien los ejercita es la batería que no se estaba midiendo. El número resultante no describía
 * el repositorio: describía una de sus mitades.
 *
 * Istanbul sabe sumar dos mapas de cobertura del mismo fichero (`CoverageMap.merge`), así que
 * la unión es exacta: una línea cubierta por un e2e y por una unitaria se cuenta una vez.
 *
 * Uso: node scripts/merge-coverage.mjs coverage/coverage-final.json coverage-e2e/coverage-final.json
 * Escribe el informe combinado en `coverage-merged/`.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  process.stderr.write('Uso: merge-coverage.mjs <coverage-final.json> [...]\n');
  process.exit(1);
}

/**
 * Solo `src/`.
 *
 * La configuración e2e no declara `collectCoverageFrom`, así que instrumenta todo lo que
 * carga —incluidos los ayudantes de `test/e2e/support/`—. Sumarlos mezclaría el código de
 * prueba con el código medido y el porcentaje dejaría de significar nada. La batería
 * unitaria ya se limita a `src/**` por configuración; esto aplica el mismo recorte al otro
 * informe en vez de exigir que ambas configuraciones lo repitan.
 */
const SRC = resolve('src');
const esCodigoDeProduccion = (file) => resolve(file).startsWith(SRC);

const map = libCoverage.createCoverageMap({});
let usados = 0;
for (const input of inputs) {
  const path = resolve(input);
  if (!existsSync(path)) {
    // Falta una de las dos: se avisa y se sigue. Bloquear aquí obligaría a correr siempre la
    // batería e2e —que necesita base de datos y Redis— para poder ver la cobertura unitaria.
    process.stderr.write(`aviso: no existe ${input}, se omite\n`);
    continue;
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const soloSrc = Object.fromEntries(
    Object.entries(raw).filter(([file]) => esCodigoDeProduccion(file)),
  );
  if (Object.keys(soloSrc).length === 0) {
    // Un informe sin un solo fichero bajo `src/` es siempre un error de operación —quedó de
    // otra corrida, o de otra ruta de trabajo—, y unirlo en silencio produce un porcentaje
    // que parece bueno y no describe nada. Pasó de verdad: `coverage-final.json` no se
    // regeneraba porque el reporter `json` no estaba activado.
    process.stderr.write(
      `error: ${input} no contiene ningún fichero de ${SRC}; probablemente es de otra corrida\n`,
    );
    process.exit(1);
  }
  map.merge(soloSrc);
  usados += 1;
}
if (usados === 0) {
  process.stderr.write('No había ningún informe de cobertura que unir.\n');
  process.exit(1);
}

const dir = resolve('coverage-merged');
mkdirSync(dir, { recursive: true });
const context = libReport.createContext({ dir, coverageMap: map });
for (const name of ['text-summary', 'json-summary', 'lcov']) {
  reports.create(name === 'json-summary' ? 'json-summary' : name, {}).execute(context);
}

const total = map.getCoverageSummary();
process.stdout.write(
  `\nCobertura combinada (${usados} informe(s)): ` +
    `líneas ${total.lines.pct}% · sentencias ${total.statements.pct}% · ` +
    `ramas ${total.branches.pct}% · funciones ${total.functions.pct}%\n`,
);
