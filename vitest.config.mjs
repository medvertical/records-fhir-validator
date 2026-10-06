
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', globals: true, pool: 'forks', maxWorkers: 2,
    include: ['packages/*/src/**/*.test.*', 'packages/*/src/**/*.spec.*'],
    testTimeout: 10000, hookTimeout: 5000, teardownTimeout: 10000,
  },
  resolve: {
    alias: {
      '@records-fhir/validation-types': fileURLToPath(new URL('./packages/validation-types/src', import.meta.url)),
      '@records-fhir/validator': fileURLToPath(new URL('./packages/validator/src', import.meta.url)),
    },
  },
});
