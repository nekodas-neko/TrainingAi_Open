// #2559 — a base that is HEAD under another name is not a base.
//
// In CI, most base-aware ratchets ran before the step that fetches `origin/main`. `resolveBaseRef`
// then fell through to `FETCH_HEAD`, which `actions/checkout` had just pointed at the PR's own merge
// commit. Every base read returned the branch's own content, so `atBase === count` for every file and
// growth past a baseline passed as "inherited".
//
// Two guards, either of which closes it alone: `FETCH_HEAD` is no longer a default candidate, and a
// non-branch candidate whose TREE equals HEAD's is refused. A branch ref with HEAD's tree is still
// accepted, because that is the base genuinely matching HEAD (`main` checked out, an empty PR).
//
// The fixture is a throwaway repository laid out the way CI leaves one: HEAD detached at a merge
// commit, `refs/remotes/pull/1/merge` and `FETCH_HEAD` pointing at it, and no `origin/main` or `main`.
// The module resolves its repository from its own location, so a COPY of `base-ref.js` lives inside.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

type BaseRef = {
  DEFAULT_BASE_REFS: string[]
  resolveBaseRef: (refs?: string[]) => string | null
}

const scripts = path.join(__dirname, '..')
let repo = ''
let baseSha = ''
let mergeSha = ''
let lib: BaseRef

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const write = (rel: string, content: string) => {
  mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true })
  writeFileSync(path.join(repo, rel), content)
}

const ONE_HEX = 'export const X = () => <div style={{ color: "#ff0000" }} />\n'
const TWO_HEX = 'export const X = () => <div style={{ color: "#ff0000", background: "#00ff00" }} />\n'

/** Run a script in the fixture and keep both streams and the exit status. */
const run = (args: string[]) => {
  const r = spawnSync('node', args, { cwd: repo, encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

/** Only the refs CI would have at the moment the early ratchets used to run. */
const ciRefs = () => {
  for (const ref of ['refs/remotes/origin/main', 'refs/heads/main', 'refs/tags/at-head', 'refs/tags/at-base']) {
    try { git('update-ref', '-d', ref) } catch { /* not there */ }
  }
  // What checkout's own fetch leaves behind: the merge commit under a pull ref, and FETCH_HEAD.
  git('fetch', '-q', '.', `+${mergeSha}:refs/remotes/pull/1/merge`)
  expect(git('rev-parse', 'FETCH_HEAD')).toBe(mergeSha)
}

beforeAll(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'base-ref-head-2559-'))
  // `trunk`, not `main`, so no candidate resolves by accident.
  git('init', '-q', '-b', 'trunk')
  // The base already carries one hex literal against a baseline of none: an inherited overage.
  write('components/hexy.tsx', ONE_HEX)
  write('app/page.tsx', 'export default function P() { return null }\n') // the ratchet walks app/ too
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  baseSha = git('rev-parse', 'HEAD')

  // The branch grows the file past what the base had.
  git('checkout', '-q', '-b', 'feature')
  write('components/hexy.tsx', TWO_HEX)
  git('commit', '-q', '-am', 'branch grows the file')

  // The PR's merge commit, checked out detached, the way `actions/checkout` does on pull_request.
  git('checkout', '-q', '--detach', baseSha)
  git('merge', '-q', '--no-ff', '--no-edit', 'feature')
  mergeSha = git('rev-parse', 'HEAD')
  git('branch', '-q', '-D', 'trunk')
  git('branch', '-q', '-D', 'feature')

  // The library and the ratchet the reproduction runs. Untracked, so they are not in any tree.
  mkdirSync(path.join(repo, 'scripts', 'lib'), { recursive: true })
  for (const f of ['lib/base-ref.js', 'lib/strip-comments.js', 'check-hex-literals.js']) {
    copyFileSync(path.join(scripts, f), path.join(repo, 'scripts', f))
  }

  // The pre-#2559 resolver, rebuilt from this one by undoing exactly its two guards. Each
  // replacement is asserted, so a refactor that moves either line fails here rather than letting the
  // "old" copy quietly become the new one.
  const src = readFileSync(path.join(scripts, 'lib', 'base-ref.js'), 'utf8')
  const NEW_REFS = "const DEFAULT_BASE_REFS = ['origin/main', 'main'];"
  const GUARD = '      if (isHeadItself(ref)) continue;\n'
  expect(src).toContain(NEW_REFS)
  expect(src).toContain(GUARD)
  const old = src
    .replace(NEW_REFS, "const DEFAULT_BASE_REFS = ['origin/main', 'FETCH_HEAD', 'main'];")
    .replace(GUARD, '')
  // It lives under `old/`, inside the fixture's working tree, so its git calls (run from `old/`)
  // still find the fixture's repository.
  mkdirSync(path.join(repo, 'old', 'scripts', 'lib'), { recursive: true })
  writeFileSync(path.join(repo, 'old', 'scripts', 'lib', 'base-ref.js'), old)
  copyFileSync(path.join(scripts, 'lib', 'strip-comments.js'), path.join(repo, 'old', 'scripts', 'lib', 'strip-comments.js'))
  // The ratchet itself, unchanged except that it walks the fixture's `components/`, not `old/`'s.
  const hex = readFileSync(path.join(scripts, 'check-hex-literals.js'), 'utf8')
  const HEX_ROOT = "const root = path.join(__dirname, '..');"
  expect(hex).toContain(HEX_ROOT)
  writeFileSync(
    path.join(repo, 'old', 'scripts', 'check-hex-literals.js'),
    hex.replace(HEX_ROOT, `const root = ${JSON.stringify(repo)};`),
  )

  lib = createRequire(path.join(repo, 'x.js'))('./scripts/lib/base-ref.js') as BaseRef
}, 60_000)

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true })
})

