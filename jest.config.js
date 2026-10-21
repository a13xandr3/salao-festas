const { createCjsPreset } = require('jest-preset-angular/presets');

module.exports = {
  ...createCjsPreset(),
  transform: {
    '^.+/node_modules/@angular/ssr/.+\\.mjs$': ['ts-jest', { tsconfig: { allowJs: true, esModuleInterop: true, module: 'CommonJS', target: 'ES2022', isolatedModules: true } }],
    ...createCjsPreset().transform,
  },
  transformIgnorePatterns: ['node_modules/(?!(.*\\.mjs$|@angular/common/locales/.*\\.js$|@angular/ssr/third_party/.*\\.js$))'],
  setupFilesAfterEnv: ['<rootDir>/src/setup-jest.ts'],
  testMatch: ['<rootDir>/**/*.spec.ts'],
  collectCoverageFrom: [
    'src/app/**/*.ts',
    '!src/app/**/*.spec.ts',
    '!src/app/testing/**',
  ],
  coverageReporters: ['text', 'html', 'json', 'json-summary', 'lcov'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  }
};
