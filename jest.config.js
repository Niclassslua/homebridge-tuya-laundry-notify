/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: [
    '/node_modules/',
    'test/platform.test.ts',
    'test/lib/pushGateway.test.ts',
    'test/lib/laundryDevice.test.ts',
    'test/lib/laundryDeviceTracker.test.ts',
  ],
};