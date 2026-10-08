// Issue 2667 — a night removed on the Sleep screen is a local tombstone plus a queued removal, and
// `/api/sleep-sessions` keeps returning it until the outbox pushes. A screen that sets that reply
// straight into state shows the night again. `withPendingManualWrites` (via `sleepReplyWithPending`)
// is the one place that applies the device's own unpushed writes.
//
// Every module that fetches the route, or reads its cache entry, must call one of them or be listed
// below with the reason it need not. A stale entry (the module no longer reads the route, or now
// calls the helper) fails too, so the list cannot rot.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'

const root = join(__dirname, '..', '..')
const SCAN = ['app', 'lib', 'packages', 'components', 'hooks']
const SKIP_DIR = new Set(['node_modules', '.next', '__tests__', '__check_fixture__', 'e2e', 'test-results', 'migrations'])

function walk(dir: string, out: string[] = []): string[] {
  let names: string[]
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (SKIP_DIR.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** The list route itself (not `/api/sleep-sessions/manual`), or its cache entry read synchronously. */
const READS_ROUTE = /\/api\/sleep-sessions(?![\w/-])|readCacheSync<[^>]*>\(\s*['"]sleep-sessions['"]/
const APPLIES_PENDING = /\b(?:withPendingManualWrites|sleepReplyWithPending|useSleepReply)\b/

const ALLOWED: { file: string; reason: string }[] = [
  {
    file: 'components/sync-provider.tsx',
    reason: 'Cache warm-up only: it stores the raw reply under the key and renders nothing. Every screen that reads the key applies the pending writes itself.',
  },
]

function readers() {
  const out: { file: string; applies: boolean }[] = []
  for (const top of SCAN) {
    for (const f of walk(join(root, top))) {
      const src = stripComments(readFileSync(f, 'utf8'))
      if (READS_ROUTE.test(src)) {
        out.push({ file: relative(root, f).split(sep).join('/'), applies: APPLIES_PENDING.test(src) })
      }
    }
  }
  return out
}

describe("readers of /api/sleep-sessions apply this device's pending manual-night writes (issue 2667)", () => {
  const found = readers()

  it('finds the screens that read the route (the scan is not vacuous)', () => {
    const files = found.map(r => r.file)
    for (const f of [
      'app/health/health-content.tsx',
      'app/health/sleep/sleep-content.tsx',
      'app/session-select/session-select-content.tsx',
      'components/more/details/measured-overview-section.tsx',
    ]) expect(files).toContain(f)
  })

  it('every reader calls the helper or is allowlisted with a reason', () => {
    const allowed = new Set(ALLOWED.map(a => a.file))
    const bad = found.filter(r => !r.applies && !allowed.has(r.file)).map(r => r.file)
    expect(bad, `read /api/sleep-sessions without withPendingManualWrites / sleepReplyWithPending: ${bad.join(', ')}`).toEqual([])
  })

  it('the allowlist has no stale entry', () => {
    for (const a of ALLOWED) {
      expect(a.reason.length).toBeGreaterThan(20)
      const r = found.find(x => x.file === a.file)
      expect(r, `${a.file} no longer reads /api/sleep-sessions: drop it from ALLOWED`).toBeDefined()
      expect(r!.applies, `${a.file} now applies the helper: drop it from ALLOWED`).toBe(false)
    }
  })
})
