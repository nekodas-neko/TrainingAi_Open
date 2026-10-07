// Sync parity vectors (#2490): every JSON vector in `packages/shared/src/sync/vectors/`, executed by
// the one runner against the shipped store and engine on `node:sqlite`. What a vector is, and why it
// is JSON rather than another test file, is in that directory's `schema.ts`.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sqlite/sqlite-service', () => import('./parity/node-sqlite-service'))
// `getLocalStore` loads the backend with a CommonJS `require`, which vitest's ESM loader cannot
// resolve for a .ts file, and it returns null with no `window`. Its only job is choosing a store —
// none of the behaviour a vector pins — so it hands out the real `SQLiteLocalStore` here.
vi.mock('../index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index')>()
  const { SQLiteLocalStore } = await import('../sqlite-backend')
  const store = new SQLiteLocalStore()
  return { ...actual, getLocalStore: () => store }
})

import { SYNCED_MUTATION_DOMAINS } from '@trainingai/shared/sync/mutation-schema'
import { PULL_FLAGS } from '@trainingai/shared/sync/vectors/schema'
import { loadVectors, runVector } from './parity/runner'
import { pullDelta, _resetSyncBackoff } from '../sync-engine'
import { openVectorDb } from './parity/node-sqlite-service'

const vectors = loadVectors()

describe('sync parity vectors', () => {
  for (const kind of ['incident', 'domain', 'pull-flag'] as const) {
    describe(kind, () => {
      for (const v of vectors.filter(x => x.kind === kind)) {
        // A known-failing vector stays red on purpose and names its issue; `it.fails` turns a fix
        // into a failure here, so the vector is promoted the day the defect is fixed.
        const run = v.knownFailing ? it.fails : it
        run(`${v.covers} — ${v.name}`, () => runVector(v))
      }
    })
  }
})

describe('vector coverage', () => {
  it('names are unique', () => {
    const names = vectors.map(v => v.name)
    expect(names.length).toBe(new Set(names).size)
  })

  it('pins every outbox domain with at least one vector', () => {
    const covered = new Set(vectors.filter(v => v.kind === 'domain').map(v => v.covers))
    expect(SYNCED_MUTATION_DOMAINS.filter(d => !covered.has(d))).toEqual([])
    expect([...covered].filter(d => !(SYNCED_MUTATION_DOMAINS as readonly string[]).includes(d))).toEqual([])
  })

  it('pins every pull flag with at least one vector', () => {
    const covered = new Set(vectors.filter(v => v.kind === 'pull-flag').map(v => v.covers))
    expect(PULL_FLAGS.filter(f => !covered.has(f))).toEqual([])
  })

  it('carries at least twenty incident vectors', () => {
    expect(vectors.filter(v => v.kind === 'incident').length).toBeGreaterThanOrEqual(20)
  })

  // The vector schema lists the flags so JSON can name them without importing the client. If the
  // engine grows a flag the list does not have, every pull-flag vector would still pass; this is
  // what makes that drift fail.
  it('lists exactly the flags a real pull reports', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        programs: [], progressionStyles: [], bodyMetrics: [], sleepSessions: [], moodLogs: [],
        activityLogs: [], workoutSessions: [], syncedAt: '2026-10-01T00:00:00.000Z',
      }),
    })))
    try {
      _resetSyncBackoff()
      openVectorDb()
      const res = await pullDelta('vector-user', true)
      expect(Object.keys(res!.domains).sort()).toEqual([...PULL_FLAGS].sort())
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
