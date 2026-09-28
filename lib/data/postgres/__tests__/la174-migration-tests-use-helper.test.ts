// LA-174 — a migration test that runs its SQL with a bare `pool.query` skips `runMigrationSql`'s
// `LOCK TABLE users IN SHARE MODE`, which is what keeps a table-wide data migration from interleaving
// with the rest of the suite's user deletes (DV-3). `planned-pct-bodyweight-migration.test.ts` did
// exactly that and deadlocked under the full suite on 2026-09-28, passing alone; eight files had the
// same bare call. The advisory lock those files take serialises migrations against EACH OTHER only.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'lib/data/postgres/__tests__')

describe('migration tests run their SQL through runMigrationSql (LA-174)', () => {
  it('no file that takes the migration lock runs migration SQL with a bare pool.query', () => {
    const offenders = readdirSync(DIR)
      .filter(f => f.endsWith('.test.ts'))
      .filter(f => {
        const src = readFileSync(join(DIR, f), 'utf8')
        return /migrationTestLock/.test(src) && /pool\.query\(\s*migrationSql\(\)\s*\)/.test(src)
      })
    expect(offenders).toEqual([])
  })
})
