import { defineConfig } from 'vitest/config'
import path from 'path'
import fs from 'node:fs'

const alias = { '@': path.resolve(__dirname, '.') }

/**
 * Test files that run a full `aggregateOuraRawSamples` pass — decode, stage, roll up, write.
 *
 * Measured alone on 2026-08-05 with zero contention, these take **3.4 s to 14.6 s** of test time
 * against vitest's default 5000 ms. Three of them sat within 20% of that limit and timed out under
 * the parallel suite, which is why CLAUDE.md had to instruct every session to re-run them before
 * believing a red CI — and why they produced four false alarms in a single session.
 *
 * They are legitimately heavy, not accidentally slow: the daytime-HRV refit added in v1.259.1 was
 * the obvious suspect and was measured out (stubbing it changes the timings by less than noise).
 * So they get a timeout matched to what they actually cost.
 *
 * Deliberately NOT a raised global timeout — the other ~380 files stay at 5 s so a genuine hang
 * still fails fast. Keep this glob in step with
 * `grep -rl aggregateOuraRawSamples lib/data/postgres/__tests__/`.
 */
const ROLLUP_TESTS =
  'lib/data/postgres/__tests__/{oura-ble-*,oura-hrv-median-rollup,oura-illness-persist,sleep-oura-id-user-scope}.test.ts'

/**
 * Where tests read model constants from: the vendor's when this machine has them, synthetic fixtures
 * otherwise (Q-49 A4b). Set here rather than in a setup file so it lands before any module
 * evaluates — two ports read a constant at module scope, so a per-test hook is already too late.
 *
 * **Fixtures are the fallback, not the default, and that is a reversal worth recording.** The first
 * design pointed every test at the fixtures unconditionally, on the reasoning that local and CI
 * should not diverge. Measuring the suite killed it: eighteen files are golden/parity tests pinned to
 * the vendor's own forward pass (`matches all 19 outputs within 1e-3`), and a synthetic table makes
 * those assertions arbitrary rather than merely different. Forcing them to opt out would have meant
 * a hoisted block in fifteen files that every future parity test must remember.
 *
 * The divergence that argument was protecting against does not survive either: a parity test cannot
 * run in CI under *any* design, because CI has nothing to check parity against. So the tests that do
 * run in both places are exactly the ones insensitive to the values — divergence is harmless for
 * them by construction.
 *
 * Regenerate the fixtures with `node scripts/generate-test-constants.js`.
 */
const REAL_CONSTANTS_DIR = path.resolve(__dirname, 'lib/oura-models/constants')
const CONSTANTS_DIR = fs.existsSync(path.join(REAL_CONSTANTS_DIR, 'MANIFEST.json'))
  ? REAL_CONSTANTS_DIR
  : path.resolve(__dirname, 'lib/oura-models/__fixtures__/constants')

export default defineConfig({
  resolve: { alias },
  test: {
    env: { OURA_CONSTANTS_DIR: CONSTANTS_DIR },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'rollup',
          environment: 'node',
          env: { OURA_CONSTANTS_DIR: CONSTANTS_DIR },
          include: [ROLLUP_TESTS],
          // 4x the slowest solo measurement (14.6 s). Contention is what tips these over, and the
          // full suite runs them alongside ~380 other files against one shared Postgres.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          env: { OURA_CONSTANTS_DIR: CONSTANTS_DIR },
          // `e2e/**` is Playwright's (`pnpm e2e`), not vitest's. Without this, vitest picks up the
          // browser specs, fails to run them, and reports "1 failed file / 0 failed tests" — the
          // shape that reads like a flaky hook and sends you looking in the wrong place (Q-249).
          exclude: ['**/node_modules/**', '**/.git/**', 'e2e/**', ROLLUP_TESTS],
        },
      },
    ],
  },
})
