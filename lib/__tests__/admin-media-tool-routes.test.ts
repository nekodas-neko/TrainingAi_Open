/**
 * PS-39 — the two admin media tools: `admin/reference-figure` and `admin/mirror-dataset-gifs`.
 *
 * **These two were CHANGED in [#1019] without any route test.** That PR rewrote
 * `check-admin-guard-catch.js` and fixed twelve Q-548 sites; nine of them, including both of these,
 * were held only by the check and its self-test. Covering them was the highest-value work left on
 * the list for exactly that reason — a mechanical sweep is the kind of change that looks obviously
 * right and is worth verifying anyway.
 *
 * What each decides:
 *
 *   · **A refusal is 403 and a check that could not run is 503** — the fix from #1019, now pinned at
 *     the route rather than only by a static check.
 *   · **`mirror-dataset-gifs` skips an exercise that already has a GIF unless `force`**, because the
 *     alternative is re-downloading and re-uploading the whole library on every press.
 *   · **A failed download is 502, not 500.** The dataset is upstream of us; a bad response there is
 *     a gateway problem, and calling it our fault sends the reader into our own logs.
 *   · **With storage unconfigured it falls back to a data URL and SAYS SO** — `storageMode` reports
 *     which path ran, and the response masks the data URL rather than returning a megabyte of
 *     base64 that no reader wants and no log should hold.
 *   · **`reference-figure` GET treats a missing object as `url: null`**, not an error: "no reference
 *     figure uploaded yet" is the normal state of a fresh install.
 *
 * Fixture discipline (the PS-39 note): the already-has-a-GIF row carries a real URL, and the
 * companion case carries a **null** one — a fixture with only the first cannot tell "a row exists"
 * from "a row with a GIF exists", which is the actual condition.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)
const downloadMedia = vi.fn(async (_k: string) => null as unknown)
const uploadExerciseMedia = vi.fn(async (..._a: unknown[]) => 'https://cdn.example/x.gif' as string | null)
const isStorageConfigured = vi.fn(() => true)
const findDirectUrl = vi.fn((_n: string) => null as Row | null)
const findBestMatch = vi.fn((_n: string) => null as Row | null)
const loadDataset = vi.fn(async () => undefined)

/** Rows the next `db.select(...)` chain resolves to. */
let selectRows: Row[] = []
const insertValues = vi.fn((..._a: unknown[]) => undefined)
const onConflictDoUpdate = vi.fn((..._a: unknown[]) => undefined)

