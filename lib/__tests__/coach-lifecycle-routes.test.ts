/**
 * PS-39 — AI Coach's write lifecycle at the ROUTE layer: `coach/preview`, `coach/apply`,
 * `coach/apply/[id]/undo` and `coach/threads`.
 *
 * **The engine is already covered and this is deliberately not that.** `lib/coach/apply.ts` and
 * `consequences.ts` have a DB-backed suite (`lib/data/postgres/__tests__/coach-apply.test.ts`) that
 * exercises ownership-by-join, staleness, stacked changes and the library checks against real rows.
 * What has never been tested is the layer above it: the guards, the body bounds, and — the reason
 * this file exists — **the "you've trained since this change" window, which lives in the undo ROUTE
 * and nowhere else**, so the engine's suite cannot see it.
 *
 * The decisions pinned here:
 *
 *   · **Undo's window is until your next workout, not a clock** (owner decision). An hour is too
 *     short if you applied it at night and too long if you trained ten minutes later; what matters
 *     is whether the change has already shaped a session you have done.
 *   · **Stale is 409, not 400.** The request was well-formed and the world moved — the widget
 *     renders that as "out of date, ask again" rather than a generic failure.
 *   · **Apply writes only the accepted ids** and records the rest, so what the assistant suggested
 *     stays part of the history rather than only what was taken.
 *   · **Preview exists so the model cannot author a consequence.** `proposeChange` has no
 *     `execute`, so its arguments come straight from the model — fine for a patch the user
 *     confirms field by field, unacceptable for a claim like "this drops your weekly lower-back
 *     sets", which the user cannot check. The model proposes; the server measures.
 *   · **Every write path invalidates the program structure**, or the screens keep painting the
 *     pre-change program from cache.
 *
 * **What this file does NOT establish.** The undo route's two inline Drizzle queries are answered
 * by a stub, so what is pinned is the branch each result takes — not that the SQL predicate
 * (`startedAt > appliedAt`, scoped to the caller) selects the right rows. That needs real Postgres,
 * and the note is here rather than left for a reader to discover.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const applyCoachPatch = vi.fn(async (..._a: unknown[]) => ({ ok: true, changeId: 'ch-1', summary: 'Swapped' }) as Row)
const undoCoachChange = vi.fn(async (..._a: unknown[]) => ({ ok: true, summary: 'Reverted' }) as Row)
const previewPatch = vi.fn(async (..._a: unknown[]) => ({ target: { id: 't-1' }, consequences: [] }) as Row)
const listThreads = vi.fn(async (..._a: unknown[]) => [] as Row[])
const listAppliedChanges = vi.fn(async (..._a: unknown[]) => [] as Row[])
const saveThread = vi.fn(async (..._a: unknown[]) => 'thread-1')
const loadThread = vi.fn(async (..._a: unknown[]) => null as Row[] | null)
const invalidateProgramStructure = vi.fn(async () => undefined)

/** What the undo route's two inline queries return, in order: the change row, then the
 *  trained-since row. `undefined` is "no row", which is what the route branches on. */
let dbRows: (Row | undefined)[] = []
const makeDb = () => {
  const chain = () => {
    const self: Row = {}
    for (const m of ['from', 'where', 'innerJoin', 'orderBy']) self[m] = () => self
    self.limit = async () => {
      const next = dbRows.shift()
      return next === undefined ? [] : [next]
    }
    return self
  }
  return { select: () => chain() }
}

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data/postgres/client', () => ({
  getDb: () => makeDb(),
  ensureSchema: async () => undefined,
}))
vi.mock('@/lib/coach/apply', () => ({
  applyCoachPatch: (...a: unknown[]) => applyCoachPatch(...a),
  undoCoachChange: (...a: unknown[]) => undoCoachChange(...a),
}))
vi.mock('@/lib/coach/consequences', () => ({ previewPatch: (...a: unknown[]) => previewPatch(...a) }))
vi.mock('@/lib/coach/threads', () => ({
  listThreads: (...a: unknown[]) => listThreads(...a),
  listAppliedChanges: (...a: unknown[]) => listAppliedChanges(...a),
  saveThread: (...a: unknown[]) => saveThread(...a),
  loadThread: (...a: unknown[]) => loadThread(...a),
}))
vi.mock('@/lib/cache-groups', () => ({ invalidateProgramStructure: () => invalidateProgramStructure() }))

import { POST as postApply } from '@/app/api/coach/apply/route'
import { POST as postUndo } from '@/app/api/coach/apply/[id]/undo/route'
import { POST as postPreview } from '@/app/api/coach/preview/route'
import { GET as getThreads, POST as postThreads } from '@/app/api/coach/threads/route'

