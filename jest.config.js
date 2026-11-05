/**
 * jira-bff: Jest Configuration
 * Enforces >= 60.0% code coverage threshold across statements, branches, functions, and lines.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/graphql/dto/**',
    '!src/graphql/models/**',
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json', 'json-summary'],
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      statements: 60.0,
      branches: 60.0,
      functions: 60.0,
      lines: 60.0,
    },
  },
};
