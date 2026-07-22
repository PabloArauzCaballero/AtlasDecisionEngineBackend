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
  testEnvironment: 'node',
  // Integration suites talk to local Postgres and spawn child processes; on a loaded dev
  // machine their hooks routinely exceed jest's 5s default without anything being wrong.
  testTimeout: 30000
};
