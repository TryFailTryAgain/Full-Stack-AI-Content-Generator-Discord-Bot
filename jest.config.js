module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterSetup: ['./tests/setup.js'],
  // Load env before anything
  globalSetup: './tests/globalSetup.js',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/examples/',
    '/Outputs/',
  ],
  // Show individual test results
  verbose: true,
  // Timeout for each test (15 seconds for mock, 60 seconds for live)
  testTimeout: process.env.LIVE_API === 'true' ? 60000 : 15000,
};
