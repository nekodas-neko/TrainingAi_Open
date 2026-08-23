import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Q-324 — `scripts/local-db/migrate.js` must record what it applied in `schema_migrations`.
 *
 * `ensureSchema()` reads that table to decide what to skip. When the runner wrote nothing there, a
 * database it had just fully migrated looked **empty** to `ensureSchema()`, so the next process
 * re-applied all ~200 files — and under `vitest` that is every worker doing it at once against one
 * Postgres. **CI runs this exact script** before `pnpm test` (`.github/workflows/ci.yml`, "Apply all
 * migrations"), so CI was in that state on every run.
 *
 * **What this test can and cannot prove.** It asserts on the runner's source, not its behaviour —
 * proving the behaviour needs a scratch database and ~200 migrations, which is a slow fixture the
 * suite does not have. So it catches the regression that actually happened (the bookkeeping being
 * dropped) and would not catch a subtler one, such as recording a file that failed. The second is
 * guarded by reading the code, and by the comment in the runner saying why.
 */
describe('local migration runner bookkeeping (Q-324)', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/local-db/migrate.js'), 'utf-8')

  it('creates the table ensureSchema expects', () => {
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS schema_migrations/)
  })

  it('records each applied file', () => {
    expect(src).toMatch(/INSERT INTO schema_migrations \(filename\) VALUES \(\$1\)/)
  })

  it('skips files already recorded, so a re-run is not a full re-apply', () => {
    expect(src).toMatch(/SELECT filename FROM schema_migrations/)
    expect(src).toMatch(/applied\.has\(file\)/)
  })

  it('records only inside the success path — a failed migration must stay retryable', () => {
    // The INSERT has to sit above the `catch`, i.e. inside the `try`. Recording a failure would
    // make `ensureSchema()` skip it forever, which is worse than the problem being fixed.
    const insertAt = src.indexOf('INSERT INTO schema_migrations')
    const catchAt = src.indexOf('} catch (err) {', src.indexOf('try {'))
    expect(insertAt).toBeGreaterThan(0)
    expect(insertAt).toBeLessThan(catchAt)
  })
})
