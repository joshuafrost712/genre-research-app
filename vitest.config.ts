import { defineConfig } from 'vitest/config'

// Core-logic tests run in Node against fake-indexeddb (imported in the test
// file). No DOM is needed because the tests target the storage/export modules,
// not React components.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
