/**
 * Issue 2247 — a ~2 s raw-frame read ran ~1.5 times a minute in production and nothing could say who
 * was making it. The query's shape fits the rollup and `getOuraRawSamplesForTags` equally.
 *
 * The attribution is application-side (a named caller and a slow-read log line), not a SQL comment:
 * `pg_stat_statements` hashes the parse tree, which ignores comments, so tagged callers would still
 * share one entry. These pin the log, that a real read produces it, and — by discovery — that every
 * caller names itself, so a new untagged one cannot slip back in.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { reportRawFrameRead, SLOW_RAW_READ_MS } from '../slices/oura-raw-frames'
import { stripComments } from '../../../../scripts/lib/strip-comments.js'
import { callsUnderArity } from '../../../../scripts/lib/call-arity.js'

const root = join(__dirname, '..', '..', '..', '..')

afterEach(() => { vi.restoreAllMocks() })

describe('reportRawFrameRead', () => {
  it('is silent below the threshold and logs at it', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    reportRawFrameRead(SLOW_RAW_READ_MS - 1, 10, { caller: 'rollup' })
    expect(info).not.toHaveBeenCalled()
    reportRawFrameRead(SLOW_RAW_READ_MS, 10, { caller: 'rollup' })
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('names the caller, the size and the shape of the read', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    reportRawFrameRead(2100, 136_976, { caller: 'rollup', tags: [1, 2, 3], startDs: 900_000 })
    const line = String(info.mock.calls[0][0])
    expect(line).toContain('[raw-frames] slow read: 2100 ms')
    expect(line).toContain('136976 frames')
    expect(line).toContain('caller=rollup')
    expect(line).toContain('tags=3')
    expect(line).toContain('startDs=900000')
    expect(line).toContain('endDs=none')
  })

  it('calls an unnamed caller untagged, so a gap in the naming shows up in the log', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    reportRawFrameRead(5000, 1, {})
    const line = String(info.mock.calls[0][0])
    expect(line).toContain('caller=untagged')
    expect(line).toContain('tags=all')
  })
})

const canRun = !!process.env.DATABASE_URL
describe.skipIf(!canRun)('readRawFrames against the database', () => {
  let db: ReturnType<typeof import('../client').getDb>
  beforeAll(async () => {
    const { getDb, ensureSchema } = await import('../client')
    await ensureSchema()
    db = getDb()
  })

  it('logs a slow read with its caller and stays silent on a fast one', async () => {
    const { readRawFrames } = await import('../slices/oura-raw-frames')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const USER = '00000000-0000-4000-8000-000000002247'

    await readRawFrames(db, USER, { tags: [0x5d], caller: 'test-fast' })
    expect(info.mock.calls.filter(c => String(c[0]).includes('[raw-frames]'))).toHaveLength(0)

    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(2000)
    await readRawFrames(db, USER, { tags: [0x5d], startDs: 5, caller: 'test-slow' })
    now.mockRestore()
    const lines = info.mock.calls.map(c => String(c[0])).filter(l => l.includes('[raw-frames]'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('caller=test-slow')
    expect(lines[0]).toContain('2000 ms')
  })
})

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) { if (!['node_modules', '__tests__', '.next', '__check_fixture__'].includes(e.name)) out.push(...sourceFiles(rel)) }
    else if (/\.tsx?$/.test(e.name)) out.push(rel)
  }
  return out
}

describe('every caller names itself (discovery)', () => {
  const files = ['app', 'lib', 'packages'].flatMap(sourceFiles)
  const code = (rel: string) => stripComments(readFileSync(join(root, rel), 'utf8'))

  it('every direct readRawFrames(db, …) call passes a caller', () => {
    const offenders: string[] = []
    let seen = 0
    for (const rel of files) {
      if (rel === 'lib/data/postgres/slices/oura-raw-frames.ts') continue
      const src = code(rel)
      for (const m of src.matchAll(/\breadRawFrames\(\s*(?:this\.db|db)\b[^)]*\)/g)) {
        seen++
        // The call may span a `{ … }` with parens inside; look at a window past the match start.
        const at = m.index ?? 0
        const window = src.slice(at, at + 220)
        if (!/\bcaller\b/.test(window)) offenders.push(`${rel}: ${m[0].slice(0, 80)}`)
      }
    }
    expect(seen, 'the scan matched no readRawFrames calls at all').toBeGreaterThanOrEqual(8)
    expect(offenders).toEqual([])
  })

  it('every getOuraRawSamplesForTags call outside the adapter passes a caller as its fourth argument', () => {
    const offenders: string[] = []
    let seen = 0
    for (const rel of files) {
      if (rel === 'lib/data/postgres/adapter.ts' || rel === 'lib/data/repository.ts') continue
      const src = code(rel)
      if (!src.includes('getOuraRawSamplesForTags(')) continue
      seen++
      for (const hit of callsUnderArity(src, 'getOuraRawSamplesForTags', 4)) offenders.push(`${rel}: ${hit.slice(0, 80)}`)
    }
    expect(seen).toBeGreaterThanOrEqual(1)
    expect(offenders).toEqual([])
  })

  it('the adapter’s own call to it names the refit', () => {
    const src = code('lib/data/postgres/adapter.ts')
    expect(callsUnderArity(src, 'this.getOuraRawSamplesForTags', 4)).toEqual([])
  })
})