/** A chainable stand-in for Drizzle: only the shapes these two routes actually build. */
const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => selectRows }) }) }),
  insert: () => ({
    values: (v: unknown) => {
      insertValues(v)
      return { onConflictDoUpdate: async (c: unknown) => { onConflictDoUpdate(c) } }
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
vi.mock('@/lib/exercise-storage', () => ({
  downloadMedia: (k: string) => downloadMedia(k),
  uploadExerciseMedia: (...a: unknown[]) => uploadExerciseMedia(...a),
  isStorageConfigured: () => isStorageConfigured(),
  mediaKey: (name: string, gender: string, kind: string) => `exercise-media/${name}-${gender}.${kind}`,
  REFERENCE_FIGURE_KEY: 'exercise-media/reference-figure.png',
}))
vi.mock('@trainingai/shared/exercise-gif-matcher', () => ({
  loadDataset: () => loadDataset(),
  findDirectUrl: (n: string) => findDirectUrl(n),
  findBestMatch: (n: string) => findBestMatch(n),
  DATASET_BASE: 'https://dataset.example',
}))

import { GET as figureGet, POST as figurePost } from '@/app/api/admin/reference-figure/route'
import { POST as mirror } from '@/app/api/admin/mirror-dataset-gifs/route'

const mirrorReq = (body?: unknown) =>
  mirror(new Request('http://localhost/api/admin/mirror-dataset-gifs', body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

const uploadReq = (file?: File) => {
  const fd = new FormData()
  if (file) fd.set('file', file)
  return figurePost(new Request('http://localhost/api/admin/reference-figure', { method: 'POST', body: fd }))
}

beforeEach(() => {
  for (const m of [getUserById, rateLimit, downloadMedia, uploadExerciseMedia, isStorageConfigured,
                   findDirectUrl, findBestMatch, loadDataset, insertValues, onConflictDoUpdate]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  downloadMedia.mockResolvedValue(null)
  uploadExerciseMedia.mockResolvedValue('https://cdn.example/x.gif')
  isStorageConfigured.mockReturnValue(true)
  findDirectUrl.mockReturnValue(null)
  findBestMatch.mockReturnValue(null)
  selectRows = []
  sessionUser = { id: 'u-1', isAdmin: true }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })))
})

describe('the admin gate on both media tools (the #1019 fix, pinned at the route)', () => {
  const ALL: [string, () => Promise<Response>][] = [
    ['reference-figure GET', () => figureGet()],
    ['reference-figure POST', () => uploadReq(new File(['x'], 'f.png'))],
    ['mirror POST', () => mirrorReq({ exerciseName: 'Squat' })],
  ]

  it('refuses a non-admin, whatever the token claims', async () => {
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(403)
    expect(uploadExerciseMedia).not.toHaveBeenCalled()
  })

  it('answers 503 when the CHECK could not run (Q-548)', async () => {
    // The half #1019 fixed on these files. Held until now only by a static check and its self-test;
    // this is the first time the route itself is asked.
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ALL) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })

  it('answers 403 rather than 401 with no session at all — pinned, not endorsed', async () => {
    // These two resolve the id as `session?.user?.id ?? ''` and hand the empty string to
    // `requireAdmin`, which throws `AdminError` — so an anonymous caller is told "Forbidden" where
    // every sibling route says "Unauthorized". Harmless (nothing leaks either way) but inconsistent,
    // and worth stating rather than leaving for someone to trip over.
    sessionUser = null
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(403)
  })

  it('rate-limits both, at the same Q-134 allowance', async () => {
    rateLimit.mockReturnValue(false)
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(429)
    for (const call of rateLimit.mock.calls) expect(call.slice(1)).toEqual([10, 60_000])
    expect(uploadExerciseMedia).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/mirror-dataset-gifs', () => {
  it('skips an exercise that already has a GIF', async () => {
    selectRows = [{ gifUrl: 'https://cdn.example/existing.gif' }]
    const res = await mirrorReq({ exerciseName: 'Squat' })
    expect(await res.json()).toEqual({ status: 'exists', exerciseName: 'Squat' })
    expect(loadDataset).not.toHaveBeenCalled()
    expect(uploadExerciseMedia).not.toHaveBeenCalled()
  })

  it('does NOT skip a row that exists with a null GIF', async () => {
    // **The condition is "has a GIF", not "has a row".** A fixture carrying only the first case
    // cannot tell the two apart, and the difference decides whether a half-written row is ever
    // repaired.
    selectRows = [{ gifUrl: null }]
    findDirectUrl.mockReturnValue({ gifUrl: 'https://dataset.example/squat.gif' })
    const res = await mirrorReq({ exerciseName: 'Squat' })
    expect((await res.json()).status).toBe('mirrored')
  })

  it('re-mirrors when forced, without even asking whether one exists', async () => {
    selectRows = [{ gifUrl: 'https://cdn.example/existing.gif' }]
    findDirectUrl.mockReturnValue({ gifUrl: 'https://dataset.example/squat.gif' })
    const res = await mirrorReq({ exerciseName: 'Squat', force: true })
    expect((await res.json()).status).toBe('mirrored')
    expect(uploadExerciseMedia).toHaveBeenCalled()
  })

  it('falls back from a direct hit to the fuzzy matcher, and reports no_match when neither lands', async () => {
    findDirectUrl.mockReturnValue(null)
    findBestMatch.mockReturnValue({ gif_url: 'fuzzy/squat.gif' })
    await mirrorReq({ exerciseName: 'Squat' })
    expect(globalThis.fetch).toHaveBeenCalledWith('https://dataset.example/fuzzy/squat.gif', expect.anything())

    findBestMatch.mockReturnValue(null)
    insertValues.mockClear()
    const res = await mirrorReq({ exerciseName: 'Nonesuch' })
    expect(await res.json()).toEqual({ status: 'no_match', exerciseName: 'Nonesuch' })
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('answers 502 when the dataset download fails — it is upstream, not us', async () => {
    // A 500 here sends the reader into our own logs for a problem that is entirely someone else's
    // server. Both shapes: a bad status, and a thrown fetch.
    findDirectUrl.mockReturnValue({ gifUrl: 'https://dataset.example/squat.gif' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    expect((await mirrorReq({ exerciseName: 'Squat' })).status).toBe(502)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ETIMEDOUT') }))
    expect((await mirrorReq({ exerciseName: 'Squat' })).status).toBe(502)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('falls back to a data URL without storage, says which path ran, and does not echo the payload', async () => {
    // Returning the base64 would put a megabyte of GIF in the response and in whatever logs it.
    // `storageMode` is what makes the fallback visible instead of silent.
    isStorageConfigured.mockReturnValue(false)
    findDirectUrl.mockReturnValue({ gifUrl: 'https://dataset.example/squat.gif' })
    const body = await (await mirrorReq({ exerciseName: 'Squat' })).json()
    expect(body).toMatchObject({ status: 'mirrored', storageMode: 'db-fallback', gifUrl: '[data-url]' })
    expect(uploadExerciseMedia).not.toHaveBeenCalled()
    expect(String((insertValues.mock.calls[0][0] as Row).gifUrl)).toMatch(/^data:image\/gif;base64,/)
  })

  it('stores the uploaded URL and reports the s3 path when storage is configured', async () => {
    findDirectUrl.mockReturnValue({ gifUrl: 'https://dataset.example/squat.gif' })
    const body = await (await mirrorReq({ exerciseName: 'Squat' })).json()
    expect(body).toMatchObject({ status: 'mirrored', storageMode: 's3', gifUrl: 'https://cdn.example/x.gif' })
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      exerciseName: 'Squat', gender: 'male', modelUsed: 'dataset-mirror',
    }))
    expect(onConflictDoUpdate).toHaveBeenCalled()
  })

  it('refuses a body it cannot use, and 413s an oversized one', async () => {
    for (const b of [{}, { exerciseName: '' }, { exerciseName: 'Squat', extra: 1 }, { exerciseName: 42 }]) {
      loadDataset.mockClear()
      expect((await mirrorReq(b)).status, JSON.stringify(b)).toBe(400)
      expect(loadDataset).not.toHaveBeenCalled()
    }
    expect((await mirrorReq({ exerciseName: 'Squat', pad: 'x'.repeat(9 * 1024) })).status).toBe(413)
  })
})

describe('/api/admin/reference-figure', () => {
  it('reports no figure as a null url rather than an error', async () => {
    // The normal state of a fresh install. A 404 here would read as a broken admin screen.
    downloadMedia.mockResolvedValue(null)
    expect(await (await figureGet()).json()).toEqual({ url: null, storageConfigured: true })
  })

  it('survives a storage read that throws, and derives the public path from the key', async () => {
    downloadMedia.mockRejectedValue(new Error('S3 unreachable'))
    expect((await (await figureGet()).json()).url).toBeNull()

    downloadMedia.mockResolvedValue(Buffer.from('png'))
    expect((await (await figureGet()).json()).url).toBe('/exercise-media/reference-figure.png')
  })

  it('refuses an upload with storage unconfigured, before touching the body', async () => {
    isStorageConfigured.mockReturnValue(false)
    const res = await uploadReq(new File(['x'], 'f.png'))
    expect(res.status).toBe(400)
    expect(uploadExerciseMedia).not.toHaveBeenCalled()
  })

  it('refuses an upload with no file', async () => {
    expect((await uploadReq()).status).toBe(400)
    expect(uploadExerciseMedia).not.toHaveBeenCalled()
  })

  it('uploads under the reference key as a PNG', async () => {
    uploadExerciseMedia.mockResolvedValue('https://cdn.example/reference-figure.png')
    const res = await uploadReq(new File([new Uint8Array([137, 80, 78, 71])], 'f.png'))
    expect(res.status).toBe(200)
    const [key, buf, mime] = uploadExerciseMedia.mock.calls[0] as [string, Buffer, string]
    expect(key).toBe('exercise-media/reference-figure.png')
    expect(mime).toBe('image/png')
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(await res.json()).toEqual({ url: 'https://cdn.example/reference-figure.png' })
  })
})
