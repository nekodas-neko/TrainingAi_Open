// LB-177 — a probe-database test must build its URLs with `withDatabase`, which handles the
// Unix-socket form `setup.sh` writes. `new URL()` throws on that form, and the file then FAILS while
// its tests read as skipped, so `pnpm test` exits 1 with nothing failing.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { withDatabase } from './migration-test-lock'

describe('withDatabase (LB-177)', () => {
  it('swaps the database on a TCP URL', () => {
    expect(withDatabase('postgresql://postgres:postgres@localhost:5434/trainingai_lane_a', 'postgres'))
      .toBe('postgresql://postgres:postgres@localhost:5434/postgres')
  })

  it('swaps it on the Unix-socket URL setup.sh writes, keeping the socket parameters', () => {
    expect(withDatabase('postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433', 'la143_probe'))
      .toBe('postgresql://postgres:postgres@/la143_probe?host=/tmp&port=5433')
  })

  it('keeps a query string on a TCP URL', () => {
    expect(withDatabase('postgresql://u:p@db.local:5432/app?sslmode=disable', 'x'))
      .toBe('postgresql://u:p@db.local:5432/x?sslmode=disable')
  })
})

describe('probe-database tests do not rewrite the URL with new URL() (LB-177)', () => {
  it('no test in this directory sets url.pathname', () => {
    const dir = join(process.cwd(), 'lib/data/postgres/__tests__')
    const offenders = readdirSync(dir)
      .filter(f => f.endsWith('.test.ts'))
      .filter(f => /\.pathname\s*=/.test(readFileSync(join(dir, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
