// #3890 step 2: the five weekly check-in routes. The engine is mocked (its behaviour is
// lib/data/postgres/__tests__/weekly-checkin-engine-3890.test.ts, against a real Postgres); these cases
// pin what the routes own: the user and timezone come from the session and never the body, signed out
// is a 401, every body is strict Zod (a 400 before the engine runs), each route has its own rate limit,
// and an engine refusal keeps its status and code.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  user: null as null | { id: string; timezone?: string },
  calls: [] as Array<{ fn: string; ctx: { userId: string; tz: string }; args: unknown[] }>,
  refuse: null as null | { status: 400 | 404 | 409; code: string },
}))
vi.mock('@/auth', () => ({ auth: async () => (h.user ? { user: h.user } : null) }))
vi.mock('@/lib/data/postgres/client', () => ({ ensureSchema: async () => undefined, getDb: () => ({}) }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => ({}) }))
vi.mock('@/lib/weekly-checkin/engine', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/weekly-checkin/engine')>()
  const fake = (fn: string) => async (ctx: { userId: string; tz: string }, ...args: unknown[]) => {
    h.calls.push({ fn, ctx: { userId: ctx.userId, tz: ctx.tz }, args })
    if (h.refuse) throw new real.CheckinRefusal(h.refuse.status, h.refuse.code, `refused: ${h.refuse.code}`)
    return { ok: fn }
  }
  return {
    ...real,
    readCheckinState: fake('readCheckinState'),
    saveCheckin: fake('saveCheckin'),
    dismissCheckin: fake('dismissCheckin'),
    resolveOffer: fake('resolveOffer'),
    undoCheckinEffect: fake('undoCheckinEffect'),
  }
})

const { GET } = await import('../route')
const { POST: SAVE } = await import('../save/route')
const { POST: DISMISS } = await import('../dismiss/route')
const { POST: OFFER } = await import('../offer/route')
const { POST: UNDO } = await import('../undo/route')

const ID = '11111111-1111-4111-8111-111111111111'
const LIFT = '22222222-2222-4222-8222-222222222222'
const post = (body: unknown) => new Request('http://local.test/api/weekly-checkin', { method: 'POST', body: JSON.stringify(body) })
const SAVE_BODY = {
  weekStart: '2026/11/16',
  lifts: [{ sessionExerciseId: LIFT, answer: 'heavy' }],
  pain: { sessionExerciseId: LIFT, where: 'left knee' },
  swap: null,
  daysOff: [6, 7],
  shorterSessionMin: 40,
}
let userN = 0
beforeEach(() => {
  // A fresh user per case, so one case's rate-limit count is not the next one's.
  h.user = { id: `33333333-3333-4333-8333-${String(++userN).padStart(12, '0')}`, timezone: 'Europe/London' }
  h.calls = []
  h.refuse = null
})

describe('signed out: 401 on every route, and the engine never runs', () => {
  it.each([
    ['GET state', () => GET(new Request('http://local.test/api/weekly-checkin'))],
    ['save', () => SAVE(post(SAVE_BODY))],
    ['dismiss', () => DISMISS(post({ weekStart: '2026-11-16' }))],
    ['offer', () => OFFER(post({ checkinId: ID, decision: 'decline', offer: { kind: 'pain' } }))],
    ['undo', () => UNDO(post({ checkinId: ID, target: { kind: 'days_off' } }))],
  ])('%s', async (_name, call) => {
    h.user = null
    const res = await call()
    expect(res.status).toBe(401)
    expect(h.calls).toEqual([])
  })
})

