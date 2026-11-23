// #4051 — the release workflow's guards, tested on throwaway git repositories (a bare "origin" and
// a clone of it), so no release has to run to prove them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const guards = require('../release-guards.js') as typeof import('../release-guards.js')

let root: string
let origin: string
let work: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  }).trim()
}

/** Commit `files` (path -> content) on the current branch of `work` and push it; returns the sha. */
function commit(files: Record<string, string>, branch = 'main'): string {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(work, p)), { recursive: true })
    writeFileSync(path.join(work, p), content)
  }
  git(work, 'add', '-A')
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'c')
  git(work, 'push', '-q', 'origin', `HEAD:${branch}`)
  return git(work, 'rev-parse', 'HEAD')
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'release-guards-'))
  origin = path.join(root, 'origin.git')
  work = path.join(root, 'work')
  git(root, 'init', '-q', '--bare', '-b', 'main', origin)
  git(root, 'clone', '-q', origin, work)
  git(work, 'checkout', '-q', '-b', 'main')
  commit({ '.github/workflows/ci.yml': 'a', 'README.md': 'x' })
  git(work, 'fetch', '-q', 'origin')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('workflowDrift', () => {
  it('is empty when the commit is main itself', () => {
    const sha = git(work, 'rev-parse', 'HEAD')
    expect(guards.workflowDrift(sha, { cwd: work })).toEqual([])
  })

  it('is empty when main moved on without touching a workflow', () => {
    const released = git(work, 'rev-parse', 'HEAD')
    commit({ 'README.md': 'y' })
    git(work, 'fetch', '-q', 'origin')
    expect(guards.workflowDrift(released, { cwd: work })).toEqual([])
  })

  it('names the workflow file main changed after the released commit', () => {
    const released = git(work, 'rev-parse', 'HEAD')
    commit({ '.github/workflows/ci.yml': 'b', 'README.md': 'y' })
    git(work, 'fetch', '-q', 'origin')
    expect(guards.workflowDrift(released, { cwd: work })).toEqual(['.github/workflows/ci.yml'])
  })

  it('names an added workflow file, and a deleted one under both names when moved', () => {
    const released = git(work, 'rev-parse', 'HEAD')
    git(work, 'mv', '.github/workflows/ci.yml', '.github/workflows/ci2.yml')
    commit({ '.github/workflows/new.yml': 'n' })
    git(work, 'fetch', '-q', 'origin')
    expect(guards.workflowDrift(released, { cwd: work }).sort()).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/ci2.yml',
      '.github/workflows/new.yml',
    ])
  })

  it('reports a hotfix branch whose workflows differ from main', () => {
    const base = git(work, 'rev-parse', 'HEAD')
    commit({ '.github/workflows/ci.yml': 'b' }) // main moves on
    git(work, 'checkout', '-q', '-b', 'hotfix/x', base)
    const hot = commit({ 'src.txt': 'fix' }, 'hotfix/x')
    git(work, 'fetch', '-q', 'origin')
    expect(guards.workflowDrift(hot, { cwd: work })).toEqual(['.github/workflows/ci.yml'])
  })

  it('throws, rather than reporting no difference, when the base does not exist', () => {
    const sha = git(work, 'rev-parse', 'HEAD')
    expect(() => guards.workflowDrift(sha, { base: 'origin/nope', cwd: work })).toThrow()
  })
})

