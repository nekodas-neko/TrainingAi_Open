/**
 * PS-39 — three admin tools that reach the same guard and nothing else in common:
 * `admin/generate-exercise-media`, `admin/model-assets` and `admin/fix-exercise-units`.
 *
 * **`generate-exercise-media` was CHANGED in [#1019] and still had no test of its own** — two of the
 * twelve Q-548 sites that PR fixed are in this file, held until now only by a static check and its
 * self-test. That is why it heads the batch.
 *
 * What each decides:
 *
 *   · **A refusal is 403 and a check that could not run is 503** (Q-548), at the route rather than
 *     only in `check-admin-guard-catch.js`.
 *   · **`generate-exercise-media` skips an exercise that already has a GIF unless `force`** — the
 *     alternative is paying for a regeneration on every press of a button whose whole purpose is to
 *     fill gaps.
 *   · **A generation failure is 500 and writes nothing**, so a half-generated pair never reaches
 *     `exercise_media` and reads later as a real picture.
 *   · **`model-assets` says where the models are actually being served from** — and, below, that
 *     answer was naming a source that no longer exists.
 *   · **`fix-exercise-units` routes on `apply`**: the same body is a read or a whole-history
 *     rewrite depending on one boolean, and nothing else in the request distinguishes them.
 *
 * Not exercised: Drizzle is a chainable stand-in, so no SQL runs — what is pinned is which values
 * reach the select and the upsert. Image generation, GIF encoding and object storage are all mocked;
 * this says nothing about whether a generated frame is any good.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => ({ isAdmin: true }) as Row | null)
const rateLimit = vi.fn((..._a: unknown[]) => true)
const generateExercisePair = vi.fn(async (..._a: unknown[]) => ({
  start: Buffer.from('start-png'),
  end: Buffer.from('end-png'),
}))
const createExerciseGif = vi.fn(async (..._a: unknown[]) => Buffer.from('gif-bytes'))
const uploadExerciseMedia = vi.fn(async (..._a: unknown[]) => 'https://cdn.example/x' as string | null)
const isStorageConfigured = vi.fn(() => true)
const downloadMedia = vi.fn(async (_k: string) => null as unknown)

const listLoggedExerciseNames = vi.fn(async (_u: string) => ['Bench Press', 'Squat'])
const previewLbsToKgFix = vi.fn(async (..._a: unknown[]) => ({ logs: [], preview: true } as Row))
const applyLbsToKgFix = vi.fn(async (..._a: unknown[]) => ({ logs: [], applied: true } as Row))

const reportModelBucketAssets = vi.fn(async () => ({ verdict: 'complete', missing: [], empty: [] } as Row))
const reportConstantsBucketAssets = vi.fn(async () => ({ verdict: 'complete', missing: [], empty: [] } as Row))
const verifyModelAssets = vi.fn(async (_dir: string) => ({ ok: false, missing: ['a.onnx'], empty: [] }))

/** Rows the next `select(...).from(...)` chain resolves to, keyed by the table it reads. */
let mediaRows: Row[] = []
let libraryRows: Row[] = []
const insertValues = vi.fn((..._a: unknown[]) => undefined)
const conflictSet = vi.fn((..._a: unknown[]) => undefined)

/**
 * A chainable stand-in for Drizzle, only the shapes these routes build.
 *
 * The two handlers select from different tables, and the GET selects from both in one
 * `Promise.all` — so the stand-in has to route by table rather than return one list, or the two
 * reads become indistinguishable and every assertion about either of them is really about both.
 */
const rowsFor = (t: unknown) => {
  const name = (t as { __table?: string } | null)?.__table
  return name === 'media' ? mediaRows : name === 'library' ? libraryRows : []
}

