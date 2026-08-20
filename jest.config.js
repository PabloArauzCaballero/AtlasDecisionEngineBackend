module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  // Loads .env for every spec so the DATABASE_URL-gated integration suites cannot silently
  // skip depending on which database driver they happen to import. See test/setup-env.ts.
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  // `json-summary` para comparar una corrida con la anterior sin reparsear el lcov, y `json`
  // porque `coverage-final.json` es el mapa completo que `scripts/merge-coverage.mjs` une con
  // el de la batería e2e. Sin él ese fichero no se regenera nunca y la unión acaba sumando el
  // mapa de otra corrida —incluso de otra ruta de trabajo— sin avisar.
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'json'],
  // Suelo, no objetivo. CI ejecutaba `test:cov` sin ninguna puerta, así que la cobertura
  // podía caer indefinidamente sin que nadie se enterara. El umbral se fija JUSTO por debajo
  // de lo medido hoy para que el pipeline entre en verde y a partir de aquí solo pueda
  // subirse: cada vez que suba de verdad, se sube también este número.
  // Los umbrales por ruta SACAN esos archivos del cómputo global, así que el número global
  // es el del resto del código y no coincide con el resumen que imprime la corrida.
  coverageThreshold: {
    global: { lines: 49, branches: 45, functions: 49, statements: 49 },
    // El núcleo de la decisión se mide aparte y mucho más alto: es donde un hueco de
    // cobertura significa una decisión sin verificar, no una pantalla sin probar.
    './src/modules/graph/': { lines: 89, branches: 77, functions: 93, statements: 88 },
    './src/common/security/': { lines: 74, branches: 57, functions: 71, statements: 70 },
  },
  testEnvironment: 'node',
  // Integration suites talk to local Postgres and spawn child processes; on a loaded dev
  // machine their hooks routinely exceed jest's 5s default without anything being wrong.
  testTimeout: 30000
};