beforeEach(() => ciRefs())

describe('resolveBaseRef refuses a candidate that is HEAD under another name (#2559)', () => {
  it('no longer lists FETCH_HEAD as a default candidate', () => {
    expect(lib.DEFAULT_BASE_REFS).not.toContain('FETCH_HEAD')
    expect(lib.DEFAULT_BASE_REFS).toContain('origin/main')
  })

  it('refuses FETCH_HEAD when it is the merge commit checked out as HEAD', () => {
    expect(lib.resolveBaseRef(['FETCH_HEAD'])).toBeNull()
  })

  it('refuses a tag or a raw sha whose tree is HEAD’s', () => {
    git('update-ref', 'refs/tags/at-head', mergeSha)
    expect(lib.resolveBaseRef(['at-head'])).toBeNull()
    expect(lib.resolveBaseRef([mergeSha])).toBeNull()
  })

  it('resolves a non-branch candidate whose tree differs from HEAD’s', () => {
    git('update-ref', 'refs/tags/at-base', baseSha)
    expect(lib.resolveBaseRef(['FETCH_HEAD', 'at-base'])).toBe('at-base')
    expect(lib.resolveBaseRef([baseSha])).toBe(baseSha)
  })

  it('resolves origin/main once the base fetch has run', () => {
    git('update-ref', 'refs/remotes/origin/main', baseSha)
    expect(lib.resolveBaseRef()).toBe('origin/main')
  })

  // The paths that must not change: `main` checked out locally with nothing on it, and a PR whose
  // merge result is identical to `main`. A branch ref equal to HEAD is the base, not HEAD in disguise.
  it('still accepts a branch ref whose tree equals HEAD’s — the base genuinely matches', () => {
    git('update-ref', 'refs/remotes/origin/main', mergeSha)
    expect(lib.resolveBaseRef()).toBe('origin/main')
    git('update-ref', '-d', 'refs/remotes/origin/main')
    git('update-ref', 'refs/heads/main', mergeSha)
    expect(lib.resolveBaseRef()).toBe('main')
  })

  // A failed fetch must leave strict no-base mode, and say so — on stdout, where a spawned run's
  // reader looks (OR-134).
  it('falls back to strict no-base mode, with its warning, when nothing else resolves', () => {
    const r = run(['-e', 'process.stdout.write(String(require("./scripts/lib/base-ref.js").resolveBaseRef()))'])
    expect(r.out).toContain('base-ref: no base branch resolved (tried origin/main, main)')
    expect(r.out).toContain('null')
  })
})

// The original failure, end to end: the branch grew an over-baseline file, and the only ref around
// is FETCH_HEAD at the branch's own merge commit.
describe('a ratchet with no fetched base (the CI step order before #2559)', () => {
  it('OLD resolver: reads the merge commit as the base and calls the growth inherited', () => {
    const r = run(['old/scripts/check-hex-literals.js'])
    expect(r.out).toContain('components/hexy.tsx: 2 against a baseline of 0, but the base branch already has 2')
    // Not asserted on the exit status: the real BASELINE's rows name files this fixture lacks, so
    // every run here also reports them stale. The verdict on hexy.tsx is what these cases pin.
    expect(r.out).not.toContain('components/hexy.tsx: 2 hex literal(s)')
  }, 30_000)

  it('NEW resolver: refuses that base, runs strict, and fails the growth', () => {
    const r = run(['scripts/check-hex-literals.js'])
    expect(r.out).toContain('base-ref: no base branch resolved')
    expect(r.out).toContain('components/hexy.tsx: 2 hex literal(s) — this file had none.')
    expect(r.out).not.toContain('but the base branch already has')
  }, 30_000)

  it('NEW resolver with the base fetched: compares against the real base and fails the growth', () => {
    git('update-ref', 'refs/remotes/origin/main', baseSha)
    const r = run(['scripts/check-hex-literals.js'])
    expect(r.out).not.toContain('base-ref: no base branch resolved')
    expect(r.out).toContain('components/hexy.tsx: 2 hex literal(s) — this file had none.')
    expect(r.out).not.toContain('but the base branch already has')
  }, 30_000)
})
