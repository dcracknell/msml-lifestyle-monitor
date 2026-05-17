module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/tests/test-env.js'],
  testMatch: ['**/src/**/*.test.js'],
  modulePathIgnorePatterns: ['<rootDir>/ppg_glucose/.venv/'],
  testPathIgnorePatterns: ['<rootDir>/ppg_glucose/.venv/'],
  watchPathIgnorePatterns: ['<rootDir>/ppg_glucose/.venv/'],
  verbose: true,
};
