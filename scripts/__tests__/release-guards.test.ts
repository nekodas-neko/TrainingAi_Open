// #4051 — the release workflow's guards, tested on throwaway git repositories (a bare "origin" and
// a clone of it), so no release has to run to prove them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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