const db = {
  select: (_cols?: unknown) => ({
    from: (t: unknown) => {
      const rows = rowsFor(t)
      const thenable = Promise.resolve(rows)
      return Object.assign(thenable, {
        where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }),
        orderBy: async () => rows,
        limit: async () => rows,
      })
    },
  }),
  insert: (_t: unknown) => ({
    values: (v: unknown) => {
      insertValues(v)
      return { onConflictDoUpdate: async (c: Row) => { conflictSet(c) } }
    },
  }),
}

let sessionUser: { id: string; isAdmin?: boolean; timezone?: string } | null = { id: 'u-1', isAdmin: true }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserById,
    listLoggedExerciseNames: (...a: unknown[]) => listLoggedExerciseNames(...(a as [string])),
    previewLbsToKgFix: (...a: unknown[]) => previewLbsToKgFix(...a),
    applyLbsToKgFix: (...a: unknown[]) => applyLbsToKgFix(...a),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => db, ensureSchema: async () => undefined }))
vi.mock('@/lib/data/postgres/schema', () => ({
  exerciseMedia: { __table: 'media', exerciseName: 'm.name', gender: 'm.gender', gifUrl: 'm.gif', generatedAt: 'm.at', modelUsed: 'm.model' },
  exerciseLibrary: { __table: 'library', name: 'l.name', muscles: 'l.muscles' },
}))
vi.mock('@/lib/exercise-image-gen', () => ({
  generateExercisePair: (...a: unknown[]) => generateExercisePair(...a),
  DEFAULT_MODEL: 'gemini-3.1-flash-image-preview',
}))
vi.mock('@/lib/exercise-gif-creator', () => ({ createExerciseGif: (...a: unknown[]) => createExerciseGif(...a) }))
vi.mock('@/lib/exercise-storage', () => ({
  uploadExerciseMedia: (...a: unknown[]) => uploadExerciseMedia(...a),
  isStorageConfigured: () => isStorageConfigured(),
  downloadMedia: (k: string) => downloadMedia(k),
  mediaKey: (name: string, gender: string, kind: string) => `exercise-media/${name}-${gender}.${kind}`,
  REFERENCE_FIGURE_KEY: 'exercise-media/reference-figure.png',
}))
vi.mock('@/lib/oura-models/bucket-report', () => ({
  reportModelBucketAssets: () => reportModelBucketAssets(),
  reportConstantsBucketAssets: () => reportConstantsBucketAssets(),
}))
vi.mock('@/lib/oura-models/required-models', () => ({
  verifyModelAssets: (d: string) => verifyModelAssets(d),
  REQUIRED_MODEL_FILES: ['a.onnx', 'b.onnx'],
}))

import { GET as mediaGet, POST as mediaPost } from '@/app/api/admin/generate-exercise-media/route'
import { GET as assetsGet } from '@/app/api/admin/model-assets/route'
import { GET as unitsGet, POST as unitsPost } from '@/app/api/admin/fix-exercise-units/route'

