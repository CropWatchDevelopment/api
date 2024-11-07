module.exports = {
    moduleNameMapper: {
      '^src/(.*)$': '<rootDir>/src/$1',
      '^@supabase/supabase-js$': '<rootDir>/__mocks__/supabase.ts',
    },
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: '.',
    testEnvironment: 'node',
    transform: {
      '^.+\\.(t|j)s$': 'ts-jest',
    },
  };