const CHANGE = '00000000-0000-4000-8000-0000000000c1'
const TARGET = '00000000-0000-4000-8000-0000000000c2'

const patch = (over: Row = {}) => ({
  domain: 'session_exercise',
  targetId: TARGET,
  changes: [{ id: 'c1', field: 'exerciseName', from: 'Deadlift', to: 'RDL' }],
  ...over,
})

const send = (handler: (r: Request) => Promise<Response>, url: string, body: unknown) =>
  handler(new Request(`http://localhost${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

const apply = (body: unknown) => send(postApply, '/api/coach/apply', body)
const preview = (body: unknown) => send(postPreview, '/api/coach/preview', body)
const saveThreadReq = (body: unknown) => send(postThreads, '/api/coach/threads', body)
const undo = (id: string) =>
  postUndo(new Request(`http://localhost/api/coach/apply/${id}/undo`, { method: 'POST' }),
    { params: Promise.resolve({ id }) })
const threads = (query = '') =>
  getThreads(new Request(`http://localhost/api/coach/threads${query}`))

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
}

/** The undo route reads the change row first, then looks for a workout started after it. */
const APPLIED_AT = new Date('2026-09-01T00:00:00Z')
const undoRows = (change: Row | undefined, trained: Row | undefined) => { dbRows = [change, trained] }

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  dbRows = []
  applyCoachPatch.mockResolvedValue({ ok: true, changeId: 'ch-1', summary: 'Swapped' })
  undoCoachChange.mockResolvedValue({ ok: true, summary: 'Reverted' })
  previewPatch.mockResolvedValue({ target: { id: 't-1' }, consequences: [] })
  listThreads.mockResolvedValue([])
  listAppliedChanges.mockResolvedValue([])
  loadThread.mockResolvedValue(null)
  saveThread.mockResolvedValue('thread-1')
})

describe('/api/coach/preview', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await preview(patch())).status).toBe(401)
  })

  // The model proposes; the server measures. A consequence the model authored is one the user
  // cannot check, which is the whole reason this route exists rather than a field in the tool call.
  it('measures against the caller\'s own rows and returns what it measured', async () => {
    previewPatch.mockResolvedValue({ target: { id: TARGET }, consequences: [{ label: 'Lower back sets', delta: -6 }] })
    const res = await preview(patch())

    expect(res.status).toBe(200)
    expect((await res.json()).consequences).toEqual([{ label: 'Lower back sets', delta: -6 }])
    const [, userId, given] = previewPatch.mock.calls[0]
    expect(userId).toBe(sessionUser!.id)
    expect(given).toMatchObject({ domain: 'session_exercise', targetId: TARGET })
  })

  // A preview is a read, so a target that is not the caller's answers as one that never existed.
  it('answers 404 when the patch names no target it can find', async () => {
    previewPatch.mockResolvedValue({ target: null })
    expect((await preview(patch())).status).toBe(404)
  })

  it('refuses a patch the schema does not recognise', async () => {
    for (const bad of [
      patch({ domain: 'payroll' }),
      patch({ changes: [] }),
      patch({ changes: [{ id: 'c1', field: 'calories', from: 'x', to: 'y' }] }),  // wrong type for the field
      patch({ targetId: 'not-a-uuid' }),
      { nope: true },
    ]) {
      expect((await preview(bad)).status).toBe(400)
    }
    expect(previewPatch).not.toHaveBeenCalled()
  })

  it('answers 500 rather than leaking the fault when the measurement throws', async () => {
    previewPatch.mockRejectedValue(new Error('boom'))
    const res = await preview(patch())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Preview failed' })
  })
})

