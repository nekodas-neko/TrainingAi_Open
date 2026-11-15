import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Q-155: removing the `user_id` scope from a live repository read left the whole suite green. The
 * hand-written ownership tests cover specific methods; `scripts/check-repository-user-scoping.js`
 * covers the class — a method that takes `userId` and never uses it.
 *
 * A check nobody has seen fail is a check nobody should trust, so this runs it against a synthetic
 * tree containing one unscoped method and asserts it exits non-zero and names it. The real tree is
 * asserted clean by CI on every PR, which is the other half.
 */

const SCRIPT = join(__dirname, '..', '..', '..', '..', 'scripts', 'check-repository-user-scoping.js')

/** The script walks `lib/data/postgres/{adapter.ts,slices/*.ts}` relative to its own parent, so a
 *  fixture tree needs that shape and its own copy of the script. */
function fixture(adapterSource: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'scoping-check-'))
  mkdirSync(join(dir, 'scripts/lib'), { recursive: true })
  cpSync(join(SCRIPT, '..', 'lib', 'strip-comments.js'), join(dir, 'scripts', 'lib', 'strip-comments.js'))
  mkdirSync(join(dir, 'lib/data/postgres/slices'), { recursive: true })
  cpSync(SCRIPT, join(dir, 'scripts', 'check-repository-user-scoping.js'))
  writeFileSync(join(dir, 'lib/data/postgres/adapter.ts'), adapterSource)
  return dir
}

// A fixture holds a method or two, far under the real tree's floor; each test states its own.
function run(dir: string, minChecked = 0): { code: number; out: string } {
  try {
    const out = execFileSync('node', [join(dir, 'scripts', 'check-repository-user-scoping.js')], {
      encoding: 'utf8', env: { ...process.env, USER_SCOPING_MIN_CHECKED: String(minChecked) },
    })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string }
    return { code: err.status, out: `${err.stdout}${err.stderr}` }
  }
}

describe('check-repository-user-scoping', () => {
  it('fails on a method that takes userId and never uses it', () => {
    const { code, out } = run(fixture(`
export class Repo {
  async getLeakyThing(userId: string): Promise<number[]> {
    const rows = await this.db.select().from(s.bodyMetrics).where(isNotNull(s.bodyMetrics.weightKg))
    return rows.map(r => r.weightKg)
  }
}
`))
    expect(code).toBe(1)
    expect(out).toContain('getLeakyThing')
  })

  it('passes a drizzle-scoped method', () => {
    const { code } = run(fixture(`
export class Repo {
  async getScoped(userId: string): Promise<number[]> {
    const rows = await this.db.select().from(s.bodyMetrics).where(eq(s.bodyMetrics.userId, userId))
    return rows.map(r => r.weightKg)
  }
}
`))
    expect(code).toBe(0)
  })

  it('passes a raw-SQL scoped method and a delegating one', () => {
    const { code } = run(fixture(`
export class Repo {
  async rawScoped(userId: string): Promise<unknown> {
    return this.db.execute(sql\`SELECT 1 FROM body_metrics WHERE user_id = \${userId}\`)
  }
  async delegating(userId: string, id: string): Promise<void> { return prog.doThing(this.db, userId, id) }
}
`))
    expect(code).toBe(0)
  })

  it('is not fooled by a multi-line return type containing braces', () => {
    // The first version of the check matched the brace inside `Promise<{ … }>` as the body start
    // and reported 29 correctly-scoped methods as violations. Pinned so it cannot regress.
    const { code, out } = run(fixture(`
export class Repo {
  async multiLineReturn(userId: string, from: Date): Promise<{
    temp: { tsMs: number }[]
    met: { value: number }[]
  }> {
    const rows = await this.db.select().from(s.raw).where(eq(s.raw.userId, userId))
    return { temp: rows, met: [] }
  }
}
`))
    expect(out).not.toContain('multiLineReturn')
    expect(code).toBe(0)
  })

  // #3803: the rule used to pass on `userId` anywhere in the body, or `user_id` anywhere at all.
  it('fails a method whose only use of userId is a log call', () => {
    const { code, out } = run(fixture(`
export class Repo {
  async logsOnly(userId: string): Promise<unknown> {
    console.log('reading for', userId)
    return this.db.select().from(s.bodyMetrics)
  }
}
`))
    expect(code).toBe(1)
    expect(out).toContain('logsOnly')
  })

  it('fails a method that names user_id only in a column list', () => {
    const { code, out } = run(fixture(`
export class Repo {
  async columnsOnly(userId: string): Promise<unknown> {
    return this.db.execute(sql\`SELECT user_id, date FROM body_metrics\`)
  }
}
`))
    expect(code).toBe(1)
    expect(out).toContain('columnsOnly')
  })

  it('checks plain (non-async) query builders too', () => {
    const { code, out } = run(fixture(`
export function leakyBuilder(db: Db, userId: string) {
  return db.select().from(s.bodyMetrics)
}
export function scopedBuilder(db: Db, userId: string) {
  return db.select().from(s.bodyMetrics).where(and(eq(s.bodyMetrics.userId, userId), isNotNull(s.bodyMetrics.weightKg)))
}
`))
    expect(code).toBe(1)
    expect(out).toContain('leakyBuilder')
    expect(out).not.toContain('scopedBuilder')
  })

  it('passes a bound parameter list, an owner-stamped insert and a row built before the insert', () => {
    const { code, out } = run(fixture(`
export class Repo {
  async pgParams(userId: string): Promise<unknown> {
    return this.pool.query('SELECT 1 FROM body_metrics WHERE user_id = $1', [userId])
  }
  async insertOwned(userId: string, kg: number): Promise<void> {
    await this.db.insert(s.bodyMetrics).values({ userId, weightKg: kg })
  }
  async insertBuilt(userId: string, kg: number): Promise<void> {
    const row = { userId, weightKg: kg }
    await this.db.insert(s.bodyMetrics).values(row)
  }
}
`))
    expect(out).toContain('3 methods take userId, all use it')
    expect(code).toBe(0)
  })

  it('fails when fewer methods are checked than the floor', () => {
    const { code, out } = run(fixture(`
export class Repo {
  async getScoped(userId: string): Promise<unknown> {
    return this.db.select().from(s.bodyMetrics).where(eq(s.bodyMetrics.userId, userId))
  }
}
`), 2)
    expect(code).toBe(1)
    expect(out).toContain('below the floor')
  })
})
