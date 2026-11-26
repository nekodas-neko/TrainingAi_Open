import { defineConfig } from 'vitest/config'

// Runs ONLY the fixtures beside it, with the real guard as the global setup, for
// scripts/__tests__/vitest-catalogue-leak-guard-runs.test.ts (#4109). `pnpm test` never reaches
// these files: they are `*.fixture.ts`, not `*.test.ts`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/__fixtures__/leak-guard/*.fixture.ts'],
    globalSetup: [process.env.LEAK_GUARD_FILE ?? './scripts/vitest-catalogue-leak-guard.ts'],
    testTimeout: 60_000,
  },
})