describe('/api/coach/apply', () => {
  const body = (over: Row = {}) => ({ patch: patch(), acceptedChangeIds: ['c1'], ...over })

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await apply(body())).status).toBe(401)
  })

  // What the assistant suggested is part of the history; only what was accepted is written.
  it('passes the accepted ids through and invalidates the program on success', async () => {
    const res = await apply(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changeId: 'ch-1', summary: 'Swapped' })

    const [, userId, given, accepted] = applyCoachPatch.mock.calls[0]
    expect(userId).toBe(sessionUser!.id)
    expect(given).toMatchObject({ targetId: TARGET })
    expect(accepted).toEqual(['c1'])
    expect(invalidateProgramStructure).toHaveBeenCalled()
  })

  // A patch of two with one accepted: the whole patch reaches the engine as the record, and only
  // the accepted id is written. A one-change fixture cannot tell those two apart.
  it('sends the whole patch but accepts only the rows the user took', async () => {
    const twoChanges = patch({ changes: [
      { id: 'c1', field: 'exerciseName', from: 'Deadlift', to: 'RDL' },
      { id: 'c2', field: 'position', from: 0, to: 1 },
    ] })
    await apply({ patch: twoChanges, acceptedChangeIds: ['c2'] })

    const [, , given, accepted] = applyCoachPatch.mock.calls[0]
    expect((given as { changes: Row[] }).changes.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(accepted).toEqual(['c2'])
  })

  // 409 rather than 400: the request was well-formed, the world moved. The widget renders that as
  // "out of date — ask again", which a generic 400 cannot say.
  it('answers 409 with the drift when the proposal has gone stale', async () => {
    applyCoachPatch.mockResolvedValue({ ok: false, reason: 'stale', drift: [{ field: 'exerciseName', now: 'Squat' }] })
    const res = await apply(body())

    expect(res.status).toBe(409)
    expect((await res.json()).drift).toEqual([{ field: 'exerciseName', now: 'Squat' }])
    expect(invalidateProgramStructure).not.toHaveBeenCalled()
  })

  it('maps the engine\'s other refusals to their own statuses', async () => {
    applyCoachPatch.mockResolvedValue({ ok: false, reason: 'not_found' })
    expect((await apply(body())).status).toBe(404)

    applyCoachPatch.mockResolvedValue({ ok: false, reason: 'invalid', detail: 'Not in the exercise library' })
    const res = await apply(body())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Not in the exercise library')
  })

  // Two rows carrying one id makes "accept this one" ambiguous, so it is refused by name rather
  // than resolved arbitrarily at write time.
  it('refuses a patch whose change ids collide', async () => {
    const res = await apply(body({
      patch: patch({ changes: [
        { id: 'c1', field: 'exerciseName', from: 'Deadlift', to: 'RDL' },
        { id: 'c1', field: 'position', from: 0, to: 1 },
      ] }),
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Duplicate change ids')
    expect(applyCoachPatch).not.toHaveBeenCalled()
  })

  it('requires at least one accepted id and bounds how many', async () => {
    for (const accepted of [[], new Array(9).fill('c1'), 'c1', undefined]) {
      expect((await apply(body({ acceptedChangeIds: accepted }))).status).toBe(400)
    }
    expect(applyCoachPatch).not.toHaveBeenCalled()
  })

  it('refuses a key it does not know, and an oversized body', async () => {
    expect((await apply(body({ userId: 'someone-else' }))).status).toBe(400)
    expect((await apply(body({ pad: 'x'.repeat(300 * 1024) }))).status).toBe(413)
    expect(applyCoachPatch).not.toHaveBeenCalled()
  })

  it('answers 500 without leaking the fault, and invalidates nothing', async () => {
    applyCoachPatch.mockRejectedValue(new Error('boom'))
    const res = await apply(body())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Apply failed' })
    expect(invalidateProgramStructure).not.toHaveBeenCalled()
  })

  it('rate-limits the twenty-first apply in the minute', async () => {
    for (let i = 0; i < 20; i++) expect((await apply(body())).status).toBe(200)
    expect((await apply(body())).status).toBe(429)
  })
})

describe('/api/coach/apply/[id]/undo', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await undo(CHANGE)).status).toBe(401)
  })

  it('refuses an id that is not a uuid before it touches the database', async () => {
    expect((await undo('not-a-uuid')).status).toBe(400)
    expect(undoCoachChange).not.toHaveBeenCalled()
  })

  it('answers 404 for a change that is not the caller\'s', async () => {
    undoRows(undefined, undefined)
    expect((await undo(CHANGE)).status).toBe(404)
    expect(undoCoachChange).not.toHaveBeenCalled()
  })

  it('refuses a second undo rather than re-applying the before-state', async () => {
    undoRows({ appliedAt: APPLIED_AT, undoneAt: new Date() }, undefined)
    const res = await undo(CHANGE)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Already undone')
    expect(undoCoachChange).not.toHaveBeenCalled()
  })

  // The owner's rule, and the only place it is enforced: the window closes when you train, not
  // when a timer runs out. Reversing a change a completed session already used would leave the
  // program disagreeing with a workout that has happened.
  it('closes the window once a workout has started since the change', async () => {
    undoRows({ appliedAt: APPLIED_AT, undoneAt: null }, { id: 'ws-1' })
    const res = await undo(CHANGE)

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain("trained since this change")
    expect(undoCoachChange).not.toHaveBeenCalled()
    expect(invalidateProgramStructure).not.toHaveBeenCalled()
  })

  it('undoes and invalidates when nothing has been trained since', async () => {
    undoRows({ appliedAt: APPLIED_AT, undoneAt: null }, undefined)
    const res = await undo(CHANGE)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ summary: 'Reverted' })
    expect(undoCoachChange).toHaveBeenCalledWith(expect.anything(), sessionUser!.id, CHANGE)
    expect(invalidateProgramStructure).toHaveBeenCalled()
  })

  // Q-468: a later change written over this one. Same 409 as apply, and the message says what to
  // do about it rather than only that it failed.
  it('answers 409 when a later change is the one in effect', async () => {
    undoRows({ appliedAt: APPLIED_AT, undoneAt: null }, undefined)
    undoCoachChange.mockResolvedValue({ ok: false, reason: 'stale', drift: [{ field: 'exerciseName' }] })

    const res = await undo(CHANGE)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('undo the later change first')
    expect(invalidateProgramStructure).not.toHaveBeenCalled()
  })

  it('maps the engine\'s remaining refusals without inventing a reason', async () => {
    undoRows({ appliedAt: APPLIED_AT, undoneAt: null }, undefined)
    undoCoachChange.mockResolvedValue({ ok: false, reason: 'invalid', detail: 'Target left the Coach' })
    expect((await (await undo(CHANGE)).json()).error).toBe('Target left the Coach')

    undoRows({ appliedAt: APPLIED_AT, undoneAt: null }, undefined)
    undoCoachChange.mockResolvedValue({ ok: false, reason: 'gone' })
    const res = await undo(CHANGE)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('This change can no longer be undone')
  })

  it('answers 500 without leaking the fault', async () => {
    undoRows({ appliedAt: APPLIED_AT, undoneAt: null }, undefined)
    undoCoachChange.mockRejectedValue(new Error('boom'))
    const res = await undo(CHANGE)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Undo failed' })
  })
})

