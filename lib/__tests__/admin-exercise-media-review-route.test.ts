/**
 * BF-147 — the GIF verdict route.
 *
 * The owner asked for *"a way to flag if its wrong so we can decide how to proceed"*. What the
 * entry establishes is that nothing like it existed: `needs_review`, `gif_status`, `verified`,
 * `approved`, `flagged`, `mismatch` and `reviewStatus` all return zero hits across every exercise
 * and media table, and the Feedback tab has no entity linkage and no status field, so it could hold
 * "this GIF is wrong" as text that the Exercises tab could never read.
 *
 * What these cases decide, in the order they matter:
 *
 *   · **Marking a GIF wrong NEVER regenerates it.** "So we can decide how to proceed" is a set to
 *     review, not an action to fire — coupling the verdict to an AI call would destroy the thing
 *     being collected. Asserted by the absence of any generation dependency in the route at all.
 *   · **A verdict about a GIF that does not exist is a 404, not an upsert.** Creating a media row
 *     from a review call would invent provenance for a generation that never happened.
 *   · **The GET returns the FLAGGED set, not everything** — `unreviewed` is the majority and is not
 *     news, which is also what the migration's partial index is shaped for.
 *   · **`unreviewed` clears `reviewed_at`**; every other verdict stamps it. A status that says
 *     "nobody has looked" while carrying a review time is a contradiction the column can express.
 *   · Admin-gated and rate-limited like its siblings (Q-134).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)

let selectRows: Row[] = []
let updateReturns: Row[] = []
const updateSet = vi.fn((_v: unknown) => undefined)

const db = {
  select: () => ({ from: () => ({ where: async () => selectRows }) }),
  update: () => ({
    set: (v: unknown) => {
      updateSet(v)
      return { where: () => ({ returning: async () => updateReturns }) }
    },
  }),
}

let sessionUser: { id: string; isAdmin?: boolean } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({ getUserById })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => db, ensureSchema: async () => undefined }))

const patch = async (body: unknown) => {
  const { PATCH } = await import('@/app/api/admin/exercise-media-review/route')
  return PATCH(new Request('http://localhost/api/admin/exercise-media-review', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}
const get = async () => {
  const { GET } = await import('@/app/api/admin/exercise-media-review/route')
  return GET()
}

beforeEach(() => {
  sessionUser = { id: 'u-1', isAdmin: true }
  selectRows = []
  updateReturns = [{ exerciseName: 'Barbell Shrug' }]
  updateSet.mockClear()
  rateLimit.mockClear().mockReturnValue(true)
})

describe('BF-147 — recording a verdict on a generated GIF', () => {
  it('marking one wrong stores the verdict and stamps the time', async () => {
    const res = await patch({ exerciseName: 'Barbell Shrug', status: 'wrong' })
    expect(res.status).toBe(200)
    const set = updateSet.mock.calls[0][0] as Row
    expect(set.reviewStatus).toBe('wrong')
    expect(set.reviewedAt).toBeInstanceOf(Date)
  })

  // The load-bearing one. The entry is explicit: "Keep the flag separate from regeneration."
  it('NEVER triggers a regeneration — the route imports no generation surface at all', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/api/admin/exercise-media-review/route.ts', 'utf8')
    for (const forbidden of ['generate-exercise-media', 'mirror-dataset-gifs', 'uploadExerciseMedia', 'generateObject', 'generateText']) {
      expect(src, `a verdict must not reach ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('clearing to unreviewed nulls the review time rather than leaving a stale one', async () => {
    await patch({ exerciseName: 'Barbell Shrug', status: 'unreviewed' })
    expect((updateSet.mock.calls[0][0] as Row).reviewedAt).toBeNull()
  })

  it('a verdict about an exercise with no media is 404, not a created row', async () => {
    updateReturns = []
    const res = await patch({ exerciseName: 'No Such Exercise', status: 'wrong' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No media for that exercise' })
  })

  it('refuses a status outside the three the column allows', async () => {
    expect((await patch({ exerciseName: 'Barbell Shrug', status: 'maybe' })).status).toBe(400)
  })

  it('refuses an unknown key rather than dropping it', async () => {
    // `.strict()`: a renamed field must be a 400, not a successful write of the wrong thing.
    const res = await patch({ exerciseName: 'Barbell Shrug', status: 'ok', regenerate: true })
    expect(res.status).toBe(400)
  })

  it('defaults gender rather than demanding it', async () => {
    expect((await patch({ exerciseName: 'Barbell Shrug', status: 'ok' })).status).toBe(200)
  })

  it('is admin-gated', async () => {
    sessionUser = { id: 'u-2', isAdmin: false }
    getUserById.mockResolvedValueOnce({ isAdmin: false })
    expect((await patch({ exerciseName: 'Barbell Shrug', status: 'ok' })).status).toBe(403)
  })

  it('is rate-limited like its sibling media routes', async () => {
    rateLimit.mockReturnValue(false)
    expect((await patch({ exerciseName: 'Barbell Shrug', status: 'ok' })).status).toBe(429)
  })
})

describe('BF-147 — the flagged set', () => {
  it('returns what was reviewed, which is the deliverable', async () => {
    selectRows = [
      { exerciseName: 'Fire Hydrant', gender: 'male', reviewStatus: 'wrong', gifUrl: 'https://x/a.gif' },
      { exerciseName: 'Machine Curl', gender: 'male', reviewStatus: 'ok', gifUrl: 'https://x/b.gif' },
    ]
    const body = await (await get()).json()
    expect(body.reviewed).toHaveLength(2)
    expect(body.reviewed[0].exerciseName).toBe('Fire Hydrant')
  })

  it('excludes unreviewed rows at the query, matching the partial index', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/api/admin/exercise-media-review/route.ts', 'utf8')
    // A client-side filter would read every one of 152 rows to return a handful.
    expect(src).toContain("ne(exerciseMedia.reviewStatus, 'unreviewed')")
  })

  it('is admin-gated too', async () => {
    sessionUser = null
    expect((await get()).status).toBe(403)
  })

  it('does not let an HTTP cache hold an admin answer', async () => {
    expect((await get()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
