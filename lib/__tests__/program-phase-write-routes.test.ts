/**
 * PS-39 — the two writes that reshape a running program: `confirm-early-deload` and
 * `phase-sets/clone`.
 *
 * Batched because both take a client-supplied id and decide, from the user's own data, whether that
 * id is allowed to be acted on — and they answer that question in two different and both-correct
 * ways. What each decides:
 *
 *   · **`confirm-early-deload` refuses an id that is not the ACTIVE program**, with 403 rather than
 *     404: the caller can already tell which of their programs is active, so there is nothing to
 *     conceal, and "you may not deload a program you are not running" is the useful answer. It
 *     checks for an active program FIRST, so a user with none gets 400 — you cannot be told "not
 *     the active one" when there is no active one.
 *   · **`phase-sets/clone` proves ownership by CONSTRUCTION**, not by a check. The source is found
 *     inside `listPhaseSets(userId)`, so someone else's phase set is simply not in the list and the
 *     answer is 404 — no branch to forget, and no id oracle either.
 *   · **The `overrides` map is keyed on the SOURCE position**, which stops being the cloned position
 *     the moment `includeBaseline` shifts everything by one. Reading the shifted position instead
 *     would silently apply each override to the wrong phase.
 *   · **The deload week is the user's today**, and the timezone is threaded to the repository as
 *     well — the write needs it to compute the week, not just the day.
 *
 * Fixture discipline (the PS-39 note): where two quantities could coincide — the supplied and active
 * program ids, the source and cloned positions, the user's zone and the default — the fixture forces
 * them apart, because equal values put nothing under test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const getActiveProgram = vi.fn(async (_u: string) => null as Row | null)
const confirmEarlyDeload = vi.fn(async (..._a: unknown[]) => undefined)
const listPhaseSets = vi.fn(async (_u: string) => [] as Row[])
const createOwnedPhaseSetClone = vi.fn(async (..._a: unknown[]) => ({ id: 'new-1', name: 'Clone' }) as Row)
const reportServerError = vi.fn((..._a: unknown[]) => undefined)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({ getActiveProgram, confirmEarlyDeload, listPhaseSets, createOwnedPhaseSetClone })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { POST as confirmDeload } from '@/app/api/confirm-early-deload/route'
import { POST as clonePhaseSet } from '@/app/api/phase-sets/clone/route'

const ACTIVE = '00000000-0000-4000-8000-0000000000c1'
const OTHER  = '00000000-0000-4000-8000-0000000000c2'   // deliberately NOT the active one
const SET    = '00000000-0000-4000-8000-0000000000c3'

const post = (handler: (r: NextRequest) => Promise<Response>, body: unknown, url: string) =>
  handler(new NextRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
const deload = (body: unknown) => post(confirmDeload, body, 'http://localhost/api/confirm-early-deload')
const clone  = (body: unknown) => post(clonePhaseSet, body, 'http://localhost/api/phase-sets/clone')

const sourceSet = (over: Row = {}) => ({
  id: SET,
  name: 'Hypertrophy block',
  templateBaseName: 'Hypertrophy',
  phases: [
    { position: 1, name: 'Accumulation', durationCycles: 4, phaseType: 'accumulation', primaryStyleId: 's-1' },
    { position: 2, name: 'Intensification', durationCycles: 3, phaseType: 'intensification', primaryStyleId: 's-2' },
  ],
  ...over,
})

beforeEach(() => {
  for (const m of [getActiveProgram, confirmEarlyDeload, listPhaseSets, createOwnedPhaseSetClone, reportServerError]) m.mockClear()
  getActiveProgram.mockResolvedValue({ id: ACTIVE, name: 'Current' })
  listPhaseSets.mockResolvedValue([sourceSet()])
  createOwnedPhaseSetClone.mockResolvedValue({ id: 'new-1', name: 'My block' })
  sessionUser = { id: 'u-1' }
})
afterEach(() => { vi.useRealTimers() })

describe('POST /api/confirm-early-deload', () => {
  it("deloads the active program at the USER's today, and hands the zone to the write", async () => {
    // 20:00 UTC on the 10th is still the 10th in UTC−5 and already the 11th in Brisbane, so the two
    // answers differ and the assertion can tell which was used. A fixture whose timezone IS
    // `DEFAULT_TZ` proves nothing about that. The zone goes through as well as the date because the
    // repository needs it to resolve the deload WEEK, not just the day.
    expect(DEFAULT_TZ).toBe('Australia/Brisbane')
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-10T20:00:00Z'))

    sessionUser = { id: 'u-1', timezone: 'Etc/GMT+5' }
    const res = await deload({})
    expect(res.status).toBe(200)
    expect(confirmEarlyDeload).toHaveBeenCalledWith('u-1', ACTIVE, '2026-03-10', 'Etc/GMT+5')
    expect(await res.json()).toEqual({ ok: true, earlyDeloadWeekStart: '2026-03-10', programId: ACTIVE })

    confirmEarlyDeload.mockClear()
    sessionUser = { id: 'u-1' }
    await deload({})
    expect(confirmEarlyDeload).toHaveBeenCalledWith('u-1', ACTIVE, '2026-03-11', DEFAULT_TZ)
  })

  it('defaults to the active program when the body names none', async () => {
    await deload({})
    expect(confirmEarlyDeload).toHaveBeenCalledWith('u-1', ACTIVE, expect.any(String), expect.any(String))
  })

  it('refuses to deload a program that is not the one running', async () => {
    // The supplied id must DIFFER from the active one, or the guard is satisfied by coincidence and
    // deleting it would change nothing.
    expect(OTHER).not.toBe(ACTIVE)
    const res = await deload({ programId: OTHER })
    expect(res.status).toBe(403)
    expect(confirmEarlyDeload).not.toHaveBeenCalled()
  })

  it('says "no active program" rather than "not the active one" when there is none', async () => {
    // Order matters: you cannot be told an id is not the active program when no program is active.
    // A 403 here would send the user looking for a permissions problem they do not have.
    getActiveProgram.mockResolvedValue(null)
    const res = await deload({ programId: OTHER })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'No active program' })
    expect(confirmEarlyDeload).not.toHaveBeenCalled()
  })

  it('refuses without a session, and refuses a body it cannot read', async () => {
    sessionUser = null
    expect((await deload({})).status).toBe(401)
    expect(getActiveProgram).not.toHaveBeenCalled()

    sessionUser = { id: 'u-1' }
    expect((await deload({ programId: ACTIVE, pad: 'x'.repeat(5 * 1024) })).status).toBe(413)
    expect(confirmEarlyDeload).not.toHaveBeenCalled()
  })
})

describe('POST /api/phase-sets/clone', () => {
  it('clones the phases, trimming the name and keeping the template lineage', async () => {
    const res = await clone({ phaseSetId: SET, programName: '  My block  ' })
    expect(res.status).toBe(200)
    expect(createOwnedPhaseSetClone).toHaveBeenCalledWith('u-1', 'Hypertrophy', 'My block', [
      { position: 1, name: 'Accumulation',    durationCycles: 4, phaseType: 'accumulation',    primaryStyleId: 's-1' },
      { position: 2, name: 'Intensification', durationCycles: 3, phaseType: 'intensification', primaryStyleId: 's-2' },
    ])
    expect(await res.json()).toEqual({ id: 'new-1', name: 'My block' })
  })

  it('falls back to the set’s own name when it has no template lineage', async () => {
    listPhaseSets.mockResolvedValue([sourceSet({ templateBaseName: null })])
    await clone({ phaseSetId: SET, programName: 'x' })
    expect(createOwnedPhaseSetClone.mock.calls[0][1]).toBe('Hypertrophy block')
  })

  it('applies each override to the phase it was keyed on, even once baseline shifts the positions', async () => {
    // **The case the whole route turns on.** `includeBaseline` shifts every cloned position by one,
    // but the override map is keyed on the SOURCE position — so reading the shifted number would
    // apply each override to its neighbour. Without the shift in play, both readings agree and the
    // rule goes untested, which is why this case sets `includeBaseline` and an override together.
    await clone({ phaseSetId: SET, programName: 'x', includeBaseline: true, overrides: { 1: 9 } })
    expect(createOwnedPhaseSetClone.mock.calls[0][3]).toEqual([
      { position: 0, name: 'Baseline',         durationCycles: 1, phaseType: 'baseline',         primaryStyleId: undefined },
      // 9, not 4 — the override for source position 1, now sitting at position 2.
      { position: 1 + 1, name: 'Accumulation', durationCycles: 9, phaseType: 'accumulation',     primaryStyleId: 's-1' },
      { position: 2 + 1, name: 'Intensification', durationCycles: 3, phaseType: 'intensification', primaryStyleId: 's-2' },
    ])
  })

  it('overrides without a baseline leave the positions alone', async () => {
    await clone({ phaseSetId: SET, programName: 'x', overrides: { 2: 7 } })
    const phases = createOwnedPhaseSetClone.mock.calls[0][3] as Row[]
    expect(phases.map(p => [p.position, p.durationCycles])).toEqual([[1, 4], [2, 7]])
  })

  it("404s a phase set that is not the caller's, while they DO own a different one", async () => {
    // Ownership by construction rather than by a check: the source is found inside
    // `listPhaseSets(userId)`, so another user's set is simply absent. There is no branch to
    // forget, and the answer discloses nothing about whether the id exists.
    //
    // **The caller owns something else, and that is the point.** An empty list makes "not found"
    // and "owns nothing" the same fixture, so a route that quietly fell back to the first owned set
    // would still 404 and the test would pass — the mutation pass proved exactly that. With a real
    // set present, a fallback clones the WRONG set instead, which is visible.
    listPhaseSets.mockResolvedValue([sourceSet({ id: OTHER, name: 'Someone else’s shape' })])
    const res = await clone({ phaseSetId: SET, programName: 'x' })
    expect(res.status).toBe(404)
    expect(listPhaseSets).toHaveBeenCalledWith('u-1')
    expect(createOwnedPhaseSetClone).not.toHaveBeenCalled()
    expect(await res.text()).not.toContain(SET)
  })

  it('404s when the caller owns no phase sets at all', async () => {
    listPhaseSets.mockResolvedValue([])
    expect((await clone({ phaseSetId: SET, programName: 'x' })).status).toBe(404)
    expect(createOwnedPhaseSetClone).not.toHaveBeenCalled()
  })

  it('refuses a request missing either required field, one rule at a time', async () => {
    for (const body of [
      { programName: 'x' },                          // no id
      { phaseSetId: SET },                           // no name
      { phaseSetId: SET, programName: '   ' },       // whitespace is not a name
      { phaseSetId: '', programName: 'x' },
    ]) {
      createOwnedPhaseSetClone.mockClear()
      expect((await clone(body)).status, JSON.stringify(body)).toBe(400)
      expect(createOwnedPhaseSetClone).not.toHaveBeenCalled()
    }
  })

  it('reports a failed clone as a 500 and records it, without echoing the cause', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    createOwnedPhaseSetClone.mockRejectedValue(new Error('duplicate key value violates unique constraint "x"'))
    const res = await clone({ phaseSetId: SET, programName: 'x' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to create phase set' })
    // The detail belongs in the log and in `error_events`, which is the table read at session start
    // — a fault nobody records is a fault nobody sees.
    expect(reportServerError).toHaveBeenCalled()
    expect(reportServerError.mock.calls[0][1]).toMatchObject({ userId: 'u-1', url: '/api/phase-sets/clone' })
    log.mockRestore()
  })

  it('refuses without a session, and refuses a body it cannot read', async () => {
    sessionUser = null
    expect((await clone({ phaseSetId: SET, programName: 'x' })).status).toBe(401)
    expect(listPhaseSets).not.toHaveBeenCalled()

    sessionUser = { id: 'u-1' }
    const huge = { phaseSetId: SET, programName: 'x', pad: 'y'.repeat(300 * 1024) }
    expect((await clone(huge)).status).toBe(413)
    expect(createOwnedPhaseSetClone).not.toHaveBeenCalled()
  })
})
