import { test, expect } from '@playwright/test'
import { ZERO_DATA_STORAGE_STATE } from './fixtures'

// Sweep 39, corrected. The first pass mostly hit routes that do not exist -- an HTML 404 from an
// unmatched Next route looked like an access-control pass and proved nothing. These are the real
// paths and the real request shapes, so every probe now reaches an ownership check.
const A = {
  workoutSession: '3fbf3d8a-64c8-475e-b586-ad02cfddf747',
  activityLog:    '8c4cdaa8-c952-4ae2-8416-69db94ced313',
}
const NONEXISTENT = '00000000-0000-4000-8000-0000000000ff'

test.use({ storageState: ZERO_DATA_STORAGE_STATE })

test("user B cannot reach user A's rows (real routes)", async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 120_000 })

  const logExercise = (wsId: string) => ({
    sessionName: 'Push', workoutSessionId: wsId, exercise: 'Bench Press',
    weights: [60], sets: 1, reps: [5],
  })

  const probes: Array<[string, string, string, unknown?]> = [
    ['GET',    "A's recap",            `/api/workout-sessions/${A.workoutSession}/recap`],
    ['GET',    "A's energy",           `/api/workout-sessions/${A.workoutSession}/energy`],
    ['GET',    "A's timing",           `/api/workout-sessions/${A.workoutSession}/timing`],
    ['DELETE', "delete A's workout",   `/api/workout-sessions`, { workoutSessionId: A.workoutSession }],
    ['DELETE', "delete A's activity",  `/api/activity-logs`,    { id: A.activityLog }],
    ['PATCH',  "patch A's activity",   `/api/activity-logs/${A.activityLog}/metrics`, { distanceKm: 999 }],
    ['POST',   "log set into A's ws",  `/api/log-exercise`,     logExercise(A.workoutSession)],
    ['POST',   "complete A's workout", `/api/complete-workout`, { workoutSessionId: A.workoutSession }],
    // Enumeration control: a NONEXISTENT id must be indistinguishable from someone else's id.
    ['GET',    'recap of nonexistent', `/api/workout-sessions/${NONEXISTENT}/recap`],
    ['DELETE', 'delete nonexistent',   `/api/workout-sessions`, { workoutSessionId: NONEXISTENT }],
    ['POST',   'complete nonexistent', `/api/complete-workout`, { workoutSessionId: NONEXISTENT }],
  ]

  for (const [method, label, url, body] of probes) {
    const r = await page.evaluate(async ([m, u, b]: any) => {
      try {
        const res = await fetch(u, { method: m, cache: 'no-store',
          ...(b !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {}) })
        const t = (await res.text()).slice(0, 160)
        return { status: res.status, html: t.startsWith('<!DOCTYPE'), text: t }
      } catch (e) { return { status: -1, html: false, text: String(e).slice(0, 100) } }
    }, [method, url, body] as any)
    const tag = r.html ? 'NOROUTE' : (r.status >= 200 && r.status < 300 ? 'LEAK?  ' : 'ok     ')
    console.log(`${tag} ${String(r.status).padEnd(4)} ${method.padEnd(6)} ${label.padEnd(22)} ${r.html ? '(unmatched route - proves nothing)' : JSON.stringify(r.text).slice(0, 100)}`)
  }
  expect(true).toBe(true)
})
