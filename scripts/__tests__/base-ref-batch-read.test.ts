// #2081 — the base is read in one batch, not one `git show` per file.
//
// Every ratchet built on `lib/base-ref.js` used to start a `git show <base>:<path>` per scanned
// file; on the owner's Windows machine that was 15 of `check-hex-literals`' 15.4 seconds. The reader
// is now one `git ls-tree` plus one `git cat-file --batch`, and these cases pin what the batch has
// to get right that a lone `git show` got for free: each blob's bytes cut at the right place in one
// shared stream, a path absent at base still told apart from an object git cannot read (OR-130), a
// blob over node's 1 MiB default buffer (LA-132), and names a line protocol or a pathspec would
// mangle.
//
// The fixture is a throwaway repository with a COPY of `base-ref.js` inside it, because the module
// resolves its repository from its own location. That keeps every case off this repository's refs
// and object store.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

type Read = { content: string | null; unreadable: boolean; reason?: string }
type BaseRef = {
  readAtBase: (ref: string, paths: string[]) => Map<string, Read>
  showAtBase: (ref: string, p: string) => Read
  filesAtBase: (ref: string | null, paths: string[]) => Map<string, string | null>
  fileAtBase: (ref: string | null, p: string) => string | null
  countsAtBase: (ref: string | null, paths: string[], fn: (c: string) => number) => Map<string, number | null>
  lineCountsAtBase: (ref: string | null, paths: string[]) => Map<string, number | null>
}

const scripts = path.join(__dirname, '..')
let repo = ''
let base = ''
let lib: BaseRef
let spawns = 0

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const write = (rel: string, content: string | Buffer) => {
  mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true })
  writeFileSync(path.join(repo, rel), content)
}

const UNICODE = 'dir with space/ünïcödé ✓ 日本.ts'
const ROUTE = 'app/api/thing/[id]/route.ts'
const CRLF = 'a\r\nb\r\n'
const BINARY = Buffer.from([0, 10, 1, 2, 10, 10, 255, 0, 10])
const BIG = 'x'.repeat(2.5 * 1024 * 1024)
const MANY = Array.from({ length: 300 }, (_, i) => `many/f${String(i).padStart(3, '0')}.ts`)

beforeAll(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'base-ref-batch-'))
  git('init', '-q')
  write('present.ts', 'export const a = 1\n')
  write('empty.ts', '')
  write(UNICODE, 'unicode body\n')
  write(ROUTE, 'route body\n')
  write('crlf.txt', CRLF)
  write('binary.bin', BINARY)
  write('big.txt', BIG)
  write('gone.ts', 'this blob is deleted from the object store below\n')
  write('after-gone.ts', 'read from the same stream as the missing object\n')
  for (const [i, p] of MANY.entries()) write(p, `// ${i}\n`.repeat(i + 1))
  write('components/hexy.tsx', 'export const X = () => <div style={{ color: "#ff0000" }} />\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  base = git('rev-parse', 'HEAD')
  git('update-ref', 'refs/remotes/origin/main', base)

  // A path the tree names whose object is gone: the shape of a partial or damaged clone.
  const oid = git('rev-parse', `${base}:gone.ts`)
  unlinkSync(path.join(repo, '.git', 'objects', oid.slice(0, 2), oid.slice(2)))

  // The copy, and the scripts the ratchet case runs. Untracked, so they are not part of the base.
  mkdirSync(path.join(repo, 'scripts', 'lib'), { recursive: true })
  for (const f of ['lib/base-ref.js', 'lib/strip-comments.js', 'lib/hex-literals.js', 'lib/fixture-dirs.js', 'check-hex-literals.js']) {
    copyFileSync(path.join(scripts, f), path.join(repo, 'scripts', f))
  }

  // Counted before the copy loads, because it destructures `spawnSync` at require time.
  const cp = createRequire(__filename)('child_process') as { spawnSync: (...a: unknown[]) => unknown }
  const real = cp.spawnSync
  cp.spawnSync = (...a: unknown[]) => { spawns++; return real(...a) }
  lib = createRequire(path.join(repo, 'x.js'))('./scripts/lib/base-ref.js') as BaseRef
  cp.spawnSync = real
}, 60_000)

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true })
})

