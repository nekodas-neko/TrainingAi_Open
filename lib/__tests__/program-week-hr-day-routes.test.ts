/**
 * PS-39 — two small read routes with one real decision each.
 *
 *   · `program-week` picks between THREE answer shapes (`cycle`, `tenure`, and null) and the client
 *     renders whichever arrives. Nothing else in the repo states which inputs select which.
 *   · `oura/hr-day` builds its window from the user's timezone. That is the Q-144 class: the query
 *     bounds are the whole answer, and a wrong zone shifts a night's readings by hours.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { NextRequest } from 'next/server'

const getActiveProgram = vi.fn(async (_userId: string) => null as unknown)
const listProgramPhases = vi.fn(async (_userId: string, _programId: string) => [] as unknown[])
const countSessionsSinceStart = vi.fn(async (_userId: string, _programId: string) => 0)
const getFirstWorkoutDateForProgram = vi.fn(async (_userId: string, _ids: string[]) => null as Date | null)
const getHrForWindow = vi.fn(async (_userId: string, _from: Date, _to: Date) =>
  [] as Array<{ timestamp: Date; bpm: number; source: string }>)
const listSleepSessions = vi.fn(async (_userId: string, _from: string, _to: string) => [] as unknown[])

const TZ = 'Australia/Brisbane'
let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: TZ }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
const repo = () => ({
  getActiveProgram, listProgramPhases, countSessionsSinceStart, getFirstWorkoutDateForProgram,
  getHrForWindow, listSleepSessions,
})
vi.mock('@/lib/data', () => ({ getRepository: async () => repo(), getRepositoryAsync: async () => repo() }))

import { GET as programWeek } from '@/app/api/program-week/route'
import { GET as hrDay } from '@/app/api/oura/hr-day/route'

beforeEach(() => {
  // Clear CALLS, not just return values: `not.toHaveBeenCalled()` reads history, and without this
  // it sees the previous case's call and fails for a reason that has nothing to do with the route.
  for (const m of [getActiveProgram, listProgramPhases, countSessionsSinceStart,
                   getFirstWorkoutDateForProgram, getHrForWindow, listSleepSessions]) m.mockClear()
  sessionUser = { id: 'u-1', timezone: TZ }
  getActiveProgram.mockResolvedValue(null)
  listProgramPhases.mockResolvedValue([])
  countSessionsSinceStart.mockResolvedValue(0)
  getFirstWorkoutDateForProgram.mockResolvedValue(null)
  getHrForWindow.mockResolvedValue([])
  listSleepSessions.mockResolvedValue([])
})

describe('GET /api/program-week', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await programWeek()).status).toBe(401)
  })

  it('answers mode null with no active program, rather than inventing a week', async () => {
    const json = await (await programWeek()).json()
    expect(json).toEqual({ mode: null, programName: null })
  })

  it('reports cycle mode from the phase engine when the program is automatic', async () => {
    getActiveProgram.mockResolvedValue({ id: 'p1', name: 'Bankai', phaseMode: 'automatic', sessionsPerCycle: 3, sessions: [] })
    listProgramPhases.mockResolvedValue([
      { name: 'Accumulation', durationCycles: 2, phaseType: 'normal' },
      { name: 'Deload', durationCycles: 1, phaseType: 'deload' },
    ])
    countSessionsSinceStart.mockResolvedValue(7)   // 7/3 = 2 complete cycles → into the deload phase

    const json = await (await programWeek()).json()
    expect(json.mode).toBe('cycle')
    expect(json.phaseName).toBe('Deload')
    expect(json.cycleTotal).toBe(3)
    expect(json.programName).toBe('Bankai')
  })

  it('never reports a cycle past the program total', async () => {
    // `cycleCurrent` is clamped, so training on past the last cycle reads "3 of 3" rather than
    // "5 of 3" — the shape a progress bar cannot render.
    getActiveProgram.mockResolvedValue({ id: 'p1', name: 'P', phaseMode: 'automatic', sessionsPerCycle: 1, sessions: [] })
    listProgramPhases.mockResolvedValue([{ name: 'A', durationCycles: 3, phaseType: 'normal' }])
    countSessionsSinceStart.mockResolvedValue(99)

    const json = await (await programWeek()).json()
    expect(json.cycleCurrent).toBe(3)
    expect(json.cycleTotal).toBe(3)
  })

  it('falls back to tenure mode when the program has no phases', async () => {
    getActiveProgram.mockResolvedValue({ id: 'p1', name: 'P', phaseMode: 'automatic', sessionsPerCycle: 3, sessions: [{ id: 's1' }] })
    listProgramPhases.mockResolvedValue([])
    getFirstWorkoutDateForProgram.mockResolvedValue(new Date(Date.now() - 21 * 86_400_000))

    const json = await (await programWeek()).json()
    expect(json.mode).toBe('tenure')
    expect(json.weeksRunning).toBe(3)
  })

  it('answers mode null when the program has never been trained', async () => {
    getActiveProgram.mockResolvedValue({ id: 'p1', name: 'P', phaseMode: 'manual', sessions: [] })
    getFirstWorkoutDateForProgram.mockResolvedValue(null)

    const json = await (await programWeek()).json()
    expect(json).toEqual({ mode: null, programName: 'P' })
  })

  it('is never served from the browser cache', async () => {
    expect((await programWeek()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('GET /api/oura/hr-day', () => {
  // `NextRequest`, not `Request`: the route reads `req.nextUrl.searchParams`, which a plain
  // Request does not have — it throws before any assertion can be reached.
  const get = (qs = '') => hrDay(new NextRequest(`http://localhost/api/oura/hr-day${qs}`))

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await get('?date=2026-09-01')).status).toBe(401)
  })

  it('builds the day window in the USER\'s timezone, not the default', async () => {
    // The window bounds are the entire answer here: an hour's error moves readings between nights.
    //
    // **The session's zone is deliberately NOT Brisbane.** With the owner's own timezone the whole
    // assertion passes against a route that hardcodes `DEFAULT_TZ` — which is what the first draft
    // did, and the mutation check caught. A timezone test written in the default zone tests nothing.
    sessionUser = { id: 'u-1', timezone: 'America/New_York' }
    await get('?date=2026-09-01')

    const [, from, to] = getHrForWindow.mock.calls[0]
    expect(from).toEqual(fromZonedTime(new Date(2026, 8, 1, 0, 0, 0), 'America/New_York'))
    expect(to).toEqual(fromZonedTime(new Date(2026, 8, 1, 23, 59, 59), 'America/New_York'))
    // And it is genuinely a different instant from the default zone's — otherwise the case above
    // would still be vacuous.
    expect(from).not.toEqual(fromZonedTime(new Date(2026, 8, 1, 0, 0, 0), TZ))
  })

  it('accepts the slash form the client actually sends', async () => {
    // `localDateString()` emits `YYYY/MM/DD`, and a dash-only guard would reject every real request
    // before the handler ran — the shape that broke ai-chat for a release.
    const res = await get('?date=2026/09/01')
    expect(res.status).toBe(200)
    expect((await res.json()).date).toBe('2026-09-01')
  })

  it('rejects a malformed date instead of throwing on the arithmetic', async () => {
    // A raw param reaching `split('-')`/`fromZonedTime` is a 500 (`RangeError: Invalid time value`).
    const res = await get('?date=not-a-date')
    expect(res.status).toBe(400)
    expect(getHrForWindow).not.toHaveBeenCalled()
  })

  it('reads the night dated the same day, because sleep_sessions.date is the WAKE date', async () => {
    await get('?date=2026-09-01')
    expect(listSleepSessions).toHaveBeenCalledWith('u-1', '2026-09-01', '2026-09-01')
  })

  it('returns a null sleep band rather than omitting the field when there is no night', async () => {
    const json = await (await get('?date=2026-09-01')).json()
    expect(json.sleep).toBeNull()
    expect(json.readings).toEqual([])
  })

  it('is never served from the browser cache', async () => {
    expect((await get('?date=2026-09-01')).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