describe('signed in: the session\'s user and timezone, never the body\'s', () => {
  it('GET passes the session user and zone, and the answer is private, no-store', async () => {
    const res = await GET(new Request('http://local.test/api/weekly-checkin?userId=someone-else'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(h.calls).toEqual([{ fn: 'readCheckinState', ctx: { userId: h.user!.id, tz: 'Europe/London' }, args: [] }])
  })

  it('a session without a zone uses the default one', async () => {
    h.user = { id: h.user!.id }
    await GET(new Request('http://local.test/api/weekly-checkin'))
    expect(h.calls[0].ctx.tz).toBe('Australia/Brisbane')
  })

  it('save: the body reaches the engine parsed, with a slash date normalised to the week key', async () => {
    const res = await SAVE(post(SAVE_BODY))
    expect(res.status).toBe(200)
    expect(h.calls[0]).toEqual({
      fn: 'saveCheckin', ctx: { userId: h.user!.id, tz: 'Europe/London' },
      args: [{ ...SAVE_BODY, weekStart: '2026-11-16' }],
    })
  })

  it('dismiss, offer and undo call their engine function with the parsed body', async () => {
    await DISMISS(post({ weekStart: '2026-11-16' }))
    await OFFER(post({ checkinId: ID, decision: 'accept', offer: { kind: 'step_up', liftId: LIFT } }))
    await UNDO(post({ checkinId: ID, target: { kind: 'lift', liftId: LIFT } }))
    expect(h.calls.map(c => [c.fn, c.args])).toEqual([
      ['dismissCheckin', ['2026-11-16']],
      ['resolveOffer', [ID, { kind: 'step_up', liftId: LIFT }, 'accept']],
      ['undoCheckinEffect', [ID, { kind: 'lift', liftId: LIFT }]],
    ])
  })
})

describe('strict bodies: a 400 before the engine runs', () => {
  it.each([
    ['a user id in the body', { ...SAVE_BODY, userId: ID }],
    ['a lift id that is not a uuid', { ...SAVE_BODY, lifts: [{ sessionExerciseId: 'bench', answer: 'heavy' }] }],
    ['an answer outside the three', { ...SAVE_BODY, lifts: [{ sessionExerciseId: LIFT, answer: 'too heavy' }] }],
    ['"where" over 200 characters', { ...SAVE_BODY, pain: { sessionExerciseId: LIFT, where: 'x'.repeat(201) } }],
    ['an empty "where"', { ...SAVE_BODY, pain: { sessionExerciseId: LIFT, where: '   ' } }],
    ['a weekday 8', { ...SAVE_BODY, daysOff: [8] }],
    ['a session under the shortest length a preset may ask for', { ...SAVE_BODY, shorterSessionMin: 10 }],
    ['a session over 240 minutes', { ...SAVE_BODY, shorterSessionMin: 241 }],
    ['a date that is not a calendar date', { ...SAVE_BODY, weekStart: '2026-02-30' }],
    ['a field the save does not have', { ...SAVE_BODY, effect: 'lowered_one_step' }],
  ])('save: %s', async (_name, body) => {
    const res = await SAVE(post(body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request body' })
    expect(h.calls).toEqual([])
  })

  it.each([
    ['offer: an unknown kind', OFFER, { checkinId: ID, decision: 'accept', offer: { kind: 'deload' } }],
    ['offer: a change id smuggled into a step up', OFFER, { checkinId: ID, decision: 'accept', offer: { kind: 'step_up', liftId: LIFT, changeId: ID } }],
    ['offer: a decision outside accept / decline', OFFER, { checkinId: ID, decision: 'apply', offer: { kind: 'pain' } }],
    ['undo: a check-in id that is not a uuid', UNDO, { checkinId: 'mine', target: { kind: 'days_off' } }],
    ['dismiss: no week', DISMISS, {}],
  ] as const)('%s', async (_name, route, body) => {
    const res = await route(post(body))
    expect(res.status).toBe(400)
    expect(h.calls).toEqual([])
  })

  it('a body that is not JSON is a 400', async () => {
    const res = await SAVE(new Request('http://local.test/api/weekly-checkin/save', { method: 'POST', body: '{nope' }))
    expect(res.status).toBe(400)
  })
})

describe('an engine refusal keeps its status and code', () => {
  it.each([[404, 'not_found'], [409, 'undo_first'], [409, 'not_open'], [400, 'muscle']] as const)('%s %s', async (status, code) => {
    h.refuse = { status, code }
    const res = await OFFER(post({ checkinId: ID, decision: 'accept', offer: { kind: 'pain' } }))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: `refused: ${code}`, code })
  })
})

describe('each route has its own rate limit, per user', () => {
  it('the 11th save in a minute is a 429; another route is still open', async () => {
    for (let i = 0; i < 10; i++) expect((await SAVE(post(SAVE_BODY))).status).toBe(200)
    expect((await SAVE(post(SAVE_BODY))).status).toBe(429)
    expect((await DISMISS(post({ weekStart: '2026-11-16' }))).status).toBe(200)
    expect(h.calls.filter(c => c.fn === 'saveCheckin')).toHaveLength(10)
  })
})
