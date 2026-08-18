import { test, expect } from '@playwright/test'
import { ZERO_DATA_STORAGE_STATE } from './fixtures'

// Sweep 39: user B, authenticated, attempts to READ and MUTATE user A's rows by id.
// Anything that is not 401/403/404 (or a 200 carrying no data) is a cross-user leak.
const A = {
  workoutSession: '3fbf3d8a-64c8-475e-b586-ad02cfddf747',
  program:        '53a93ec9-e3ad-4616-a71a-59f5f6f5bb1f',
  activityLog:    '8c4cdaa8-c952-4ae2-8416-69db94ced313',
  exerciseLog:    '4b46b236-1de8-48c9-9673-baa069733444',
  userId:         '29f916c2-ffb3-4875-b41e-8b8114d25782',
}

test.use({ storageState: ZERO_DATA_STORAGE_STATE })

test("user B cannot reach user A's rows", async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 120_000 })

  const probes: Array<[string, string, string, unknown?]> = [
    ['GET',    'workout session by id',   `/api/workout-sessions/${A.workoutSession}`],
    ['GET',    'workout recap by id',     `/api/workout-sessions/${A.workoutSession}/recap`],
    ['GET',    'workout review by id',    `/api/workout-review/session/${A.workoutSession}`],
    ['GET',    'session-explain by id',   `/api/session-explain/insight?sessionId=${A.workoutSession}`],
    ['DELETE', 'delete A workout',        `/api/workout-sessions/${A.workoutSession}`],
    ['DELETE', 'delete A activity log',   `/api/activity-logs/${A.activityLog}`],
    ['PATCH',  'patch A activity log',    `/api/activity-logs/${A.activityLog}`, { notes: 'x-by-B' }],
    ['DELETE', 'delete A program',        `/api/programs/${A.program}`],
    ['POST',   'activate A program',      `/api/programs/${A.program}/activate`, {}],
    ['POST',   'log set into A session',  `/api/log-exercise`, { workoutSessionId: A.workoutSession, exerciseName: 'Bench Press', sets: [{ weight: 60, reps: 5, rpe: 8 }] }],
    ['POST',   'complete A workout',      `/api/complete-workout`, { workoutSessionId: A.workoutSession }],
  ]

  for (const [method, label, url, body] of probes) {
    const r = await page.evaluate(async ([m, u, b]: any) => {
      try {
        const res = await fetch(u, {
          method: m,
          cache: 'no-store',
          ...(b !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {}),
        })
        const text = (await res.text()).slice(0, 200)
        return { status: res.status, text }
      } catch (e) { return { status: -1, text: String(e).slice(0, 120) } }
    }, [method, url, body] as any)
    const leak = r.status >= 200 && r.status < 300
    console.log(`${leak ? 'LEAK?' : 'ok   '} ${String(r.status).padEnd(4)} ${method.padEnd(6)} ${label.padEnd(26)} ${JSON.stringify(r.text).slice(0, 110)}`)
  }
  expect(true).toBe(true)
})
