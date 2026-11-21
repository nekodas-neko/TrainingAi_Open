/**
 * The seeded local user's credentials, seeded by `scripts/local-db/seed.sql`.
 *
 * Its own module, with no imports, so that a plain Node script can read it too: the route smoke
 * (`scripts/ci/route-smoke.mjs`) signs in as this user without loading Playwright. `fixtures.ts`
 * re-exports both names, so specs keep importing them from there.
 */
export const SEED_EMAIL = 'test@local.dev'
export const SEED_PASSWORD = 'testpass123'