describe('the batch reader (#2081)', () => {
  it('reads a file that is there', () => {
    expect(lib.showAtBase(base, 'present.ts')).toEqual({ content: 'export const a = 1\n', unreadable: false })
  })

  it('calls a path that is not at the base absent, not unreadable', () => {
    expect(lib.showAtBase(base, 'no/such/file.ts')).toEqual({ content: null, unreadable: false })
    expect(lib.fileAtBase(base, 'no/such/file.ts')).toBeNull()
  })

  // Empty is a real answer — zero lines, zero matches — and must not collapse into "absent".
  it('reads an empty file as an empty string, not as absent', () => {
    expect(lib.showAtBase(base, 'empty.ts')).toEqual({ content: '', unreadable: false })
    expect(lib.lineCountsAtBase(base, ['empty.ts']).get('empty.ts')).toBe(1)
  })

  it('reads paths with spaces, unicode and pathspec glob characters', () => {
    const r = lib.filesAtBase(base, [UNICODE, ROUTE])
    expect(r.get(UNICODE)).toBe('unicode body\n')
    expect(r.get(ROUTE)).toBe('route body\n')
  })

  // `git show` printed the blob as stored; so must this. No eol conversion, and a binary blob's
  // embedded newlines must not knock the next object's header out of step.
  it('returns stored bytes unconverted, and keeps the stream in step after binary content', () => {
    const r = lib.filesAtBase(base, ['crlf.txt', 'binary.bin', 'present.ts'])
    expect(r.get('crlf.txt')).toBe(CRLF)
    expect(r.get('binary.bin')).toBe(BINARY.toString('utf8'))
    expect(r.get('present.ts')).toBe('export const a = 1\n')
  })

  it('reads a blob over node’s 1 MiB default spawn buffer (LA-132)', () => {
    expect(lib.fileAtBase(base, 'big.txt')).toHaveLength(BIG.length)
  })

  it('reads many files correctly in one call, each its own content', () => {
    const r = lib.countsAtBase(base, MANY, (c) => c.split('\n').length - 1)
    MANY.forEach((p, i) => expect(r.get(p), p).toBe(i + 1))
  })

  // The point of the issue. Two processes however many paths: the listing and the blob batch.
  it('starts two git processes for three hundred files, not three hundred', () => {
    spawns = 0
    const r = lib.filesAtBase(base, [...MANY, 'present.ts', 'empty.ts', 'no/such/file.ts'])
    expect(r.size).toBe(MANY.length + 3)
    expect(spawns).toBe(2)
  })

  // OR-130 through the batch: `cat-file` says `missing` for both facts, so the tree listing is what
  // tells them apart. An object the tree names but git cannot produce is UNREADABLE.
  it('calls an object the tree names but git cannot read unreadable, not absent', () => {
    const r = lib.readAtBase(base, ['gone.ts', 'after-gone.ts', 'no/such/file.ts'])
    expect(r.get('gone.ts')!.unreadable).toBe(true)
    expect(r.get('gone.ts')!.reason).toContain('missing')
    expect(r.get('after-gone.ts')).toEqual({ content: 'read from the same stream as the missing object\n', unreadable: false })
    expect(r.get('no/such/file.ts')).toEqual({ content: null, unreadable: false })
  })

  it('carries git’s reason out for a ref it cannot read', () => {
    const r = lib.showAtBase('or130-definitely-not-a-ref', 'present.ts')
    expect(r.unreadable).toBe(true)
    expect(r.reason).toContain('or130-definitely-not-a-ref')
  })

  it('answers null for every path, without git, when there is no base', () => {
    spawns = 0
    const r = lib.filesAtBase(null, ['present.ts', 'empty.ts'])
    expect([...r.values()]).toEqual([null, null])
    expect(spawns).toBe(0)
  })
})

// The ratchet half: a batched base read must still let a ratchet tell "the base already had it"
// from "this branch added it". Run against the fixture with `origin/main` at the base commit.
describe('a ratchet on the batch reader still fails when the count rises', () => {
  const runHex = () => {
    try {
      return execFileSync('node', ['scripts/check-hex-literals.js'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string }
      return `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
  }

  it('reports an unchanged over-baseline file as inherited', () => {
    write('components/hexy.tsx', 'export const X = () => <div style={{ color: "#ff0000" }} />\n')
    const out = runHex()
    expect(out).toContain('components/hexy.tsx: 1 against a baseline of 0, but the base branch already has 1')
    expect(out).not.toContain('components/hexy.tsx: 1 hex literal(s)')
  }, 30_000)

  it('fails the file once the branch adds one more', () => {
    write('components/hexy.tsx', 'export const X = () => <div style={{ color: "#ff0000", background: "#00ff00" }} />\n')
    const out = runHex()
    expect(out).toContain('components/hexy.tsx: 2 hex literal(s) — this file had none.')
    expect(out).not.toContain('components/hexy.tsx: 2 against a baseline')
  }, 30_000)

  it('fails a file the base does not have at all', () => {
    write('components/new-hexy.tsx', 'export const Y = () => <div style={{ color: "#123456" }} />\n')
    expect(runHex()).toContain('components/new-hexy.tsx: 1 hex literal(s) — this file had none.')
  }, 30_000)
})
