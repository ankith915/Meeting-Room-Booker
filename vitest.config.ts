import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Unit tests are pure (Constitution IV) and need no environment.
    // Integration and concurrency tests need DATABASE_URL, loaded from .env.local.
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],

    // EC-001 fires many requests at once and asserts a stored row count.
    // Running concurrency specs in parallel with other suites would let an
    // unrelated test's writes pollute that count, so files run one at a time.
    fileParallelism: false,

    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
