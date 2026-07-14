import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,          // enables describe, test, expect without imports
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
