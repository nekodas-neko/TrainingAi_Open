// #2557 — a ratchet must count the base's copy of a file the way it counts the working tree's.
//
// `scripts/lib/base-ref.js` says the base count runs "the SAME matcher over the base content", because
// `verdict` reads `count <= atBase` as "inherited" (a pass). Four callers broke that, every time in the
// lenient direction: the working tree was counted with comments stripped (or `wc -l`), the base was not.
// A base inflated by a comment, or by one line, lets a branch that really added something read as
// inherited. Each case below is a throwaway repository whose base holds the inflating shape and whose
// working tree adds ONE real occurrence; the ratchet has to fail it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const scripts = path.join(__dirname, '..')
let repo = ''

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const write = (rel: string, content: string) => {
  mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true })
  writeFileSync(path.join(repo, rel), content)
}

/** Commit what is written so far as the base, then let the case edit the working tree. */
const commitBase = () => {
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'))
}

const run = (script: string) => {
  const r = spawnSync('node', [`scripts/${script}`], { cwd: repo, encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

beforeEach(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'ratchet-same-matcher-'))
  git('init', '-q')
  // The scripts and their libs, committed WITH the base so the working tree is clean apart from the
  // file under test.
  mkdirSync(path.join(repo, 'scripts'), { recursive: true })
  cpSync(path.join(scripts, 'lib'), path.join(repo, 'scripts', 'lib'), { recursive: true })
  for (const f of ['check-hex-literals.js', 'check-strict-request-schemas.js', 'check-fetch-once-effects.js', 'check-component-size.js']) {
    copyFileSync(path.join(scripts, f), path.join(repo, 'scripts', f))
  }
  // The walkers expect both roots to exist.
  write('app/page.tsx', 'export {}\n')
  write('components/placeholder.tsx', 'export {}\n')
})

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true })
})

describe('check-hex-literals', () => {
  // `(#919)` is a PR reference, and the pattern reads it as a colour. LA-72 found eight such rows.
  it('fails a real colour added to a file whose only base match is a comment', () => {
    write('components/h.tsx', '// fixed in (#919)\nexport const X = () => <div />\n')
    commitBase()
    write('components/h.tsx', '// fixed in (#919)\nexport const X = () => <div style={{ color: "#ff0000" }} />\n')
    const { out } = run('check-hex-literals.js')
    expect(out).toContain('components/h.tsx: 1 hex literal(s) — this file had none.')
    expect(out).not.toContain('components/h.tsx: 1 against a baseline of 0, but the base branch already has 1')
  })

  it('still passes a file that already had the colour at the base', () => {
    write('components/h.tsx', 'export const X = () => <div style={{ color: "#ff0000" }} />\n')
    commitBase()
    const { out } = run('check-hex-literals.js')
    expect(out).toContain('the base branch already has 1')
  })
})

describe('check-strict-request-schemas', () => {
  it('fails a non-strict schema added to a file whose only base match is a comment', () => {
    write('app/api/x/route.ts', "import { z } from 'zod'\n// was z.object({ a: z.string() }) before\nexport const a = 1\n")
    commitBase()
    write('app/api/x/route.ts', "import { z } from 'zod'\n// was z.object({ a: z.string() }) before\nexport const S = z.object({ a: z.string() })\n")
    // Asserted on the file's own line, not on the exit status: the fixture repository lacks the real
    // baseline's files, so the script exits non-zero for those rows whatever it says about this one.
    const { out } = run('check-strict-request-schemas.js')
    expect(out).toContain('app/api/x/route.ts has 1 non-strict request schema(s) and is not in the baseline. (base origin/main: 0 non-strict)')
    expect(out).not.toContain('app/api/x/route.ts: 1 non-strict request schema(s) against a baseline of 0, but the base branch is already there')
  })
})

describe('check-fetch-once-effects', () => {
  const EFFECT = "useEffect(() => { cachedFetch('/api/a') }, [])"

  it('fails a fetch-once effect added to a file whose only base match is a comment', () => {
    write('components/f.tsx', `// removed: ${EFFECT}\nexport const A = 1\n`)
    commitBase()
    write('components/f.tsx', `// removed: ${EFFECT}\nexport function A() { ${EFFECT}; return null }\n`)
    // On the file's own line, for the reason given in the strict-schema case above.
    const { out } = run('check-fetch-once-effects.js')
    expect(out).toContain('components/f.tsx: 1 fetch-once effect(s); this file is not in the baseline, so it must have zero.')
    expect(out).not.toContain('components/f.tsx: 1 fetch-once effect(s) against a baseline of 0, but the base branch is already there')
  })
})

describe('check-component-size', () => {
  // Hotspots the script's own baseline names must exist at their recorded size, or its stale-row check
  // exits before it reports anything about the file under test.
  const hotspots = () => {
    const src = readFileSync(path.join(scripts, 'check-component-size.js'), 'utf8') as string
    const block = /const BASELINE = \{([\s\S]*?)\n\};/.exec(src)![1]
    return [...block.matchAll(/^\s*'([^']+)':\s*(\d+),/gm)].map(m => [m[1], Number(m[2])] as const)
  }
  const lines = (n: number) => 'x\n'.repeat(n)

  it('fails a file that grew by exactly one line past the limit, not reads it as inherited', () => {
    for (const [rel, n] of hotspots()) write(rel, lines(n))
    // 801 lines by `wc -l`: one over the 800 limit, and not a hotspot.
    write('components/big.tsx', lines(801))
    commitBase()
    write('components/big.tsx', lines(802))
    const { status, out } = run('check-component-size.js')
    expect(status, out).not.toBe(0)
    expect(out).toContain('components/big.tsx: 802 lines (limit 800)')
    expect(out).not.toContain('components/big.tsx: 802 lines against a 800-line baseline, but the base branch is already there')
  })

  it('still reads an unchanged over-limit file as inherited', () => {
    for (const [rel, n] of hotspots()) write(rel, lines(n))
    write('components/big.tsx', lines(801))
    commitBase()
    const { out } = run('check-component-size.js')
    expect(out).toContain('components/big.tsx: 801 lines against a 800-line baseline, but the base branch is already there')
  })
})
