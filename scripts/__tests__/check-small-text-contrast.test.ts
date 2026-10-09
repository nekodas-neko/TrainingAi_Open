/**
 * Issue 2429 — the small-text contrast ratchet. A NEW sub-12 px element dimmed below 4.5:1 must fail
 * the check; one that stays at full opacity, or at a passing alpha, must not. The fixture lives in this
 * suite's OWN child folder under `__check_fixture__/` and is scanned only with SCAN_CHECK_FIXTURES=TAG,
 * so it is invisible to every other run (see `scripts/lib/fixture-dirs.js`).
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fixtureChildDir } from '../lib/fixture-dirs'

const root = path.join(__dirname, '..', '..')
const TAG = 'small-text-contrast'
const dir = path.join(root, 'components', '__check_fixture__', fixtureChildDir(TAG))

const run = (env: Record<string, string>): { code: number; out: string } => {
  try {
    const out = execFileSync('node', [path.join(root, 'scripts', 'check-small-text-contrast.js')], {
      cwd: root, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, SCAN_CHECK_FIXTURES: '', ...env },
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stderr?: string }
    return { code: e.status ?? -1, out: e.stderr ?? '' }
  }
}

const withFixture = (body: string, fn: () => void) => {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'fx.tsx'), `export const X = () => (${body})\n`)
    fn()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('check-small-text-contrast ratchet (issue 2429)', () => {
  it('passes on the working tree as committed', () => {
    expect(run({}).code).toBe(0)
  }, 60_000)

  it('fails on a new sub-12px element dimmed below 4.5:1, via opacity or an alpha colour', () => {
    for (const cls of ['text-[9px] text-muted-foreground opacity-50', 'text-[10px] text-muted-foreground/50']) {
      withFixture(`<p className="${cls}">x</p>`, () => {
        expect(run({}).code).toBe(0) // invisible without the opt-in
        const r = run({ SCAN_CHECK_FIXTURES: TAG })
        expect(r.code).not.toBe(0)
        expect(r.out).toContain('fx.tsx')
      })
    }
  }, 60_000)

  it('passes a sub-12px element at full opacity, a 12px+ element, and a passing alpha', () => {
    for (const cls of ['text-[9px] text-muted-foreground', 'text-[14px] text-muted-foreground/50', 'text-[10px] text-muted-foreground/90']) {
      withFixture(`<p className="${cls}">x</p>`, () => {
        expect(run({ SCAN_CHECK_FIXTURES: TAG }).code).toBe(0)
      })
    }
  }, 60_000)
})
