/**
 * Q-331 — one session, one number, on both surfaces that report it.
 *
 * `GET /api/workout-sessions/[id]/energy` is what the done screen shows the moment a workout ends;
 * `computeActiveEnergy`'s `workoutKcalBySession` is what the day screen, Nutrition's earned calories
 * and the Home budget read for that same session. Q-419 made them agree and Q-330 kept them agreeing
 * through a weight change — **but only a measurement against the running app said so, and it stopped
 * being true.** Q-421 gave the day path a heart-rate estimate and left the route on MET, so any
 * session carrying an `avg_bpm` — 42 of the owner's 78 — was reported by two different formulas.
 *
 * The two regimes are tested separately because they fail differently:
 *
 * - **Heart rate.** Keytel is pure arithmetic with published coefficients, so this regime needs no
 *   MET table and cannot go vacuous. It is the one that was actually broken.
 * - **MET fallback.** Both surfaces estimate strength as activity 8, and the committed fixture lists
 *   it at `met_moderate: 0.6` — below `estWorkoutKcal`'s `met - 1.5` floor, so in CI both sides are
 *   0 and an equality assertion between two zeroes would pass whatever the inputs are (the Q-391
 *   vacuity trap). Rather than change production code to accept an injected table, this file mocks
 *   `getEnergyFeatureSpec` — the one read behind `metForActivity` — which reaches both surfaces
 *   because both reach the MET table through it. The scrubbed fixtures are left alone (Q-312).
 *
 * One thing this file deliberately does NOT assert is parity on a *past* day. The day path takes the
 * latest weight **within the window it is computing**, so re-reading a six-month-old workout uses the
 * weight the user was then, while this route always uses today's (Q-330). They agree for the case
 * where both are on screen at once — a session that just finished, whose day window ends today — and
 * differing on history is the more defensible reading, not a drift to close.
 */
import { describe, it, expect, vi } from 'vitest'

// A strength MET well clear of the 1.5 floor, so the MET regime below compares real numbers. The
// values are Ainsworth-shaped for resistance training; what matters is only that they clear the floor
// and differ per tier, which the preconditions assert rather than assume.
vi.mock('@/lib/oura-models/constants', () => ({
  getEnergyFeatureSpec: () => ({
    activity_type_dict: {
      '8': { name: 'strength', met_easy: 3.5, met_moderate: 5.0, met_hard: 6.0 },
    },
  }),
}))

const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const DOB = '1993-06-15'
const WEIGHT_KG = 71.5
const AVG_BPM = 91 // the owner's measured median; 73–104 is the real range

let avgBpm: number | null = null
let weightKg: number | null = WEIGHT_KG
let startedAt = new Date('2026-08-20T01:00:00Z')
let completedAt = new Date('2026-08-20T01:58:00Z')
let sessionRpe: number | null = 9

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'q331-user', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/data', () => ({
  getRepository: vi.fn(async () => ({
    getWorkoutSessionDetail: vi.fn(async () => ({ startedAt, completedAt, sessionRpe, exercises: [] })),
    getUserById: vi.fn(async () => ({ dateOfBirth: DOB, sex: 'male' })),
    getMostRecentConfirmedWeightKg: vi.fn(async () => weightKg),
    getAvgBpmBySession: vi.fn(async () => (avgBpm == null ? new Map() : new Map([[SESSION_ID, avgBpm]]))),
  })),
}))

import { GET } from '@/app/api/workout-sessions/[id]/energy/route'
import { computeActiveEnergy } from '@trainingai/shared/health/daily-energy'
import { metForActivity } from '@trainingai/shared/health/workout-energy'
import { ageFromDob } from '@trainingai/shared/date-utils'

/** The done screen's number. */
async function fromRoute(): Promise<{ kcal: number | null; source: string; intensity: string }> {
  const res = await GET(new Request(`http://x/api/workout-sessions/${SESSION_ID}/energy`), {
    params: Promise.resolve({ id: SESSION_ID }),
  })
  return res.json()
}

/**
 * The day screen's number for the same session, rounded the way the route rounds. `computeActiveEnergy`
 * returns the addends unrounded on purpose (Q-391), so the rounding has to happen here to compare
 * like with like.
 */
function fromDay(): number | null {
  const ageYears = ageFromDob(DOB, new Date())
  const durationMin = (completedAt.getTime() - startedAt.getTime()) / 60_000
  const r = computeActiveEnergy({
    profile: { ageYears, weightKg, sex: 'male' },
    strengthSessions: [{ id: SESSION_ID, durationMin, rpe: sessionRpe, avgBpm }],
    activities: [],
    pedometerSteps: null,
  })
  const row = r.workoutKcalBySession.find(s => s.id === SESSION_ID)
  return row ? Math.round(row.kcal) : null
}

function reset() {
  avgBpm = null
  weightKg = WEIGHT_KG
  startedAt = new Date('2026-08-20T01:00:00Z')
  completedAt = new Date('2026-08-20T01:58:00Z')
  sessionRpe = 9
}

describe('session energy — the done screen and the day agree (Q-331)', () => {
  it('the mocked MET clears the formula floor, so the MET regime below is not comparing zeroes', () => {
    expect(metForActivity(8, 'moderate')!).toBeGreaterThan(1.5)
    expect(metForActivity(8, 'easy')!).toBeGreaterThan(1.5)
    expect(metForActivity(8, 'hard')).not.toBe(metForActivity(8, 'easy'))
  })

  it('agrees when the session has a heart rate — the regime that was broken', async () => {
    reset()
    avgBpm = AVG_BPM
    const route = await fromRoute()
    expect(route.source).toBe('hr')
    expect(route.kcal).toBeGreaterThan(0)
    expect(route.kcal).toBe(fromDay())
  })

  it('agrees when it does not, on the MET fallback', async () => {
    reset()
    const route = await fromRoute()
    expect(route.source).toBe('met')
    expect(route.kcal).toBeGreaterThan(0)
    expect(route.kcal).toBe(fromDay())
  })

  it('is the heart rate that decides, on both surfaces at once', async () => {
    reset()
    const metOnly = await fromRoute()
    const metDay = fromDay()
    avgBpm = AVG_BPM
    const withHr = await fromRoute()
    const hrDay = fromDay()

    // The defect this file exists for: the route stayed on MET while the day moved to HR, so the
    // two disagreed for every session with a strap reading.
    expect(withHr.kcal).not.toBe(metOnly.kcal)
    expect(hrDay).not.toBe(metDay)
    expect(withHr.kcal).toBe(hrDay)
  })

  it('moves together when the weight changes', async () => {
    reset()
    avgBpm = AVG_BPM
    const before = await fromRoute()
    weightKg = WEIGHT_KG + 15
    const after = await fromRoute()
    expect(after.kcal).not.toBe(before.kcal)
    expect(after.kcal).toBe(fromDay())
  })

  it('moves together when the duration changes', async () => {
    reset()
    avgBpm = AVG_BPM
    const before = await fromRoute()
    completedAt = new Date(startedAt.getTime() + 90 * 60_000)
    const after = await fromRoute()
    expect(after.kcal).toBeGreaterThan(before.kcal!)
    expect(after.kcal).toBe(fromDay())
  })

  it('moves together when the RPE changes, and reports the same effort tier', async () => {
    reset()
    const hard = await fromRoute()
    sessionRpe = 3
    const easy = await fromRoute()
    expect(hard.intensity).toBe('hard')
    expect(easy.intensity).toBe('easy')
    expect(easy.kcal).not.toBe(hard.kcal)
    expect(easy.kcal).toBe(fromDay())
  })
})
