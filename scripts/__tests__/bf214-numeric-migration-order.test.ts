// BF-214 ② — migrations apply in LEADING-INTEGER order, so a timestamp-named migration
// (`202609280612_x.sql`) runs after every `NNN_` one instead of before all of them, which is what a
// string sort does ('0' < '8'). Both appliers carry the sorter; this holds them to one order, and
// holds that order to the one production has already applied.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { sortMigrationFiles } from '@/lib/data/postgres/client'

const require = createRequire(import.meta.url)
const { sortMigrationFiles: scriptSort } = require('../local-db/migrate.js')
const { surveyClaims, minuteStamp } = require('../lib/migration-claims.js')

const onDisk = readdirSync(join(process.cwd(), 'lib/data/postgres/migrations')).filter(f => f.endsWith('.sql'))

describe('migration apply order (BF-214 ②)', () => {
  it('leaves every numbered migration exactly where a string sort put it, and runs every timestamped one after them', () => {
    // The `NNN_` files are what production applied under the old string sort, so their order must
    // not move. Timestamped files (BF-214 ②) sort after all of them.
    const sorted = sortMigrationFiles(onDisk)
    const numbered = onDisk.filter(f => /^\d{3}_/.test(f))
    expect(sorted.slice(0, numbered.length)).toEqual([...numbered].sort())
    expect(sorted.slice(numbered.length).every(f => /^\d{12}_/.test(f))).toBe(true)
  })

  it('puts a timestamp-named migration after every numbered one, and orders timestamps by time', () => {
    const files = ['202610010900_b.sql', '296_normalise_emails.sql', '202609280612_a.sql', '001_initial.sql', '289_y.sql']
    expect(sortMigrationFiles(files)).toEqual([
      '001_initial.sql', '289_y.sql', '296_normalise_emails.sql', '202609280612_a.sql', '202610010900_b.sql',
    ])
  })

  it('breaks a tie on the number by filename, as production applied the grandfathered pairs', () => {
    expect(sortMigrationFiles(['081_z.sql', '081_a.sql'])).toEqual(['081_a.sql', '081_z.sql'])
  })

  it('both appliers order their directory listing through it', () => {
    for (const f of ['lib/data/postgres/client.ts', 'scripts/local-db/migrate.js']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src, f).toMatch(/files = sortMigrationFiles\(readdirSync\(migrationsDir\)/)
      expect(src, f).not.toMatch(/readdirSync\(migrationsDir\)[^\n]*\.sort\(\)/)
    }
  })

  it('ensureSchema and migrate.js agree', () => {
    const mixed = [...onDisk, '202609280612_a.sql', '202609280611_b.sql', '081_zz.sql']
    expect(scriptSort(mixed)).toEqual(sortMigrationFiles(mixed))
  })
})

describe('the next migration prefix is a UTC minute (BF-214 ②)', () => {
  const now = new Date('2026-09-28T06:12:34Z')

  it('formats YYYYMMDDHHMM in UTC', () => {
    expect(minuteStamp(now)).toBe('202609280612')
    expect(minuteStamp(new Date('2026-01-02T03:04:00Z'))).toBe('202601020304')
  })

  it('hands out this minute', () => {
    expect(surveyClaims(['296_x.sql'], [], 289, now).next).toBe('202609280612')
  })

  it('goes one past a claim already on this minute, so two runs never share a prefix', () => {
    const { next } = surveyClaims(['296_x.sql'], [{ ref: 'origin/other', files: ['202609280612_other.sql'] }], 289, now)
    expect(next).toBe('202609280613')
  })

  it('keeps the old sequential answer when no clock is passed', () => {
    expect(surveyClaims(['296_x.sql'], [], 289).next).toBe('297')
  })
})
