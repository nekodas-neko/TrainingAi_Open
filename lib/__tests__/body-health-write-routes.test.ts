/**
 * PS-39 — the body/health writes: `injuries`, `fitness-tests`, `measured-rmr` and `blood-panel`.
 *
 * Batched because they are the four places a **clinical or measured** number enters this app, and
 * every one of them feeds something downstream that moves training or nutrition. What they share is
 * that their bounds are plausibility rather than validation theatre — a resting rate outside
 * 500–5000 kcal is a typo or a unit mix-up, and storing it silently moves the calorie target.
 *
 * Each carries a decision the response shape hides:
 *
 *   · **`blood-panel` accepts no patient identifiers.** `.strict()` is the de-identification
 *     guarantee: a body carrying a name or a date of birth is a 400 rather than a column nobody
 *     noticed. The analyte key is derived from the label server-side and never sent by the client,
 *     and `flagText` is stored verbatim as the provider's words rather than parsed into a verdict.
 *   · **Two labels that normalise to one key are refused by name**, rather than failing later as a
 *     driver error on the `(panel_id, analyte_key)` constraint.
 *   · **A cross-field plausibility rule catches what per-field bounds cannot** — 100,000 m in 1 s
 *     passed both of its own bounds, and its VO2max estimate then feeds every training zone.
 *   · **Every date is accepted with either separator and stored with dashes**, because the client's
 *     `localDateString()` emits slashes and the columns are `date`.
 *   · **A delete that matched nothing answers 404, the same as a panel that never existed**, so an
 *     id from another account cannot be probed for existence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { analyteKey } from '@trainingai/shared/health/analyte-keys'

type Row = Record<string, unknown>

const listInjuries = vi.fn(async (_u: string) => [] as Row[])
const createInjury = vi.fn(async (_u: string, d: Row) => ({ id: 'inj-1', ...d }) as Row)
const listFitnessTests = vi.fn(async (_u: string, _f: string, _t: string) => [] as Row[])
const saveFitnessTest = vi.fn(async (_u: string, d: Row) => d as Row)
const deleteFitnessTest = vi.fn(async (_u: string, _id: string) => undefined)
const listMeasuredRmr = vi.fn(async (_u: string) => [] as Row[])
const saveMeasuredRmr = vi.fn(async (_u: string, _d: Row) => undefined)
const saveBloodPanel = vi.fn(async (_u: string, d: Row) => ({ id: 'panel-1', ...d }) as Row)
const listBloodPanels = vi.fn(async (_u: string) => [] as Row[])
const deleteBloodPanel = vi.fn(async (_u: string, _id: string) => true)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    listInjuries, createInjury, listFitnessTests, saveFitnessTest, deleteFitnessTest,
    listMeasuredRmr, saveMeasuredRmr, saveBloodPanel, listBloodPanels, deleteBloodPanel,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as getInjuries, POST as postInjury } from '@/app/api/injuries/route'
import { GET as getTests, POST as postTest, DELETE as deleteTest } from '@/app/api/fitness-tests/route'
import { GET as getRmr, POST as postRmr } from '@/app/api/measured-rmr/route'
import { GET as getPanels, POST as postPanel, DELETE as deletePanel } from '@/app/api/blood-panel/route'

const PANEL = '00000000-0000-4000-8000-000000000e01'
const TEST_ID = '00000000-0000-4000-8000-000000000f01'

const send = (handler: (req: never) => Promise<Response>, url: string, method: string, body?: unknown) =>
  handler(Object.assign(new Request(`http://localhost${url}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { nextUrl: new URL(`http://localhost${url}`) }) as never)

const injury = (body: unknown) => send(postInjury as never, '/api/injuries', 'POST', body)
const test = (body: unknown) => send(postTest as never, '/api/fitness-tests', 'POST', body)
const delTest = (body: unknown) => send(deleteTest as never, '/api/fitness-tests', 'DELETE', body)
const tests = (query = '') =>
  getTests(Object.assign(new Request(`http://localhost/api/fitness-tests${query}`), {
    nextUrl: new URL(`http://localhost/api/fitness-tests${query}`),
  }) as never)
const rmr = (body: unknown) => send(postRmr as never, '/api/measured-rmr', 'POST', body)
const panel = (body: unknown) => send(postPanel as never, '/api/blood-panel', 'POST', body)
const delPanel = (query: string) =>
  deletePanel(new Request(`http://localhost/api/blood-panel${query}`, { method: 'DELETE' }) as never)

const validTest = (over: Row = {}) => ({
  testType: '6mwt', date: '2026-09-01', durationSec: 360, distanceM: 520, avgHr: 130, ...over,
})
const validRmr = (over: Row = {}) => ({ measuredOn: '2026-09-01', rmrKcal: 1750, ...over })
const analyte = (over: Row = {}) => ({ label: 'Ferritin', unit: 'ug/L', valueNum: 120, ...over })
const validPanel = (over: Row = {}) => ({
  collectedOn: '2026-09-01', analytes: [analyte()], ...over,
})

/** Fixed-offset zones, no DST: somewhere in here is always a different calendar day from any other. */
const OFFSET_ZONES = Array.from({ length: 27 }, (_, i) => `Etc/GMT${i - 14 >= 0 ? '+' : ''}${i - 14}`)

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  listInjuries.mockResolvedValue([])
  createInjury.mockImplementation(async (_u: string, d: Row) => ({ id: 'inj-1', ...d }))
  listFitnessTests.mockResolvedValue([])
  saveFitnessTest.mockImplementation(async (_u: string, d: Row) => d)
  listMeasuredRmr.mockResolvedValue([])
  saveBloodPanel.mockImplementation(async (_u: string, d: Row) => ({ id: 'panel-1', ...d }))
  listBloodPanels.mockResolvedValue([])
  deleteBloodPanel.mockResolvedValue(true)
})

