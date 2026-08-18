import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'
import { todayInTz } from '@trainingai/shared/date-utils'

/**
 * Q-390 — a flagged day's bar sat ~12 px above an identical unflagged one.
 *
 * The flags ("D" for deload, "T" for testing) were rendered as *siblings* of the day label inside a
 * column flex, so each one became an extra row and made that column taller. The row is `items-end`,
 * so a taller column pushes its bar UP — off the baseline every other bar sits on. On a chart whose
 * only purpose is comparing days against each other, two identical volumes drew at visibly
 * different heights.
 *
 * **This asserts geometry, not markup**, because the geometry is the defect: two days with the SAME
 * volume, one flagged, must have their bar top edges at the same y. Asserting "the label contains
 * (D)" would pass with the bug reintroduced in any other shape.
 *
 * **CI-vs-local hazard this spec already hit once:** it originally seeded fixed weekdays (Mon/Tue).
 * `seed.sql` fills relative to when it runs, so on CI's fresh database an ordinary seeded session
 * can share the probe's day — and `isDeload` is `every(isDeloadSession)`, so one such session
 * silently removes the "(D)" the assertions hang off. It now picks days the seed has not filled.
 *
 * **Mutation-checked, twice.** Restoring the flags as sibling `<span>`s fails it — but only on the
 * label assertion, which is the weaker half. So it was re-checked with a *geometry-only* mutation:
 * label left inline (so the "(D)" assertion still passes) and one empty sibling span added back to
 * the flagged column. The bars then sat **exactly 12 px** apart — the figure Q-390 predicted from
 * the box model — and this failed on the baseline assertion, which is the half that matters.
 */
test.setTimeout(180_000)

const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/trainingai_dev'
const MARKER = 'E2E Flag Probe'

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: DB })
  await c.connect()
  try { return await fn(c) } finally { await c.end() }
}

/**
 * The seven Brisbane date strings of the week containing today, Monday first.
 *
 * Built from date STRINGS rather than shifted `Date`s: `toISOString().slice(0, 10)` is the banned
 * UTC-date pattern, and CI's lint rightly rejected the first version of this even though it shifted
 * by +10 h before slicing. `todayInTz()` is the app's own answer to "what day is it for this user",
 * so the probe and the screen agree by construction rather than by coincidence.
 */
function weekDateStrings(): string[] {
  const today = todayInTz()
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7   // 0 = Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - dow + i)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  })
}

/** Midday Brisbane on a given Brisbane date, as the UTC instant to store. */
const noonBrisbane = (dateStr: string) => `${dateStr}T02:00:00Z`

test.beforeAll(async () => {
  await withDb(async c => {
    const { rows } = await c.query('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    if (!userId) throw new Error(`seed user ${SEED_EMAIL} missing — run pnpm db:local`)

    await c.query(
      `DELETE FROM workout_sessions WHERE id IN (
         SELECT workout_session_id FROM exercise_logs WHERE exercise_name = $1)`, [MARKER])

    const week = weekDateStrings()

    // Use days the seed has NOT already filled. `isDeload` is `every(isDeloadSession)`, so one
    // ordinary seeded session sharing the probe's day silently removes the "(D)" this asserts on —
    // and `seed.sql` fills relative to when it runs, so which weekdays are occupied differs between
    // a long-lived local database and CI's fresh one. Choosing free days makes the spec independent
    // of that instead of destroying seeded rows to make room.
    const busy = await c.query(
      `SELECT DISTINCT to_char(completed_at AT TIME ZONE 'Australia/Brisbane', 'YYYY-MM-DD') AS d
         FROM workout_sessions
        WHERE user_id = $1
          AND (completed_at AT TIME ZONE 'Australia/Brisbane')::date BETWEEN $2::date AND $3::date`,
      [userId, week[0], week[6]],
    )
    const taken = new Set<string>(busy.rows.map((r: { d: string }) => r.d))
    const free = week.filter(d => !taken.has(d))
    if (free.length < 2) {
      throw new Error(`need two session-free days this week, found ${free.length} (taken: ${[...taken].join(', ')})`)
    }

    // Two days of the SAME volume: one a deload (flagged "D"), one an ordinary session (no flag).
    // That pairing is the whole experiment — same height in, so any difference out is the layout bug.
    for (const [day, phase] of [[free[0], 'deload'], [free[1], null]] as const) {
      const at = noonBrisbane(day)
      const ws = await c.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at, phase_type)
         VALUES ($1, $2, $3, $3, $4) RETURNING id`,
        [userId, MARKER, at, phase],
      )
      await c.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
         VALUES ($1, $2, 5000, $3)`,
        [ws.rows[0].id, MARKER, at],
      )
    }
  })
})

test.afterAll(async () => {
  await withDb(async c => {
    await c.query(
      `DELETE FROM workout_sessions WHERE id IN (
         SELECT workout_session_id FROM exercise_logs WHERE exercise_name = $1)`, [MARKER])
  })
})

test('a flagged day and an identical unflagged day draw their bars on one baseline', async ({ page }) => {
  await page.goto('/health')
  await settleRouteBoundary(page)

  // Anchored on the "Training Load" heading and its sibling row, not on a text pattern: a first
  // attempt matched three-letter spans elsewhere on the page and compared two unrelated elements
  // 231 px apart, which looked exactly like the bug it was meant to detect.
  const probe = () => page.evaluate(() => {
    const heading = [...document.querySelectorAll('p')]
      .find(p => p.textContent?.trim() === 'Training Load')
    const row = heading?.nextElementSibling
    if (!row) return []
    return [...row.children].map(col => {
      const bar = col.firstElementChild as HTMLElement
      const r = bar.getBoundingClientRect()
      return {
        // The column's whole text, NOT lastElementChild: the label is only the last child while
        // the layout is correct, so reading that child would make this probe blind to exactly the
        // regression it exists to catch (proven — the first mutation run reported an empty label
        // instead of a moved bar).
        label: (col.textContent ?? '').trim(),
        barTop: Math.round(r.top),
        barHeight: Math.round(r.height),
      }
    })
  })

  await expect.poll(probe, {
    message: 'the Training Load row should render seven day columns',
    timeout: 60_000,
  }).toHaveLength(7)

  const columns = await probe()
  const labels = columns.map(c => `${c.label}:${c.barHeight}px`).join(', ')

  // The flag is inline in the label now, so the deload day reads "Mon (D)" — the owner's requested
  // form, and the same change that removes the extra row.
  const flagged = columns.find(c => /\(D\)$/.test(c.label))
  expect(flagged, `expected a day labelled "… (D)". Columns: ${labels}`).toBeTruthy()

  // Its twin: the unflagged day seeded with the SAME volume, so the same bar height. Five of the
  // seven days are empty 6 px slivers, so the twin has to be picked by height, not by position.
  const unflagged = columns
    .filter(c => c !== flagged && !/\([DT·]+\)$/.test(c.label))
    .find(c => Math.abs(c.barHeight - flagged!.barHeight) <= 1)
  expect(unflagged, `expected an unflagged day of equal height. Columns: ${labels}`).toBeTruthy()

  const barTops = [flagged!.barTop, unflagged!.barTop]

  expect(barTops).toHaveLength(2)
  // Same volume in, so same top out. Before the fix these differed by ~12 px.
  expect(
    Math.abs(barTops[0] - barTops[1]),
    `flagged and unflagged bars must share a baseline (tops: ${barTops.join(' vs ')})`,
  ).toBeLessThanOrEqual(1)
})