describe('driftMessage', () => {
  it('release: names the files and says to release main or re-cut', () => {
    const m = guards.driftMessage(['.github/workflows/ci.yml'], 'a'.repeat(40), 'release')
    expect(m).toContain('.github/workflows/ci.yml')
    expect(m).toMatch(/Release main's head/)
    expect(m).toMatch(/re-cut/)
  })

  it('hotfix: says the tag will need the owner', () => {
    const m = guards.driftMessage(['.github/workflows/ci.yml'], 'a'.repeat(40), 'hotfix')
    expect(m).toMatch(/owner/)
  })
})

describe('ensureTag', () => {
  it('creates and pushes the tag when it is absent', () => {
    const sha = git(work, 'rev-parse', 'HEAD')
    expect(guards.ensureTag('1.2.3', sha, { cwd: work })).toBe('created')
    expect(git(origin, 'rev-parse', 'refs/tags/v1.2.3^{commit}')).toBe(sha)
  })

  it('treats a tag on the remote at the same commit as done, even when this checkout lacks it', () => {
    const sha = git(work, 'rev-parse', 'HEAD')
    // Someone made it by hand elsewhere: it is on the remote but not in this clone.
    git(origin, 'tag', 'v1.2.3', sha)
    expect(guards.ensureTag('1.2.3', sha, { cwd: work })).toBe('exists')
  })

  it('treats a tag this checkout already fetched, at the same commit, as done', () => {
    const sha = git(work, 'rev-parse', 'HEAD')
    git(origin, 'tag', 'v1.2.3', sha)
    git(work, 'fetch', '-q', '--tags', 'origin')
    expect(guards.ensureTag('1.2.3', sha, { cwd: work })).toBe('exists')
  })

  it('accepts an annotated tag that points at the same commit', () => {
    const sha = git(work, 'rev-parse', 'HEAD')
    git(origin, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'tag', '-a', 'v1.2.3', '-m', 'm', sha)
    expect(guards.ensureTag('1.2.3', sha, { cwd: work })).toBe('exists')
  })

  it('fails, and leaves the tag where it was, when it is at another commit', () => {
    const first = git(work, 'rev-parse', 'HEAD')
    const second = commit({ 'README.md': 'z' })
    git(origin, 'tag', 'v1.2.3', first)
    expect(() => guards.ensureTag('1.2.3', second, { cwd: work })).toThrow(/not at the released commit/)
    expect(git(origin, 'rev-parse', 'refs/tags/v1.2.3^{commit}')).toBe(first)
  })
})

describe('releaseExists', () => {
  it('is true when gh finds the release', () => {
    expect(guards.releaseExists('v1.2.3', { run: () => ({ code: 0, stderr: '' }) })).toBe(true)
  })

  it('is false only on gh\'s "release not found"', () => {
    expect(guards.releaseExists('v1.2.3', { run: () => ({ code: 1, stderr: 'release not found' }) })).toBe(false)
  })

  it('throws on any other failure instead of guessing', () => {
    expect(() => guards.releaseExists('v1.2.3', { run: () => ({ code: 1, stderr: 'HTTP 401: Bad credentials' }) })).toThrow(
      /could not tell/,
    )
  })
})

// The workflow calls the script as a process and branches on its exit code and its `::error::` /
// `::warning::` lines, so those are the contract tested here, not only the functions behind them.
describe('command line (what release.yml runs)', () => {
  const script = path.resolve(__dirname, '../release-guards.js')

  function run(args: string[], opts: { cwd?: string; pathPrefix?: string; summary?: string } = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
    delete env.GITHUB_STEP_SUMMARY
    if (opts.summary) env.GITHUB_STEP_SUMMARY = opts.summary
    if (opts.pathPrefix) env.PATH = `${opts.pathPrefix}${path.delimiter}${process.env.PATH}`
    const r = spawnSync('node', [script, ...args], { cwd: opts.cwd ?? work, encoding: 'utf8', env })
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }

  /** A `gh` that answers `release view` with the given exit code and stderr. */
  function ghStub(code: number, stderr: string): string {
    const dir = path.join(root, 'bin')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'gh')
    writeFileSync(file, `#!/bin/sh\necho "${stderr}" >&2\nexit ${code}\n`)
    chmodSync(file, 0o755)
    return dir
  }

  /** `sha` released while main moved on and changed a workflow. Returns the released sha. */
  function mainDrifted(): string {
    const released = git(work, 'rev-parse', 'HEAD')
    commit({ '.github/workflows/ci.yml': 'b' })
    git(work, 'fetch', '-q', 'origin')
    return released
  }

  describe('drift', () => {
    it('release mode, workflows differ: exits 1 with ::error:: naming the file', () => {
      const sha = mainDrifted()
      const r = run(['drift', sha, 'release'])
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/^::error::/m)
      expect(r.out).toContain('.github/workflows/ci.yml')
    })

    it('hotfix mode, workflows differ: exits 0 with ::warning::', () => {
      const sha = mainDrifted()
      const r = run(['drift', sha, 'hotfix'])
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/^::warning::/m)
      expect(r.out).not.toMatch(/::error::/)
    })

    it('no drift: exits 0 in both modes', () => {
      const sha = git(work, 'rev-parse', 'HEAD')
      expect(run(['drift', sha, 'release']).code).toBe(0)
      expect(run(['drift', sha, 'hotfix']).code).toBe(0)
    })

    it('rejects an unknown mode', () => {
      const sha = git(work, 'rev-parse', 'HEAD')
      expect(run(['drift', sha, 'bogus']).code).toBe(1)
    })
  })

  describe('tag', () => {
    it('absent: creates and pushes it, exit 0', () => {
      const sha = git(work, 'rev-parse', 'HEAD')
      expect(run(['tag', '1.2.3', sha]).code).toBe(0)
      expect(git(origin, 'rev-parse', 'refs/tags/v1.2.3^{commit}')).toBe(sha)
    })

    it('already at the same commit: exit 0, nothing pushed', () => {
      const sha = git(work, 'rev-parse', 'HEAD')
      git(origin, 'tag', 'v1.2.3', sha)
      const r = run(['tag', '1.2.3', sha])
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/nothing to create/)
    })

    it('at another commit: exit 1 with ::error::, tag untouched', () => {
      const first = git(work, 'rev-parse', 'HEAD')
      const second = commit({ 'README.md': 'z' })
      git(origin, 'tag', 'v1.2.3', first)
      const r = run(['tag', '1.2.3', second])
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/^::error::/m)
      expect(git(origin, 'rev-parse', 'refs/tags/v1.2.3^{commit}')).toBe(first)
    })

    /** Make the bare origin refuse every push to a tag, as GitHub does for a workflow-file mismatch. */
    function rejectTagPushes(): void {
      const hook = path.join(origin, 'hooks', 'pre-receive')
      mkdirSync(path.dirname(hook), { recursive: true })
      writeFileSync(hook, '#!/bin/sh\necho "refusing to allow a GitHub App to create or update workflow" >&2\nexit 1\n')
      chmodSync(hook, 0o755)
    }

    it('absent, files differ, remote accepts: warns, tries anyway, creates the tag, exit 0', () => {
      const sha = mainDrifted()
      git(work, 'update-ref', 'refs/remotes/origin/main', sha)
      const r = run(['tag', '1.2.3', sha])
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/^::warning::/m)
      expect(r.out).toContain('.github/workflows/ci.yml')
      expect(r.out).not.toMatch(/::error::/)
      expect(git(origin, 'rev-parse', 'refs/tags/v1.2.3^{commit}')).toBe(sha)
    })

    it('absent, files differ, remote rejects: exit 1 with the late-drift message, git quoted, no tag', () => {
      const sha = mainDrifted()
      const summary = path.join(root, 'summary.md')
      // The checkout has not seen the new main yet: the step must fetch it itself.
      git(work, 'update-ref', 'refs/remotes/origin/main', sha)
      rejectTagPushes()
      const r = run(['tag', '1.2.3', sha], { summary })
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/^::error::/m)
      expect(r.out).toContain('already serving')
      expect(r.out).toContain('NOT created')
      expect(r.out).toContain('.github/workflows/ci.yml')
      expect(r.out).toContain('refusing to allow')
      expect(r.out).toContain('Re-run failed jobs')
      expect(r.out).toContain('owner-manual')
      expect(r.out).not.toMatch(/Pushed v1\.2\.3/)
      expect(git(origin, 'tag', '-l', 'v1.2.3')).toBe('')
      const note = readFileSync(summary, 'utf8')
      expect(note).toContain('tag was not created')
      expect(note).toContain('.github/workflows/ci.yml')
    })

    it('absent, no drift, remote rejects: exit 1 with git\'s error and no drift message', () => {
      const sha = git(work, 'rev-parse', 'HEAD')
      const summary = path.join(root, 'summary.md')
      rejectTagPushes()
      const r = run(['tag', '1.2.3', sha], { summary })
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/^::error::/m)
      expect(r.out).toContain('refusing to allow')
      expect(r.out).not.toContain('already serving')
      expect(r.out).not.toContain('NOT created')
      expect(existsSync(summary)).toBe(false)
      expect(git(origin, 'tag', '-l', 'v1.2.3')).toBe('')
    })

    it('already at the same commit while the files still differ: passes without pushing (a re-run after a hand-made tag)', () => {
      const sha = mainDrifted()
      git(origin, 'tag', 'v1.2.3', sha)
      rejectTagPushes() // a push attempt would fail the run
      const r = run(['tag', '1.2.3', sha])
      expect(r.code).toBe(0)
      expect(r.out).not.toMatch(/::error::|::warning::/)
      expect(r.out).toMatch(/nothing to create/)
    })
  })

  describe('release-exists', () => {
    it('exits 0 when gh finds the release', () => {
      expect(run(['release-exists', 'v1.2.3'], { pathPrefix: ghStub(0, '') }).code).toBe(0)
    })

    it('exits 1 on gh\'s "release not found"', () => {
      expect(run(['release-exists', 'v1.2.3'], { pathPrefix: ghStub(1, 'release not found') }).code).toBe(1)
    })

    it('exits 2 on any other failure, with ::error::', () => {
      const r = run(['release-exists', 'v1.2.3'], { pathPrefix: ghStub(1, 'HTTP 401: Bad credentials') })
      expect(r.code).toBe(2)
      expect(r.out).toMatch(/^::error::/m)
    })
  })

  it('an unknown command exits 1', () => {
    expect(run(['nope']).code).toBe(1)
    expect(existsSync(script)).toBe(true)
  })
})
