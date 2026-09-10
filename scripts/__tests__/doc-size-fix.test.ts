import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'

/**
 * LA-99 — `--fix` writes the number the gate itself computes.
 *
 * The value is that there is ONE definition of the count. A separate implementation (the obvious
 * `wc -l`) is off by one on these documents, because they carry no trailing newline — an error that
 * cost two retries in one session before it was written down. So the test that matters is not "it
 * writes a number" but "it writes the number that then makes the check pass".
 *
 * Run against a scratch copy of the real script so the repo's own baselines are never rewritten by
 * a test run.
 */
const repoRoot = path.resolve(__dirname, '..', '..')

function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'docsize-'))
  mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true })
  mkdirSync(path.join(dir, 'docs', 'doc-size'), { recursive: true })
  mkdirSync(path.join(dir, 'docs', 'overview', 'entries'), { recursive: true })
  for (const f of ['check-doc-index-size.js']) {
    cpSync(path.join(repoRoot, 'scripts', f), path.join(dir, 'scripts', f))
  }
  cpSync(path.join(repoRoot, 'scripts', 'lib'), path.join(dir, 'scripts', 'lib'), { recursive: true })
  writeFileSync(path.join(dir, 'docs', 'doc-size-baseline.json'), JSON.stringify({
    entries: { dir: 'docs/overview/entries', chore: 20, limit: 60, totalCeiling: 360 },
  }))
  return dir
}

/** A doc with `n` lines and NO trailing newline — the shape that makes `wc -l` wrong. */
const docOf = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')

function run(dir: string, args: string[] = []) {
  return execFileSync('node', [path.join(dir, 'scripts', 'check-doc-index-size.js'), ...args], {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('check-doc-index-size --fix (LA-99)', () => {
  it('writes a count that makes the check pass, for a doc with no trailing newline', () => {
    const dir = sandbox()
    writeFileSync(path.join(dir, 'tracked.md'), docOf(40))
    writeFileSync(path.join(dir, 'docs', 'doc-size', 'tracked.md.size'), '999\n')

    run(dir, ['--fix'])
    const written = Number(readFileSync(path.join(dir, 'docs', 'doc-size', 'tracked.md.size'), 'utf8').trim())
    expect(written).toBe(40)
    // The whole point: the gate agrees with what --fix wrote.
    expect(() => run(dir)).not.toThrow()
  })

  it('lowers a stale-high baseline too, because slack is also a failure', () => {
    const dir = sandbox()
    writeFileSync(path.join(dir, 'tracked.md'), docOf(10))
    writeFileSync(path.join(dir, 'docs', 'doc-size', 'tracked.md.size'), '500\n')
    run(dir, ['--fix'])
    expect(readFileSync(path.join(dir, 'docs', 'doc-size', 'tracked.md.size'), 'utf8').trim()).toBe('10')
  })

  it('is a no-op when every baseline already matches', () => {
    const dir = sandbox()
    writeFileSync(path.join(dir, 'tracked.md'), docOf(7))
    writeFileSync(path.join(dir, 'docs', 'doc-size', 'tracked.md.size'), '7\n')
    expect(run(dir, ['--fix'])).toContain('already matches')
  })

  it('does not touch the entries ceiling — that is owner-set, not arithmetic', () => {
    const dir = sandbox()
    writeFileSync(path.join(dir, 'tracked.md'), docOf(5))
    writeFileSync(path.join(dir, 'docs', 'doc-size', 'tracked.md.size'), '5\n')
    for (let i = 0; i < 361; i++) {
      writeFileSync(path.join(dir, 'docs', 'overview', 'entries', `2026-09-${i}.md`), 'x')
    }
    run(dir, ['--fix'])
    const cfg = JSON.parse(readFileSync(path.join(dir, 'docs', 'doc-size-baseline.json'), 'utf8'))
    expect(cfg.entries.totalCeiling).toBe(360)
  })
})
