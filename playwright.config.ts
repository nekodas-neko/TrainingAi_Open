import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'
import { STORAGE_STATE } from './e2e/fixtures'

/**
 * The sandbox ships a Chromium at a fixed path whose build number will not match whatever
 * `@playwright/test` currently pins, and its download is proxy-blocked — so a session cannot run
 * `playwright install`. Use that binary when it is there, and fall back to Playwright's own managed
 * download everywhere else (CI runs `playwright install chromium`, so the default is correct there).
 * Without this, a version bump of @playwright/test silently makes the harness unrunnable in-session.
 */
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium'
const executablePath = existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined

/**
 * Q-249 — the first harness in this repo that actually runs the app.
 *
 * Read `e2e/README.md` before adding a spec. The short version of what this can and cannot prove:
 * it drives the **web** build, where `getLocalStore` returns null, so every offline-first domain
 * takes its web fallback here. It never exercises the device branch, which is the canonical
 * runtime. A green run is evidence about the web path only.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // Serial by default: the specs share one seeded Postgres and one signed-in user, and writes in
  // one spec are visible to another. Parallelism here would buy seconds and cost reproducibility.
  workers: 1,
  fullyParallel: false,
  // A failing assertion in a browser is usually a real defect, not a flake. Retrying locally would
  // hide the ordering bugs this harness exists to catch; CI retries once for genuine startup noise.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    // The S25 Ultra is the canonical target. Testing at a desktop viewport would walk straight past
    // the layout this app is actually built for.
    ...devices['Galaxy S9+'],
    viewport: { width: 412, height: 915 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    // Both setups run before the specs: the seeded user every spec uses by default, and the
    // zero-data account (Q-352) that specs opt into with `test.use({ storageState: … })`.
    { name: 'setup', testMatch: /(auth|zero-data)\.setup\.ts/, use: { launchOptions: { executablePath } } },
    {
      name: 'mobile-chromium',
      dependencies: ['setup'],
      use: { browserName: 'chromium', storageState: STORAGE_STATE, launchOptions: { executablePath } },
    },
  ],
  // `pnpm dev`, deliberately, not `pnpm start`. The pg pool turns SSL on whenever
  // NODE_ENV === 'production' (lib/data/postgres/client.ts:30) and `next start` sets it — so a
  // production server cannot reach the local non-SSL Postgres at all and every request dies with
  // "The server does not support SSL connections", which surfaces as a bare `?error=Configuration`
  // on the sign-in page. Dev also runs React StrictMode, whose double-invoked effects and state
  // updaters are worth having here: this repo's bug history is full of effect-ordering faults.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `pnpm dev --port ${PORT}`,
    url: `${BASE_URL}/api/version`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
