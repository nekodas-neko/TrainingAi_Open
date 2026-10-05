/**
 * #2155 — Home warms today's prescription before the workout tab asks for it.
 *
 * What has to hold: it generates only when opening the workout would (the consumed slot, or a plan
 * that has aged out), never on a day already trained, always at the plain standard key the tab's
 * own triggers use, and at most once however the calls race. `generatePrescriptionForSession` is
 * mocked — it is the whole engine and has its own tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa'

const program = (over: Row = {}) => ({
  id: 'p-1', phaseMode: 'ai_dynamic',
  sessions: [{ id: SESSION_ID, programId: 'p-1', name: 'Pull', position: 0, timeBudgetMinutes: 60, exercises: [] }],
  ...over,
})
const state = (over: Row = {}) => ({
  phase: 'accumulation', baselineComplete: true,
  prescription: { exercises: [] }, prescriptionStatus: 'consumed',
  prescriptionExpiresAt: new Date(Date.now() + 3 * 86_400_000),
  ...over,
})

const getActiveProgram = vi.fn(async (_u: string) => program() as Row | null)
const getSessionPeriodization = vi.fn(async (_u: string, _s: string) => state() as Row | null)
const getDaySessionSummaries = vi.fn(async (_u: string, _d: string, _tz?: string) => [] as Row[])
let release: () => void = () => {}
const generatePrescriptionForSession = vi.fn((..._a: unknown[]) =>
  new Promise<Row>(resolve => { release = () => resolve({ ok: true }) }))

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-warm', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({ getActiveProgram, getSessionPeriodization, getDaySessionSummaries })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/ai-periodization/generate-prescription', () => ({
  generatePrescriptionForSession: (...a: unknown[]) => generatePrescriptionForSession(...a),
}))

const { POST: warm } = await import('@/app/api/ai-periodization/session/[sessionId]/warm/route')
const { __clearPrescriptionInFlight } = await import('@trainingai/shared/ai-periodization/regenerate-in-background')

const call = (id = SESSION_ID) =>
  warm(new Request(`http://localhost/api/ai-periodization/session/${id}/warm`, { method: 'POST' }), {
    params: Promise.resolve({ sessionId: id }),
  })
const statusOf = async (res: Response) => ((await res.json()) as { status?: string }).status

/** Runs a warm that is expected to generate, letting the mocked generation finish. */
const warmed = async () => {
  const pending = call()
  await vi.waitFor(() => expect(generatePrescriptionForSession).toHaveBeenCalled())
  release()
  return pending
}

beforeEach(() => {
  for (const m of [getActiveProgram, getSessionPeriodization, getDaySessionSummaries, generatePrescriptionForSession]) m.mockClear()
  getActiveProgram.mockImplementation(async () => program())
  getSessionPeriodization.mockImplementation(async () => state())
  getDaySessionSummaries.mockImplementation(async () => [])
  sessionUser = { id: `u-warm-${Math.random()}`, timezone: 'Australia/Brisbane' }
  __clearPrescriptionInFlight()
})

describe('POST /api/ai-periodization/session/[id]/warm', () => {
  it('generates when the last workout consumed the slot, at the plain standard key', async () => {
    const res = await warmed()
    expect(await statusOf(res)).toBe('generated')
    expect(generatePrescriptionForSession).toHaveBeenCalledTimes(1)
    // (userId, sessionId, repo, tz) and nothing else: no preset and no exclusion, so it shares the
    // workout tab's dedup key and a tap during the warm joins it.
    const args = generatePrescriptionForSession.mock.calls[0]
    expect(args).toHaveLength(4)
    expect(args[1]).toBe(SESSION_ID)
    expect(args[3]).toBe('Australia/Brisbane')
  })

  it('generates when the stored plan has aged out, as opening the workout would', async () => {
    getSessionPeriodization.mockImplementation(async () =>
      state({ prescriptionStatus: 'accepted', prescriptionExpiresAt: new Date(Date.now() - 60_000) }))
    expect(await statusOf(await warmed())).toBe('generated')
  })

  it('does nothing when a current plan is already stored', async () => {
    getSessionPeriodization.mockImplementation(async () => state({ prescriptionStatus: 'pending' }))
    expect(await statusOf(await call())).toBe('not_needed')
    getSessionPeriodization.mockImplementation(async () => state({ prescriptionStatus: 'auto_applied' }))
    expect(await statusOf(await call())).toBe('not_needed')
    expect(generatePrescriptionForSession).not.toHaveBeenCalled()
  })

  it('does nothing for a static program, or during an unfinished baseline', async () => {
    getActiveProgram.mockImplementation(async () => program({ phaseMode: 'static' }))
    expect(await statusOf(await call())).toBe('not_needed')
    getActiveProgram.mockImplementation(async () => program())
    getSessionPeriodization.mockImplementation(async () => state({ phase: 'baseline', baselineComplete: false }))
    expect(await statusOf(await call())).toBe('not_needed')
    expect(generatePrescriptionForSession).not.toHaveBeenCalled()
  })

  it('does nothing once today’s workout is done — the next plan waits for its own day', async () => {
    getDaySessionSummaries.mockImplementation(async () => [{ sessionName: 'Push', startedAt: new Date(), completedAt: new Date() }])
    expect(await statusOf(await call())).toBe('trained_today')
    expect(generatePrescriptionForSession).not.toHaveBeenCalled()
    // The reader splits its date on '/'; a dashed date would match no day and never skip.
    expect(getDaySessionSummaries.mock.calls[0][1]).toMatch(/^\d{4}\/\d{2}\/\d{2}$/)
  })

  it('still warms on a day with only an abandoned start', async () => {
    getDaySessionSummaries.mockImplementation(async () => [{ sessionName: 'Push', startedAt: new Date() }])
    expect(await statusOf(await warmed())).toBe('generated')
  })

  it('runs one generation however the calls race', async () => {
    const first = call()
    await vi.waitFor(() => expect(generatePrescriptionForSession).toHaveBeenCalled())
    expect(await statusOf(await call())).toBe('skipped')
    release()
    expect(await statusOf(await first)).toBe('generated')
    expect(generatePrescriptionForSession).toHaveBeenCalledTimes(1)
  })

  it('refuses a caller without a session, a malformed id, and a session not in the active program', async () => {
    sessionUser = null
    expect((await call()).status).toBe(401)
    sessionUser = { id: 'u-warm-guards', timezone: 'Australia/Brisbane' }
    expect((await call('not-a-uuid')).status).toBe(400)
    expect((await call('00000000-0000-4000-8000-0000000000bb')).status).toBe(404)
    expect(generatePrescriptionForSession).not.toHaveBeenCalled()
  })
})
