/**
 * Issue 2629 — a replay reported 0 failed while leaving a column a fresh build does not have.
 *
 * `check-schema-replay-diff` describes two databases as sorted lines and diffs them. The describing
 * is exercised against the real schema by CI (and by `pnpm check:rules`'s sibling run on a scratch
 * database); these pin the comparison, its failure output, and its refusal to pass on nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { diffSchemas, QUERIES, SCHEMAS } = require('../check-schema-replay-diff.js') as {
  diffSchemas: (a: string[], b: string[]) => { missingFromReplay: string[]; addedByReplay: string[] }
  QUERIES: Record<string, string>
  SCHEMAS: string[]
}

const script = join(__dirname, '..', 'check-schema-replay-diff.js')
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'schema-diff-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const lines = (n: number, extra: string[] = []) => [...Array.from({ length: n }, (_, i) => `column public.t${i}.id uuid NOT NULL`), ...extra]
const write = (name: string, ls: string[]) => { const p = join(dir, name); writeFileSync(p, ls.join('\n') + '\n'); return p }
const compare = (a: string, b: string): { code: number; out: string } => {
  try {
    return { code: 0, out: execFileSync('node', [script, 'compare', a, b], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('diffSchemas', () => {
  it('is empty for equal schemas, whatever order the lines came in', () => {
    expect(diffSchemas(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({ missingFromReplay: [], addedByReplay: [] })
  })

  it('names a thing the replay added — the issue’s case, a re-added column', () => {
    const d = diffSchemas(['column public.day_checkins.vs_normal text'], ['column public.day_checkins.vs_normal text', 'column public.day_checkins.vs_yesterday text'])
    expect(d.addedByReplay).toEqual(['column public.day_checkins.vs_yesterday text'])
    expect(d.missingFromReplay).toEqual([])
  })

  it('names a thing the replay lost or changed', () => {
    const d = diffSchemas(['index idx_a ON t (a)', 'column public.t.a integer'], ['column public.t.a bigint', 'index idx_a ON t (a)'])
    expect(d.missingFromReplay).toEqual(['column public.t.a integer'])
    expect(d.addedByReplay).toEqual(['column public.t.a bigint'])
  })
})

describe('the describing queries', () => {
  it('cover every kind of object a migration can change, in both schemas', () => {
    expect(Object.keys(QUERIES).sort()).toEqual(['column', 'constraint', 'enum', 'function', 'index', 'table', 'trigger', 'view'])
    expect(SCHEMAS).toEqual(['public', 'claude_ro'])
  })
})

describe('compare', () => {
  it('passes, and says how much it compared, when the two descriptions are equal', () => {
    const f = write('fresh.txt', lines(150))
    const r = write('replayed.txt', lines(150))
    const out = compare(f, r)
    expect(out.code).toBe(0)
    expect(out.out).toContain('a replayed schema equals a fresh build (150 objects')
  })

  it('fails and prints the difference, with the fix pointer', () => {
    const f = write('fresh.txt', lines(150))
    const r = write('replayed.txt', lines(150, ['column public.day_checkins.vs_yesterday text']))
    const out = compare(f, r)
    expect(out.code).toBe(1)
    expect(out.out).toContain('+ only after the replay:')
    expect(out.out).toContain('column public.day_checkins.vs_yesterday text')
    expect(out.out).toContain('280_day_checkin_vs_yesterday.sql')
  })

  it('refuses to pass on an empty description: two empty schemas are equal and mean nothing', () => {
    const f = write('fresh.txt', [])
    const r = write('replayed.txt', [])
    const out = compare(f, r)
    expect(out.code).toBe(1)
    expect(out.out).toContain('did not describe the schema')
  })
})
