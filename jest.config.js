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
  // También en JSON: `coverage-summary.json` es lo que permite comparar una corrida con la
  // anterior sin volver a parsear el lcov.
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  // Suelo, no objetivo. CI ejecutaba `test:cov` sin ninguna puerta, así que la cobertura
  // podía caer indefinidamente sin que nadie se enterara. El umbral se fija JUSTO por debajo
  // de lo medido hoy para que el pipeline entre en verde y a partir de aquí solo pueda
  // subirse: cada vez que suba de verdad, se sube también este número.
  // Los umbrales por ruta SACAN esos archivos del cómputo global, así que el número global
  // es el del resto del código y no coincide con el resumen que imprime la corrida.
  coverageThreshold: {
    global: { lines: 47, branches: 43, functions: 46, statements: 47 },
    // El núcleo de la decisión se mide aparte y más alto: es donde un hueco de cobertura
    // significa una decisión sin verificar, no una pantalla sin probar.
    './src/modules/graph/': { lines: 70, branches: 65, functions: 70, statements: 70 },
    './src/common/security/': { lines: 65, branches: 55, functions: 60, statements: 65 },
  },
  testEnvironment: 'node',
  // Integration suites talk to local Postgres and spawn child processes; on a loaded dev
  // machine their hooks routinely exceed jest's 5s default without anything being wrong.
  testTimeout: 30000
};