const genReq = (body?: unknown) =>
  mediaPost(new Request('http://localhost/api/admin/generate-exercise-media', body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

const unitReq = (body: unknown) =>
  unitsPost(new Request('http://localhost/api/admin/fix-exercise-units', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never)

const GEN_BODY = { exerciseName: 'Bench Press', gender: 'male' as const }
const UNIT_BODY = { exerciseNames: ['Bench Press'], beforeDate: '2026-01-31' }

beforeEach(() => {
  for (const m of [getUserById, rateLimit, generateExercisePair, createExerciseGif, uploadExerciseMedia,
                   isStorageConfigured, downloadMedia, listLoggedExerciseNames, previewLbsToKgFix,
                   applyLbsToKgFix, reportModelBucketAssets, reportConstantsBucketAssets,
                   verifyModelAssets, insertValues, conflictSet]) m.mockClear()
  rateLimit.mockReturnValue(true)
  getUserById.mockResolvedValue({ isAdmin: true })
  generateExercisePair.mockResolvedValue({ start: Buffer.from('start-png'), end: Buffer.from('end-png') })
  createExerciseGif.mockResolvedValue(Buffer.from('gif-bytes'))
  uploadExerciseMedia.mockResolvedValue('https://cdn.example/x')
  isStorageConfigured.mockReturnValue(true)
  downloadMedia.mockResolvedValue(null)
  reportModelBucketAssets.mockResolvedValue({ verdict: 'complete', missing: [], empty: [] })
  reportConstantsBucketAssets.mockResolvedValue({ verdict: 'complete', missing: [], empty: [] })
  verifyModelAssets.mockResolvedValue({ ok: false, missing: ['a.onnx'], empty: [] })
  mediaRows = []
  libraryRows = []
  sessionUser = { id: 'u-1', isAdmin: true }
  delete process.env.OURA_CONSTANTS_DIR
})

afterEach(() => { delete process.env.OURA_CONSTANTS_DIR })

describe('the admin gate on all three tools', () => {
  const ALL: [string, () => Promise<Response>][] = [
    ['generate GET', () => mediaGet()],
    ['generate POST', () => genReq(GEN_BODY)],
    ['model-assets GET', () => assetsGet()],
    ['fix-units GET', () => unitsGet()],
    ['fix-units POST', () => unitReq(UNIT_BODY)],
  ]

  it('refuses a non-admin, whatever the token claims', async () => {
    // `isAdmin: true` in the session and `false` in the database. `requireAdmin` reads the database,
    // so setting only the claim would leave every one of these answering 200 — the fixture has to
    // disagree with itself or it tests nothing.
    sessionUser = { id: 'u-1', isAdmin: true }
    getUserById.mockResolvedValue({ isAdmin: false })
    for (const [name, call] of ALL) expect((await call()).status, name).toBe(403)
    expect(generateExercisePair).not.toHaveBeenCalled()
    expect(applyLbsToKgFix).not.toHaveBeenCalled()
  })

  it('answers 503 when the CHECK could not run, not 403 (Q-548)', async () => {
    getUserById.mockRejectedValue(new Error('connection terminated unexpectedly'))
    for (const [name, call] of ALL) {
      const res = await call()
      expect(res.status, name).toBe(503)
      expect(await res.json(), name).toEqual({ error: 'Service unavailable' })
    }
  })

  it('turns an anonymous caller away, and the two families disagree on how', async () => {
    // Pinned, not endorsed. `generate-exercise-media` resolves the id as `?? ''` and hands the empty
    // string to `requireAdmin`, which throws — so it says 403 where its siblings say 401. Nothing
    // leaks either way; the inconsistency is the finding.
    sessionUser = null
    expect((await mediaGet()).status).toBe(403)
    expect((await genReq(GEN_BODY)).status).toBe(403)
    for (const [name, call] of [['model-assets', () => assetsGet()], ['fix-units GET', () => unitsGet()],
                                ['fix-units POST', () => unitReq(UNIT_BODY)]] as [string, () => Promise<Response>][]) {
      const res = await call()
      expect(res.status, name).toBe(401)
      expect(await res.json(), name).toEqual({ error: 'Unauthorized' })
    }
  })
})

describe('POST /api/admin/generate-exercise-media', () => {
  it('rate-limits at the Q-134 allowance, before generating anything', async () => {
    rateLimit.mockReturnValue(false)
    expect((await genReq(GEN_BODY)).status).toBe(429)
    expect((await mediaGet()).status).toBe(429)
    for (const call of rateLimit.mock.calls) expect(call.slice(1)).toEqual([10, 60_000])
    expect(generateExercisePair).not.toHaveBeenCalled()
  })

  it('skips an exercise that already has a GIF', async () => {
    mediaRows = [{ gifUrl: 'https://cdn.example/existing.gif' }]
    const res = await genReq(GEN_BODY)
    expect(await res.json()).toEqual({ status: 'exists', exerciseName: 'Bench Press', gender: 'male' })
    expect(generateExercisePair).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('does NOT skip a row that exists with a null GIF', async () => {
    // The condition is "has a GIF", not "has a row". A fixture with only the previous case cannot
    // tell the two apart, and a row whose generation failed halfway is exactly the one that needs
    // another go.
    mediaRows = [{ gifUrl: null }]
    const res = await genReq(GEN_BODY)
    expect((await res.json()).status).toBe('generated')
    expect(generateExercisePair).toHaveBeenCalledTimes(1)
  })

  it('regenerates over an existing GIF when force is set', async () => {
    mediaRows = [{ gifUrl: 'https://cdn.example/existing.gif' }]
    const res = await genReq({ ...GEN_BODY, force: true })
    expect((await res.json()).status).toBe('generated')
    expect(generateExercisePair).toHaveBeenCalledTimes(1)
  })

  it('passes only main and secondary muscles to the prompt', async () => {
    // The library row carries roles the generator has no use for. A fixture whose muscles are all
    // `main` would pass whether the filter ran or not.
    libraryRows = [{ muscles: [
      { muscle: 'chest', role: 'main' },
      { muscle: 'triceps', role: 'secondary' },
      { muscle: 'forearms', role: 'stabiliser' },
      { role: 'main' },
    ] }]
    await genReq(GEN_BODY)
    expect(generateExercisePair.mock.calls[0][2]).toEqual([
      { muscle: 'chest', role: 'main' },
      { muscle: 'triceps', role: 'secondary' },
    ])
  })

  it('answers 500 and writes nothing when generation fails', async () => {
    generateExercisePair.mockRejectedValue(new Error('quota exhausted'))
    const res = await genReq(GEN_BODY)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('quota exhausted')
    expect(createExerciseGif).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('stores the three URLs it uploaded, and the model it used', async () => {
    uploadExerciseMedia.mockImplementation(async (key: unknown) => `https://cdn.example/${String(key)}`)
    const res = await genReq({ ...GEN_BODY, model: 'some-other-model' })
    const body = await res.json()
    expect(body.storageMode).toBe('s3')
    expect(body.gifUrl).toBe('https://cdn.example/exercise-media/Bench Press-male.gif')
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      exerciseName: 'Bench Press',
      gender: 'male',
      modelUsed: 'some-other-model',
      startUrl: 'https://cdn.example/exercise-media/Bench Press-male.start',
      endUrl: 'https://cdn.example/exercise-media/Bench Press-male.end',
      gifUrl: 'https://cdn.example/exercise-media/Bench Press-male.gif',
    }))
  })

  it('falls back to a data URL when storage is unconfigured, and masks it in the response', async () => {
    isStorageConfigured.mockReturnValue(false)
    const res = await genReq(GEN_BODY)
    const body = await res.json()
    expect(body.storageMode).toBe('db-fallback')
    expect(body.gifUrl).toBe('[data-url]')
    // The default model is reported and stored, not left blank — the column is how a later sweep
    // finds which pictures came from a model that has since been replaced.
    expect(body.model).toBe('gemini-3.1-flash-image-preview')
    expect((insertValues.mock.calls[0][0] as Row).modelUsed).toBe('gemini-3.1-flash-image-preview')
    expect(uploadExerciseMedia).not.toHaveBeenCalled()
    // Masked in the response, stored in full — the row has to hold the bytes or nothing renders.
    expect(String((insertValues.mock.calls[0][0] as Row).gifUrl))
      .toBe(`data:image/gif;base64,${Buffer.from('gif-bytes').toString('base64')}`)
  })

  it('falls back to a data URL when a CONFIGURED upload returns nothing, and SAYS so (LA-87)', async () => {
    // Two different failures reach the same branch. This one used to leave `storageMode: 's3'` — a
    // report saying the upload path ran while the row holds base64 — and PS-39 pinned that
    // disagreement deliberately, as current behaviour, because the fix was a decision rather than
    // an obvious line. LA-87 made the decision: report the path TAKEN.
    //
    // The assertion flipping is the point. A characterisation test earns its keep by failing when
    // the thing it characterises is fixed; this one caught the change on the first full run.
    uploadExerciseMedia.mockResolvedValue(null)
    const res = await genReq(GEN_BODY)
    const body = await res.json()
    expect(body.storageMode).toBe('db-fallback')
    expect(body.gifUrl).toBe('[data-url]')
  })

  it('refuses a body it cannot parse, and one that is too large', async () => {
    expect((await genReq({ exerciseName: 'Bench Press' })).status).toBe(400)
    expect((await genReq({ ...GEN_BODY, gender: 'other' })).status).toBe(400)
    expect((await genReq({ ...GEN_BODY, extra: 1 })).status).toBe(400)
    const big = await genReq({ ...GEN_BODY, model: 'x'.repeat(9 * 1024) })
    expect(big.status).toBe(413)
    expect(generateExercisePair).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/generate-exercise-media', () => {
  it('pairs each library exercise with its two genders, counting each separately', async () => {
    // **Two male rows and one female, deliberately.** A fixture with one of each makes the two
    // counters equal, and swapping the predicate on either of them then changes nothing — a mutant
    // that reports the male total from the female rows survived exactly that shape. The counts have
    // to disagree or neither is being tested.
    libraryRows = [{ name: 'Bench Press' }, { name: 'Squat' }]
    mediaRows = [
      { exerciseName: 'Bench Press', gender: 'male', gifUrl: 'https://cdn.example/bp-m.gif' },
      { exerciseName: 'Squat', gender: 'male', gifUrl: 'https://cdn.example/sq-m.gif' },
      { exerciseName: 'Squat', gender: 'female', gifUrl: 'https://cdn.example/sq-f.gif' },
    ]
    const body = await (await mediaGet()).json()
    expect(body.total).toBe(2)
    expect(body.generatedMale).toBe(2)
    expect(body.generatedFemale).toBe(1)
    expect(body.exercises[0].male?.gifUrl).toBe('https://cdn.example/bp-m.gif')
    expect(body.exercises[0].female).toBeNull()
    expect(body.exercises[1].male?.gifUrl).toBe('https://cdn.example/sq-m.gif')
    expect(body.exercises[1].female?.gifUrl).toBe('https://cdn.example/sq-f.gif')
  })

  it('keeps an exercise with no media at all, rather than dropping it', async () => {
    // The screen exists to find the gaps, so the un-generated rows are the ones that matter most.
    libraryRows = [{ name: 'Bench Press' }]
    mediaRows = []
    const body = await (await mediaGet()).json()
    expect(body.exercises).toEqual([{ name: 'Bench Press', male: null, female: null }])
    expect(body.total).toBe(1)
  })
})

describe('GET /api/admin/model-assets', () => {
  it('names object storage when the bucket has every model', async () => {
    const body = await (await assetsGet()).json()
    expect(body.servingFrom).toBe('object storage')
    expect(body.requiredCount).toBe(2)
  })

  it('names the repo tree only when the repo tree actually has them', async () => {
    reportModelBucketAssets.mockResolvedValue({ verdict: 'incomplete', missing: ['a.onnx'], empty: [] })
    verifyModelAssets.mockResolvedValue({ ok: true, missing: [], empty: [] })
    expect((await (await assetsGet()).json()).servingFrom).toBe('the repo tree (fallback)')
  })

  it('says nothing is serving when neither source is complete', async () => {
    // The bug this route was written to expose, in the route itself: the `.onnx` files left the repo
    // in Q-49 A4b, so a non-complete bucket used to be reported as "the repo tree (fallback)" —
    // naming a source that has been deleted, in the same payload as a `disk` report listing every
    // file as missing. The answer now comes from both halves.
    reportModelBucketAssets.mockResolvedValue({ verdict: 'unreachable', missing: [], empty: [] })
    verifyModelAssets.mockResolvedValue({ ok: false, missing: ['a.onnx', 'b.onnx'], empty: [] })
    const body = await (await assetsGet()).json()
    expect(body.servingFrom).toBe('nothing — neither source has every model')
    expect(body.disk.missing).toEqual(['a.onnx', 'b.onnx'])
  })

  it('reports the constants directory the loader settled on at boot', async () => {
    process.env.OURA_CONSTANTS_DIR = '/srv/constants'
    expect((await (await assetsGet()).json()).constants.servingFrom).toBe('/srv/constants')
  })

  it('says the constants loader will throw when nothing was delivered', async () => {
    // Deliberately asymmetric with the models above: the constants loader is synchronous and reads
    // whichever directory boot chose, so there is no per-request fallback to report.
    expect((await (await assetsGet()).json()).constants.servingFrom)
      .toBe('not delivered — the loader will throw')
  })
})

describe('/api/admin/fix-exercise-units', () => {
  it('lists the caller’s own logged exercise names', async () => {
    const body = await (await unitsGet()).json()
    expect(listLoggedExerciseNames).toHaveBeenCalledWith('u-1')
    expect(body).toEqual({ exerciseNames: ['Bench Press', 'Squat'] })
  })

  it('previews without writing when apply is absent or false', async () => {
    // `apply` is the whole difference between a read and a rewrite of logged history, and it is one
    // optional boolean in a body that is otherwise identical. Both spellings of "no" are checked
    // because an absent flag and an explicit `false` reach the default through different paths.
    await unitReq(UNIT_BODY)
    await unitReq({ ...UNIT_BODY, apply: false })
    expect(previewLbsToKgFix).toHaveBeenCalledTimes(2)
    expect(applyLbsToKgFix).not.toHaveBeenCalled()
  })

  it('writes only when apply is true, with the caller’s timezone', async () => {
    sessionUser = { id: 'u-1', isAdmin: true, timezone: 'Europe/Berlin' }
    const res = await unitReq({ ...UNIT_BODY, apply: true })
    expect(await res.json()).toEqual({ logs: [], applied: true })
    expect(previewLbsToKgFix).not.toHaveBeenCalled()
    expect(applyLbsToKgFix).toHaveBeenCalledWith('u-1', ['Bench Press'], '2026-01-31', 'Europe/Berlin')
  })

  it('falls back to the default timezone, not the server’s', async () => {
    sessionUser = { id: 'u-1', isAdmin: true }
    await unitReq(UNIT_BODY)
    expect(previewLbsToKgFix).toHaveBeenCalledWith('u-1', ['Bench Press'], '2026-01-31', 'Australia/Brisbane')
  })

  it('refuses an empty name list and a malformed date, and touches nothing', async () => {
    // An empty list would otherwise mean "convert nothing", which is harmless, and a bad date would
    // reach the repository's own arithmetic. Both are 400 here.
    expect((await unitReq({ ...UNIT_BODY, exerciseNames: [] })).status).toBe(400)
    expect((await unitReq({ ...UNIT_BODY, beforeDate: '31-01-2026' })).status).toBe(400)
    expect((await unitReq({ ...UNIT_BODY, extra: true })).status).toBe(400)
    expect(previewLbsToKgFix).not.toHaveBeenCalled()
    expect(applyLbsToKgFix).not.toHaveBeenCalled()
  })

  it('accepts the dash form its one client sends', async () => {
    // The house rule says a date param takes both separators, because `localDateString()` emits
    // slashes. This one is filled by an `<input type="date">` in `components/admin/
    // exercise-unit-fix.tsx`, which emits dashes and nothing else — so dash-only is correct here,
    // and this pins the agreement rather than the regex.
    expect((await unitReq({ ...UNIT_BODY, beforeDate: '2026-01-31' })).status).toBe(200)
  })

  it('refuses a body that is not JSON, separately from one that is invalid', async () => {
    const res = await unitsPost(new Request('http://localhost/api/admin/fix-exercise-units', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ not json',
    }) as never)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid JSON' })
  })
})