describe('/api/injuries', () => {
  it('refuses both verbs without a session', async () => {
    sessionUser = null
    expect((await getInjuries()).status).toBe(401)
    expect((await injury({ muscleName: 'Hamstring', severity: 'mild' })).status).toBe(401)
  })

  // Q-484: this route had no schema while its PATCH sibling had a complete one, so a 10 MB `notes`
  // was stored and "not-a-date" reached the date arithmetic and 500'd.
  it('bounds what its PATCH sibling already bounded', async () => {
    for (const bad of [
      { muscleName: '' }, { muscleName: 'x'.repeat(101) }, { severity: 'agony' },
      { notes: 'y'.repeat(1001) }, { startedDate: 'not-a-date' }, { userId: 'someone-else' },
    ]) {
      expect((await injury({ muscleName: 'Hamstring', severity: 'mild', ...bad })).status).toBe(400)
    }
    expect(createInjury).not.toHaveBeenCalled()
  })

  it('refuses an oversized body', async () => {
    expect((await injury({ muscleName: 'Hamstring', severity: 'mild', notes: 'x'.repeat(32 * 1024) })).status).toBe(413)
  })

  // The column is a DATE and `2026/08/09` is DateStyle-dependent, so it must not reach the driver.
  it('accepts either separator and stores dashes', async () => {
    await injury({ muscleName: 'Hamstring', severity: 'mild', startedDate: '2026/08/09' })
    expect((createInjury.mock.calls[0][1] as Row).startedDate).toBe('2026-08-09')
  })

  // The zone is picked at run time rather than hardcoded, because a fixed one only disagrees with
  // the default for part of the day — `Etc/GMT-14` was the first attempt and the assertion held
  // against DEFAULT_TZ for twenty of every twenty-four hours, so the case proved nothing.
  it('defaults the start date to today in the caller\'s timezone', async () => {
    const elsewhere = OFFSET_ZONES.find(z => todayInTz(z) !== todayInTz(DEFAULT_TZ))
    expect(elsewhere).toBeDefined()

    freshUser({ timezone: elsewhere })
    await injury({ muscleName: 'Calf', severity: 'moderate' })
    expect((createInjury.mock.calls[0][1] as Row).startedDate).toBe(todayInTz(elsewhere!))
  })

  it('trims, nulls empty notes, and opens the injury unresolved', async () => {
    await injury({ muscleName: '  Hamstring  ', severity: 'severe', notes: '   ' })
    expect(createInjury.mock.calls[0][1]).toMatchObject({
      muscleName: 'Hamstring', severity: 'severe', notes: null, resolvedDate: null,
    })
  })

  it('lists only the caller\'s own, uncacheable', async () => {
    const res = await getInjuries()
    expect(listInjuries).toHaveBeenCalledWith(sessionUser!.id)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('/api/fitness-tests', () => {
  it('refuses every verb without a session', async () => {
    sessionUser = null
    expect((await tests()).status).toBe(401)
    expect((await test(validTest())).status).toBe(401)
    expect((await delTest({ id: TEST_ID })).status).toBe(401)
  })

  // Q-24 §7: distance and duration were bounded only on their own, so 100,000 m in 1 s passed —
  // a 360,000 km/h walk test whose VO2max estimate then feeds every training zone.
  it('refuses a result that is implausible only across its fields', async () => {
    const res = await test(validTest({ durationSec: 1, distanceM: 100_000 }))
    expect(res.status).toBe(400)
    expect(saveFitnessTest).not.toHaveBeenCalled()

    // The same 100 km over two hours is accepted, so the 400 above came from the pair rather than
    // from `distanceM`'s own ceiling — which is the only thing that makes this a cross-field test.
    expect((await test(validTest({ durationSec: 7200, distanceM: 100_000 }))).status).toBe(201)
  })

  // `avgHr`'s own `.max(250)` is fully shadowed by the cross-field rule, which rejects the same
  // 20-250 band — dropping it changes no response, so this case pins the behaviour and not the
  // guard that produces it.
  it('bounds each field too', async () => {
    for (const bad of [
      { testType: 'plank' }, { date: 'not-a-date' }, { avgHr: 300 },
      { vo2maxEst: 101 }, { durationSec: 0 }, { notes: 'x'.repeat(1001) },
    ]) {
      expect((await test(validTest(bad))).status).toBe(400)
    }
    expect(saveFitnessTest).not.toHaveBeenCalled()
  })

  // The route accepts a client id so an offline-first save keeps one row identity across both paths.
  it('keeps a client-supplied id and mints one otherwise', async () => {
    await test(validTest({ id: TEST_ID }))
    expect((saveFitnessTest.mock.calls[0][1] as Row).id).toBe(TEST_ID)

    saveFitnessTest.mockClear()
    await test(validTest())
    expect((saveFitnessTest.mock.calls[0][1] as Row).id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('clamps the lookback window and survives a junk days param', async () => {
    const windowFor = async (query: string) => {
      listFitnessTests.mockClear()
      await tests(query)
      const [, from, to] = listFitnessTests.mock.calls[0]
      return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    }
    expect(await windowFor('?days=30')).toBe(29)
    expect(await windowFor('?days=99999')).toBe(729)   // clamped to 730 days inclusive
    expect(await windowFor('?days=banana')).toBe(364)  // falls back to a year
    expect(await windowFor('')).toBe(364)
  })

  it('deletes only by a uuid, and nothing else in the body', async () => {
    for (const bad of [{}, { id: 'nope' }, { id: TEST_ID, userId: 'someone-else' }]) {
      expect((await delTest(bad)).status).toBe(400)
    }
    expect(deleteFitnessTest).not.toHaveBeenCalled()

    expect((await delTest({ id: TEST_ID })).status).toBe(200)
    expect(deleteFitnessTest).toHaveBeenCalledWith(sessionUser!.id, TEST_ID)
  })
})

describe('/api/measured-rmr', () => {
  it('refuses both verbs without a session', async () => {
    sessionUser = null
    expect((await getRmr()).status).toBe(401)
    expect((await rmr(validRmr())).status).toBe(401)
  })

  // Bounds are plausibility, not validation theatre: a rate outside this is a typo or a unit
  // mix-up, and storing it would silently move the calorie target.
  it('refuses a resting rate that is not a human one', async () => {
    for (const rmrKcal of [0, 499, 5001, 100_000, 1750.5]) {
      expect((await rmr(validRmr({ rmrKcal }))).status).toBe(400)
    }
    expect(saveMeasuredRmr).not.toHaveBeenCalled()

    expect((await rmr(validRmr({ rmrKcal: 500 }))).status).toBe(200)
    expect((await rmr(validRmr({ rmrKcal: 5000 }))).status).toBe(200)
  })

  it('bounds the body-composition figures the same way', async () => {
    for (const bad of [{ ffmKgAtTest: 5 }, { ffmKgAtTest: 250 }, { weightKgAtTest: 10 }, { weightKgAtTest: 500 }]) {
      expect((await rmr(validRmr(bad))).status).toBe(400)
    }
    expect(saveMeasuredRmr).not.toHaveBeenCalled()
  })

  it('rejects an unknown key and names what failed', async () => {
    const res = await rmr(validRmr({ userId: 'someone-else' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toHaveProperty('detail')
    expect(saveMeasuredRmr).not.toHaveBeenCalled()
  })

  it('accepts either separator and stores dashes', async () => {
    await rmr(validRmr({ measuredOn: '2026/09/01' }))
    expect((saveMeasuredRmr.mock.calls[0][1] as Row).measuredOn).toBe('2026-09-01')
  })

  // Two measurements at different body compositions are how you see whether the first still
  // describes this person, which is why the route returns the list rather than the latest.
  it('returns every measurement, not just the most recent', async () => {
    listMeasuredRmr.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }])
    expect((await (await getRmr()).json()).tests).toHaveLength(2)
  })
})

describe('/api/blood-panel', () => {
  it('refuses every verb without a session', async () => {
    sessionUser = null
    expect((await getPanels()).status).toBe(401)
    expect((await panel(validPanel())).status).toBe(401)
    expect((await delPanel(`?id=${PANEL}`)).status).toBe(401)
  })

  // The de-identification guarantee. `.strict()` is what makes a name or a date of birth a 400
  // rather than a column nobody noticed.
  it('refuses a body carrying a patient identifier', async () => {
    for (const identifier of [
      { patientName: 'Sam Smith' }, { name: 'Sam Smith' }, { dateOfBirth: '1990-01-01' },
      { dob: '1990-01-01' }, { medicareNumber: '1234567890' }, { userId: 'someone-else' },
    ]) {
      expect((await panel(validPanel(identifier))).status).toBe(400)
    }
    expect(saveBloodPanel).not.toHaveBeenCalled()
  })

  // The normalised key is derived here, never sent by the client.
  it('derives the analyte key from the label and refuses one supplied by the caller', async () => {
    expect((await panel(validPanel({ analytes: [analyte({ analyteKey: 'anything' })] }))).status).toBe(400)

    await panel(validPanel({ analytes: [analyte({ label: 'Ferritin' })] }))
    const stored = (saveBloodPanel.mock.calls[0][1] as { analytes: Row[] }).analytes[0]
    expect(stored.analyteKey).toBe(analyteKey('Ferritin'))
    expect(stored.label).toBe('Ferritin')
  })

  // Two labels normalising to one key would collide on `(panel_id, analyte_key)` and fail as a
  // driver error; rejecting here names the problem instead.
  it('names the collision when two results normalise to one analyte', async () => {
    const res = await panel(validPanel({
      analytes: [analyte({ label: 'Ferritin' }), analyte({ label: '  ferritin  ' })],
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('normalise to the same analyte')
    expect(saveBloodPanel).not.toHaveBeenCalled()
  })

  it('stores the provider\'s own words verbatim rather than a verdict', async () => {
    await panel(validPanel({ analytes: [analyte({ flagText: 'H — above reference' })] }))
    const stored = (saveBloodPanel.mock.calls[0][1] as { analytes: Row[] }).analytes[0]
    expect(stored.flagText).toBe('H — above reference')
    expect(stored.unit).toBe('ug/L')
    expect(stored.valueNum).toBe(120)
  })

  it('keeps a month-precision panel honest about what it knows', async () => {
    await panel(validPanel({ collectedOn: '2026/09/01', datePrecision: 'month' }))
    expect(saveBloodPanel.mock.calls[0][1]).toMatchObject({
      collectedOn: '2026-09-01', datePrecision: 'month', source: 'manual', labName: null,
    })
  })

  it('400s a date-shaped string that is not a real day', async () => {
    expect((await panel(validPanel({ collectedOn: '2026-13-45' }))).status).toBe(400)
    expect(saveBloodPanel).not.toHaveBeenCalled()
  })

  it('bounds the panel size and the body', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => analyte({ label: `Analyte ${i}` }))
    expect((await panel(validPanel({ analytes: many(201) }))).status).toBe(400)
    expect((await panel(validPanel({ labName: 'x'.repeat(200 * 1024) }))).status).toBe(413)
    expect(saveBloodPanel).not.toHaveBeenCalled()

    // Distinct labels, so the 400 above is the size bound rather than the collision check firing
    // first — which is what 201 copies of one analyte were actually testing.
    expect((await panel(validPanel({ analytes: many(200) }))).status).toBe(200)
  })

  it('rate-limits the twenty-first panel in the minute', async () => {
    for (let i = 0; i < 20; i++) expect((await panel(validPanel())).status).toBe(200)
    expect((await panel(validPanel())).status).toBe(429)
  })

  // `false` means the panel is not this user's, which answers the same as not existing — so an id
  // from another account cannot be probed for existence.
  it('answers 404 for a panel that is not the caller\'s, exactly as for one that never existed', async () => {
    expect((await delPanel('')).status).toBe(400)   // no id at all is a different question

    deleteBloodPanel.mockResolvedValue(false)
    const notMine = await delPanel(`?id=${PANEL}`)
    expect(notMine.status).toBe(404)
    expect(await notMine.json()).toEqual({ error: 'Not found' })

    deleteBloodPanel.mockResolvedValue(true)
    expect((await delPanel(`?id=${PANEL}`)).status).toBe(200)
  })

  it('answers no-store on every path', async () => {
    expect((await getPanels()).headers.get('Cache-Control')).toBe('private, no-store')
    expect((await panel(validPanel())).headers.get('Cache-Control')).toBe('private, no-store')
    expect((await delPanel(`?id=${PANEL}`)).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