describe('/api/coach/threads', () => {
  it('refuses both verbs without a session', async () => {
    sessionUser = null
    expect((await threads()).status).toBe(401)
    expect((await saveThreadReq({ threadId: null, messages: [] })).status).toBe(401)
  })

  // The applied changes ride along because the rows already exist — history is one request, not two.
  it('returns the conversations and the applied changes together, uncacheable', async () => {
    listThreads.mockResolvedValue([{ id: 'th-1' }])
    listAppliedChanges.mockResolvedValue([{ id: 'ch-1' }])

    const res = await threads()
    expect(await res.json()).toEqual({ threads: [{ id: 'th-1' }], changes: [{ id: 'ch-1' }] })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(listThreads).toHaveBeenCalledWith(expect.anything(), sessionUser!.id)
    expect(listAppliedChanges).toHaveBeenCalledWith(expect.anything(), sessionUser!.id)
  })

  it('answers 404 for a thread that is not the caller\'s', async () => {
    loadThread.mockResolvedValue(null)
    expect((await threads(`?threadId=${CHANGE}`)).status).toBe(404)
    expect(loadThread).toHaveBeenCalledWith(expect.anything(), sessionUser!.id, CHANGE)
  })

  it('loads one thread\'s messages when asked for it by id', async () => {
    loadThread.mockResolvedValue([{ role: 'user', parts: [] }])
    const res = await threads(`?threadId=${CHANGE}`)
    expect(await res.json()).toEqual({ messages: [{ role: 'user', parts: [] }] })
    expect(listThreads).not.toHaveBeenCalled()
  })

  // An empty thread is a real save — it is how a conversation that was cleared is persisted.
  it('saves a thread and answers with the id it was stored under', async () => {
    const res = await saveThreadReq({ threadId: null, messages: [{ role: 'user', parts: [{ text: 'hi' }] }] })
    expect(await res.json()).toEqual({ threadId: 'thread-1' })
    expect(saveThread).toHaveBeenCalledWith(expect.anything(), sessionUser!.id, null, [{ role: 'user', parts: [{ text: 'hi' }] }])
  })

  it('bounds the conversation it will store', async () => {
    const msg = { role: 'user', parts: [] }
    for (const bad of [
      { threadId: 'not-a-uuid', messages: [] },
      { threadId: null, messages: new Array(121).fill(msg) },
      { threadId: null, messages: [{ role: '', parts: [] }] },
      { threadId: null, messages: [{ role: 'user', parts: new Array(81).fill({}) }] },
      { threadId: null, messages: [{ role: 'user', parts: [], userId: 'someone-else' }] },
      { threadId: null, messages: [], userId: 'someone-else' },  // the ENVELOPE's own strictness
      { messages: [] },
    ]) {
      expect((await saveThreadReq(bad)).status).toBe(400)
    }
    expect(saveThread).not.toHaveBeenCalled()
  })

  it('answers 500 without leaking the fault, on both verbs', async () => {
    listThreads.mockRejectedValue(new Error('boom'))
    expect((await (await threads()).json())).toEqual({ error: 'Could not load history' })

    saveThread.mockRejectedValue(new Error('boom'))
    expect(await (await saveThreadReq({ threadId: null, messages: [] })).json()).toEqual({ error: 'Could not save' })
  })
})
