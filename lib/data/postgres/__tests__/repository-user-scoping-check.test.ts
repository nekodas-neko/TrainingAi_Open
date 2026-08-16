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
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'lib/data/postgres/slices'), { recursive: true })
  cpSync(SCRIPT, join(dir, 'scripts', 'check-repository-user-scoping.js'))
  writeFileSync(join(dir, 'lib/data/postgres/adapter.ts'), adapterSource)
  return dir
}

function run(dir: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [join(dir, 'scripts', 'check-repository-user-scoping.js')], { encoding: 'utf8' })
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
})
