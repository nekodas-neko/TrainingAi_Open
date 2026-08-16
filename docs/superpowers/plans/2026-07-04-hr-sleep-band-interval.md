# HR "Today" Sleep Band from the Sleep-Session Interval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Restore the overnight "Sleep" band on the Home / Health "Heart Rate · Today" chart by drawing it from the primary `sleep_sessions` bedtime interval (returned by `/api/oura/hr-day`) instead of inferring it from per-reading `source` tags, keeping a `source`-based fallback for nights with no sleep session.

**Architecture:** `/api/oura/hr-day` gains a `sleep: { startMin, endMin } | null` field — the primary sleep session's `bedtime_start`/`bedtime_end` converted to minutes-of-day in the **user's timezone** and clipped to `[0, 1440]`. `HrDayChart` takes a new `sleepWindow` prop and, when present, draws exactly that single band; when absent it falls back to today's existing `findSourceWindows(readings, …, ['sleep'])` heuristic (PR #185's `['sleep']`-only filter, so no daytime phantom bands regress). Two pure, vitest-testable helpers hold the logic: `pickPrimarySleep` (lifted out of `app/api/day-timeline/route.ts` so it lives in exactly one place) and `bedtimeToMinuteWindow` (the tz-aware minute conversion with the midnight-boundary clip).

**Tech Stack:** Next.js 15 route handler, React 19 client component, chart.js/react-chartjs-2 canvas plugin, Drizzle/Postgres, `date-fns-tz`, vitest (`environment: 'node'` — no JSX), Playwright for the canvas draw.

**Verified against `main` @ `44d2b72` (PR #213 merged, HEAD).** All file:line anchors below re-checked against current `main`.

- Band today: `components/health/hr-day-chart.tsx:128` builds `sleepWindows` from `findSourceWindows(readings, midnightMs, ['sleep'])` (helper `:58-78`, `MIN_DURATION = 20` `:59`), gated by `hasSleep` at `:181` / `:183`. On a night whose synced readings carry no `sleep`-tagged samples, `sleepWindows` is empty → no band, no legend.
- API: `app/api/oura/hr-day/route.ts:22-29` returns only `{ date, readings }`.
- Reuse target: `pickPrimarySleep` + `MIN_MAIN_SLEEP_H = 3` at `app/api/day-timeline/route.ts:45-51`.
- Sleep source of truth: `repo.listSleepSessions(userId, date, date)` (`lib/data/postgres/adapter.ts:1884`), filtered by **wake-up date** (`sleep_sessions.date` = wake-up day, `schema.ts:293`); `sleepStart`/`sleepEnd` are `Date` (`schema.ts:294-295`, type `SleepSession` `lib/types/body.ts:54-67`). The overnight sleep for `date`'s chart is the row that woke up on `date` — so a single `listSleepSessions(date, date)` query is correct (this is exactly what day-timeline's `todaySleep` uses at `route.ts:104`); no prior-day query is needed.
- Callers of `HrDayChart` (3): `app/session-select/session-select-content.tsx:1203` (Home, via `hrData` memo `:357-360`, seed `:248-249`, fetch `:605-607`), `components/home/home-card-widget.tsx:316` (renders `hrData`), `components/health/oura-section.tsx:146` (own state, seed `:76-78`, fetch `:96-99`).

---

### Task 1: Pure helper — `bedtimeToMinuteWindow` (tz-aware minute conversion + midnight clip)

**Files:**
- Create: `lib/health/hr-sleep-band.ts`
- Test: `lib/__tests__/hr-sleep-band.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/hr-sleep-band.test.ts
import { describe, it, expect } from 'vitest'
import { bedtimeToMinuteWindow } from '@/lib/health/hr-sleep-band'

const TZ = 'Australia/Brisbane' // UTC+10, no DST

describe('bedtimeToMinuteWindow', () => {
  it('clips a pre-midnight bedtime start to 0 and returns the morning wake minute', () => {
    // Bedtime 22:30 the evening before, wake 07:00 on the displayed date (Brisbane).
    const start = new Date('2026-07-03T22:30:00+10:00')
    const end   = new Date('2026-07-04T07:00:00+10:00')
    expect(bedtimeToMinuteWindow(start, end, '2026-07-04', TZ)).toEqual({ startMin: 0, endMin: 420 })
  })

  it('boundary: a wake at 00:01 local yields endMin 1', () => {
    const start = new Date('2026-07-03T20:00:00+10:00')
    const end   = new Date('2026-07-04T00:01:00+10:00')
    expect(bedtimeToMinuteWindow(start, end, '2026-07-04', TZ)).toEqual({ startMin: 0, endMin: 1 })
  })

  it('boundary: a 23:59 local onset clips the end to 1440 (shows the evening tail only)', () => {
    const start = new Date('2026-07-04T23:59:00+10:00')
    const end   = new Date('2026-07-05T07:00:00+10:00')
    expect(bedtimeToMinuteWindow(start, end, '2026-07-04', TZ)).toEqual({ startMin: 1439, endMin: 1440 })
  })

  it('returns null when the interval lands entirely before the displayed day', () => {
    const start = new Date('2026-07-02T22:00:00+10:00')
    const end   = new Date('2026-07-03T06:00:00+10:00') // wakes the day before `date`
    expect(bedtimeToMinuteWindow(start, end, '2026-07-04', TZ)).toBeNull()
  })

  it('returns null when start and end collapse to the same clipped minute', () => {
    const start = new Date('2026-07-04T00:00:00+10:00')
    const end   = new Date('2026-07-04T00:00:00+10:00')
    expect(bedtimeToMinuteWindow(start, end, '2026-07-04', TZ)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, verify FAIL** — Run: `pnpm test hr-sleep-band` (fails: module does not exist yet)

- [ ] **Step 3: Implement**

```ts
// lib/health/hr-sleep-band.ts
import { fromZonedTime } from 'date-fns-tz'

/** A sleep band expressed as minutes-of-day offsets on the 0..1440 chart x-axis. */
export interface HrSleepWindow {
  startMin: number
  endMin: number
}

/**
 * Convert a sleep session's bedtime interval into minute-of-day offsets for the
 * "Heart Rate · Today" chart, in the user's timezone, clipped to the displayed
 * day [0, 1440]. The anchor is the *actual UTC instant* of local midnight for
 * `dateStr` in `tz`, so an overnight sleep that started the previous evening
 * clips to 0 and a morning wake maps to its true minute — no `toISOString()`
 * slicing, no `now − N×86400000`.
 *
 * Returns null when the interval, once clipped, has no visible span on `dateStr`
 * (e.g. a sleep that both started and ended before the displayed midnight).
 */
export function bedtimeToMinuteWindow(
  start: Date,
  end: Date,
  dateStr: string,
  tz: string,
): HrSleepWindow | null {
  const midnightMs = fromZonedTime(`${dateStr}T00:00:00`, tz).getTime()
  const rawStart = (start.getTime() - midnightMs) / 60_000
  const rawEnd = (end.getTime() - midnightMs) / 60_000
  const startMin = Math.max(0, Math.min(1440, rawStart))
  const endMin = Math.max(0, Math.min(1440, rawEnd))
  if (endMin <= startMin) return null
  return { startMin, endMin }
}
```

- [ ] **Step 4: Run test, verify PASS** — Run: `pnpm test hr-sleep-band`

- [ ] **Step 5: Commit** — `git add lib/health/hr-sleep-band.ts lib/__tests__/hr-sleep-band.test.ts && git commit -m "Add tz-aware sleep-band minute-window helper for the HR-today chart"`

---

### Task 2: Lift `pickPrimarySleep` into one shared home (one formula, one place)

`pickPrimarySleep` is currently module-private in `app/api/day-timeline/route.ts:46`. The new hr-day route needs the same selection, and route→route imports are not acceptable — extract it to a shared module so both consume the single definition.

**Files:**
- Create: `lib/sleep/primary-sleep.ts`
- Test: `lib/__tests__/primary-sleep.test.ts`
- Modify: `app/api/day-timeline/route.ts:43-51` (delete the local copy, import the shared one)

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/primary-sleep.test.ts
import { describe, it, expect } from 'vitest'
import { pickPrimarySleep, MIN_MAIN_SLEEP_H } from '@/lib/sleep/primary-sleep'
import type { SleepSession } from '@/lib/types/body'

function row(over: Partial<SleepSession>): SleepSession {
  return {
    id: 'x', userId: 'u', date: '2026-07-04',
    sleepStart: new Date('2026-07-03T22:00:00+10:00'),
    sleepEnd: new Date('2026-07-04T06:00:00+10:00'),
    createdAt: new Date(),
    ...over,
  } as SleepSession
}

describe('pickPrimarySleep', () => {
  it('exposes the 3h main-sleep floor', () => {
    expect(MIN_MAIN_SLEEP_H).toBe(3)
  })

  it('returns null for no rows', () => {
    expect(pickPrimarySleep([])).toBeNull()
  })

  it('ignores sub-3h naps when a real night exists', () => {
    const nap = row({ id: 'nap', durationHours: 0.5 })
    const night = row({ id: 'night', durationHours: 8 })
    expect(pickPrimarySleep([nap, night])?.id).toBe('night')
  })

  it('prefers the Oura row (true onset) over a longer non-Oura in-bed row', () => {
    const samsung = row({ id: 's', durationHours: 9, ouraId: null })
    const oura = row({ id: 'o', durationHours: 8, ouraId: 'oura-123' })
    expect(pickPrimarySleep([samsung, oura])?.id).toBe('o')
  })

  it('falls back to the longest row when none clears the 3h floor', () => {
    const a = row({ id: 'a', durationHours: 1 })
    const b = row({ id: 'b', durationHours: 2 })
    expect(pickPrimarySleep([a, b])?.id).toBe('b')
  })
})
```

- [ ] **Step 2: Run it, verify FAIL** — Run: `pnpm test primary-sleep`

- [ ] **Step 3: Implement** — create the shared module (verbatim logic from the current route), then delete the route's copy and import it.

```ts
// lib/sleep/primary-sleep.ts
import type { SleepSession } from '@/lib/types/body'

// Pick the *primary* night sleep from a day's rows: restrict to rows ≥3h so a short nap
// can't be chosen, then prefer the Oura row (actual sleep onset) over Samsung (in-bed time).
export const MIN_MAIN_SLEEP_H = 3

export function pickPrimarySleep(rows: SleepSession[]): SleepSession | null {
  const mainSleeps = rows.filter(r => (r.durationHours ?? 0) >= MIN_MAIN_SLEEP_H)
  const pool = mainSleeps.length > 0 ? mainSleeps : rows
  const longest = [...pool].sort((a, b) => (b.durationHours ?? 0) - (a.durationHours ?? 0))[0] ?? null
  return pool.find(r => r.ouraId) ?? longest
}
```

Then in `app/api/day-timeline/route.ts`:
- Delete the local `MIN_MAIN_SLEEP_H` const and `pickPrimarySleep` function (`:43-51`).
- Add to the imports (near the existing `import type { SleepSession } from '@/lib/types/body'`):

```ts
import { pickPrimarySleep } from '@/lib/sleep/primary-sleep'
```

(The `SleepSession` type import stays; `MIN_MAIN_SLEEP_H` was only used inside the deleted function, so its removal is complete. No call site changes — `pickPrimarySleep` keeps the same signature.)

- [ ] **Step 4: Run test, verify PASS** — Run: `pnpm test primary-sleep && pnpm test day-timeline 2>/dev/null || true` then `pnpm tsc --noEmit` to confirm the route still type-checks after the extraction.

- [ ] **Step 5: Commit** — `git add lib/sleep/primary-sleep.ts lib/__tests__/primary-sleep.test.ts app/api/day-timeline/route.ts && git commit -m "Extract pickPrimarySleep into a shared module (one definition)"`

---

### Task 3: Return the primary sleep interval from `/api/oura/hr-day`

**Files:**
- Modify: `app/api/oura/hr-day/route.ts:19-29`

- [ ] **Step 1: Write the failing test** — no vitest: this handler needs `auth()` + repo wiring and there is no route-level test harness in this repo (siblings have none). Its pure logic is already covered by Task 1 (`bedtimeToMinuteWindow`) and Task 2 (`pickPrimarySleep`). Behaviour is verified end-to-end in Task 6 (Playwright + curl against the seeded local DB). Proceed to Step 3.

- [ ] **Step 2: Run it, verify FAIL** — n/a (see Step 1). Confirm the current shape first: `curl -s "http://localhost:3000/api/oura/hr-day?date=<seed-date>" | jq 'has("sleep")'` returns `false` before the change.

- [ ] **Step 3: Implement** — full new file contents:

```ts
// app/api/oura/hr-day/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { DEFAULT_TZ, todayInTz } from '@/lib/date-utils'
import { fromZonedTime } from 'date-fns-tz'
import { pickPrimarySleep } from '@/lib/sleep/primary-sleep'
import { bedtimeToMinuteWindow } from '@/lib/health/hr-sleep-band'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const dateParam = req.nextUrl.searchParams.get('date') ?? todayInTz(tz)

  // Convert local date midnight → UTC timestamps for the DB query
  const [y, m, d] = dateParam.split('-').map(Number)
  const from = fromZonedTime(new Date(y, m - 1, d, 0, 0, 0), tz)
  const to   = fromZonedTime(new Date(y, m - 1, d, 23, 59, 59), tz)

  const repo = await getRepositoryAsync()
  const [rows, sleepRows] = await Promise.all([
    repo.getHrForWindow(session.user.id, from, to),
    // sleep_sessions.date is the wake-up date, so the overnight sleep for this
    // chart is the row dated `dateParam` — no prior-day query needed.
    repo.listSleepSessions(session.user.id, dateParam, dateParam),
  ])

  const primary = pickPrimarySleep(sleepRows)
  const sleep = primary
    ? bedtimeToMinuteWindow(primary.sleepStart, primary.sleepEnd, dateParam, tz)
    : null

  return NextResponse.json({
    date: dateParam,
    readings: rows.map(r => ({
      timestamp: r.timestamp.toISOString(),
      bpm:       r.bpm,
      source:    r.source,
    })),
    sleep,
  }, { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" } })
}
```

(SWR headers unchanged — the route keeps `max-age=60, stale-while-revalidate=120`, matching its siblings.)

- [ ] **Step 4: Verify** — `pnpm tsc --noEmit`; then against the local dev server: `curl -s "http://localhost:3000/api/oura/hr-day?date=<seed-date-with-sleep>" | jq '.sleep'` returns `{ "startMin": …, "endMin": … }` and `?date=<date-with-hr-but-no-sleep>` returns `"sleep": null`.

- [ ] **Step 5: Commit** — `git add app/api/oura/hr-day/route.ts && git commit -m "Return the primary sleep interval from /api/oura/hr-day"`

---

### Task 4: Draw the band from the interval in `HrDayChart` (source fallback preserved)

**Files:**
- Modify: `components/health/hr-day-chart.tsx:29-36` (Props), `:99` (destructure), `:124-128` (band build)

- [ ] **Step 1: Write the failing test** — none at unit level: the band is drawn by the `windowShading` canvas plugin (`hr-day-chart.tsx:101-117`), which vitest (`environment: 'node'`, no JSX/canvas) cannot exercise. The minute math it consumes is already unit-tested (Task 1). Canvas rendering is verified in Task 6 via Playwright. Proceed to Step 3.

- [ ] **Step 2: Run it, verify FAIL** — n/a (see Step 1).

- [ ] **Step 3: Implement** — three edits.

Add the prop (import the type, extend `Props`):

```ts
// near the top imports of components/health/hr-day-chart.tsx
import type { HrSleepWindow } from '@/lib/health/hr-sleep-band'
```

```ts
interface Props {
  readings: Reading[]
  date: string  // YYYY-MM-DD in user's tz
  workoutSessions?: WorkoutSession[]
  compact?: boolean
  showLegend?: boolean
  lineColor?: string
  sleepWindow?: HrSleepWindow | null  // primary sleep interval (minutes-of-day); overrides the source heuristic
}
```

Destructure it (line `:99`):

```ts
export function HrDayChart({ readings, date, workoutSessions = [], compact = false, showLegend, lineColor, sleepWindow }: Props) {
```

Replace the band build (current `:124-128`) so the interval wins and the `['sleep']` source heuristic remains the fallback (this is what preserves PR #185 — the fallback never re-adds `'rest'`):

```ts
  const smoothed     = toBuckets(readings, midnightMs)
  // Prefer the real sleep-session interval (one contiguous overnight block, present
  // whenever the ring recorded sleep). Fall back to the per-reading `source` heuristic
  // only when no sleep session was returned — kept at ['sleep'] (never 'rest') so PR
  // #185's no-daytime-phantom fix is preserved.
  const sleepWindows: TimeWindow[] = sleepWindow
    ? [{ start: sleepWindow.startMin, end: sleepWindow.endMin }]
    : findSourceWindows(readings, midnightMs, ['sleep'])
  const gymWindows   = workoutWindows(workoutSessions, midnightMs)
```

Everything downstream (`windowDefs` `:131`, `hasSleep` `:181`, legend `:200-205`) is unchanged — it already keys off `sleepWindows`. `findSourceWindows` stays in the file for the fallback path.

- [ ] **Step 4: Verify** — `pnpm tsc --noEmit && pnpm lint` (no runtime assertion here; behaviour verified in Task 6).

- [ ] **Step 5: Commit** — `git add components/health/hr-day-chart.tsx && git commit -m "Drive the HR-today sleep band from the sleep interval, source fallback preserved"`

---

### Task 5: Thread the `sleep` interval through the three chart callers

The response already rides the existing `oura-hr-day:${today}` cache; each caller reads `d.sleep` alongside `d.readings` and passes `sleepWindow` to the chart. Reuse the same cache key/TTL — no new key.

**Files:**
- Modify: `components/health/oura-section.tsx:76-78`, `:95-99`, `:146`
- Modify: `app/session-select/session-select-content.tsx:248-249`, `:357-360`, `:604-607`, `:1203` (via prop), plus a new `ouraSleepWindow` state
- Modify: `components/home/home-card-widget.tsx:63`, `:316`

- [ ] **Step 1: Write the failing test** — n/a (UI wiring; verified in Task 6).

- [ ] **Step 2: Run it, verify FAIL** — n/a.

- [ ] **Step 3: Implement**

**5a — `components/health/oura-section.tsx`.** Add the import, a seeded state, set it in the fetch, and pass the prop:

```ts
import type { HrSleepWindow } from '@/lib/health/hr-sleep-band'
```

Add state next to `hrReadings` (`:76-78`):

```ts
  const [sleepWindow, setSleepWindow] = useState<HrSleepWindow | null>(
    () => readCacheSync<{ sleep: HrSleepWindow | null }>(`oura-hr-day:${today}`)?.sleep ?? null,
  )
```

Widen the fetch generic and set both fields (`:95-99`):

```ts
  useEffect(() => {
    cachedFetch<{ readings: HrReading[]; sleep: HrSleepWindow | null }>(
      `oura-hr-day:${today}`, `/api/oura/hr-day?date=${today}`, TTL_MEDIUM,
      d => {
        if (d?.readings?.length) setHrReadings(d.readings)
        setSleepWindow(d?.sleep ?? null)
      },
    ).catch(() => {})
    cachedFetch<{ sessions: WorkoutSession[] }>(
      `workout-sessions-day:${today}`, `/api/workout-sessions/day?date=${today}`, TTL_MEDIUM,
      d => { if (d?.sessions?.length) setWorkoutSessions(d.sessions) },
    ).catch(() => {})
  }, [today])
```

Pass the prop (`:146`):

```ts
          <HrDayChart readings={hrReadings} date={today} workoutSessions={workoutSessions} sleepWindow={sleepWindow} />
```

**5b — `app/session-select/session-select-content.tsx`.** Import the type, add `ouraSleepWindow` state alongside `ouraHrReadings`, seed it, set it in the fetch, and fold it into the `hrData` memo:

```ts
import type { HrSleepWindow } from '@/lib/health/hr-sleep-band'
```

Add state (next to the existing `ouraHrReadings` / `ouraWorkoutSessions` useState declarations):

```ts
  const [ouraSleepWindow, setOuraSleepWindow] = useState<HrSleepWindow | null>(null);
```

Seed from cache (in the seed block at `:248-249`):

```ts
    const cachedHr = readCacheSync<{ readings: { timestamp: string; bpm: number; source: string | null }[]; sleep: HrSleepWindow | null }>(`oura-hr-day:${hrToday}`);
    if (cachedHr?.readings?.length) setOuraHrReadings(cachedHr.readings);
    if (cachedHr) setOuraSleepWindow(cachedHr.sleep ?? null);
```

Set in the fetch (`:604-607`):

```ts
    cachedFetch<{ readings: { timestamp: string; bpm: number; source: string | null }[]; sleep: HrSleepWindow | null }>(
      `oura-hr-day:${today}`, `/api/oura/hr-day?date=${today}`, TTL_MEDIUM,
      d => { if (d?.readings?.length) setOuraHrReadings(d.readings); setOuraSleepWindow(d?.sleep ?? null); }).catch(() => {});
```

Fold into `hrData` (`:357-360`):

```ts
  const hrData = useMemo(
    () => (ouraHrReadings.length > 0 ? { readings: ouraHrReadings, workoutSessions: ouraWorkoutSessions, sleep: ouraSleepWindow } : null),
    [ouraHrReadings, ouraWorkoutSessions, ouraSleepWindow],
  );
```

(The `hrData={hrData}` prop pass at `:1203` needs no edit — the shape widened.)

**5c — `components/home/home-card-widget.tsx`.** Widen the prop type (`:63`) and pass the interval (`:316`):

```ts
import type { HrSleepWindow } from '@/lib/health/hr-sleep-band'
```

```ts
  hrData: { readings: HrReading[]; workoutSessions: WorkoutSession[]; sleep: HrSleepWindow | null } | null
```

```ts
              <HrDayChart readings={hrData.readings} date={todayInTz()} workoutSessions={hrData.workoutSessions} lineColor={hrLineColor} sleepWindow={hrData.sleep} />
```

- [ ] **Step 4: Verify** — `pnpm tsc --noEmit && pnpm lint`. Confirm no other constructor of the `hrData` shape exists: `grep -rn "workoutSessions: ouraWorkoutSessions" app components` shows only the memo above.

- [ ] **Step 5: Commit** — `git add app/session-select/session-select-content.tsx components/home/home-card-widget.tsx components/health/oura-section.tsx && git commit -m "Thread the sleep interval through the HR-today chart callers"`

---

### Task 6: End-to-end verification (Playwright band-present + fallback, gates, version bump)

**Files:**
- Modify: `package.json` (patch bump), `lib/changelog.ts` (add entry)

- [ ] **Step 1: Full gate suite** — Run:
```bash
pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build
```
All green. (Note: a pre-existing unrelated `lib/push.ts` `web-push` tsc error may exist on `main` — confirm it is not newly introduced by this change.)

- [ ] **Step 2: Seed a synthetic band-present night (zero `sleep`-tagged readings + a real sleep row)** against the local dev DB (port 5433). This proves the interval path, not the fallback. Pick a `DATE` for the test user (`test@local.dev`) and insert HR readings tagged only `awake`, plus one `sleep_sessions` row:

```sql
-- band-present: HR readings across the morning, NONE tagged 'sleep', + one sleep session
-- (run via: psql "$DATABASE_URL")
WITH u AS (SELECT id FROM users WHERE email = 'test@local.dev')
INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
SELECT u.id, ('2026-07-04'::date + (g || ' minutes')::interval) AT TIME ZONE 'Australia/Brisbane',
       55 + (g % 20), 'awake'
FROM u, generate_series(0, 600, 15) AS g;

WITH u AS (SELECT id FROM users WHERE email = 'test@local.dev')
INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, oura_id)
SELECT u.id, '2026-07-04',
       '2026-07-03T22:30:00+10:00'::timestamptz,
       '2026-07-04T07:00:00+10:00'::timestamptz,
       8.5, 'synthetic-band-test'
FROM u;
```
Expected `curl -s "http://localhost:3000/api/oura/hr-day?date=2026-07-04" | jq .sleep` → `{ "startMin": 0, "endMin": 420 }`.

- [ ] **Step 3: Playwright — band present.** Log in (`test@local.dev` / `testpass123`), set the browser context timezone to `Australia/Brisbane`, open Home (or Health → Body Oura section) for `2026-07-04`, and assert:
  - the "Sleep" legend chip is visible;
  - a screenshot shows a single indigo band spanning the left ~29% of the chart (0→420 of 1440) and **no** band over the daytime region.
  Example spec sketch:
```ts
// e2e/hr-sleep-band.spec.ts (adapt to the repo's existing Playwright harness/auth helper)
import { test, expect } from '@playwright/test'
test.use({ timezoneId: 'Australia/Brisbane' })
test('overnight sleep band renders from the sleep interval', async ({ page }) => {
  await loginAsTestUser(page)                 // existing helper
  await page.goto('/health?tab=body')
  await expect(page.getByText('Sleep', { exact: true })).toBeVisible()
  await expect(page.locator('canvas').first()).toHaveScreenshot('hr-band-present.png')
})
```

- [ ] **Step 4: Playwright — fallback / no regression.** Two sub-cases on distinct dates:
  - **No sleep session, no `sleep`-tagged readings** → `sleep: null`, chart renders with **no** band and no crash (the "band vanished" symptom is acceptable only here — there is genuinely no sleep to show).
  - **No sleep session, but ≥20 min of `sleep`-tagged readings** (insert HR rows with `source = 'sleep'`) → the `['sleep']` source fallback draws the band, confirming PR #185's `['sleep']`-only filter still works and no daytime `'rest'` phantom appears. Assert exactly one band and it aligns to the tagged window.

- [ ] **Step 5: Version + changelog + commit.** Patch bump (bug fix to a shipped feature — exempt from the merge-confirmation gate per CLAUDE.md):
  - `package.json`: bump the patch version.
  - `lib/changelog.ts`: add an entry — "Fixed the Home/Health Heart-Rate Today chart missing its overnight sleep band; it now draws from the actual sleep-session time."
  - Commit: `git add package.json lib/changelog.ts && git commit -m "Bump version + changelog: HR-today sleep band fix"`

**Acceptance criteria:**
- On a night with a synced primary sleep session, the "Heart Rate · Today" chart shows exactly one indigo band spanning the real sleep time (clipped to the visible day) plus the "Sleep" legend — even when zero readings are tagged `sleep`.
- On a night with HR readings but no sleep session and no `sleep`-tagged readings, no band renders and nothing crashes.
- On a night with `sleep`-tagged readings but no sleep session, the source fallback still draws the band (PR #185 preserved); no daytime phantom bands appear in any case.
- `/api/oura/hr-day` returns `sleep: { startMin, endMin } | null`; SWR headers unchanged; all minute/date math is tz-aware (unit-tested at the 23:59 / 00:01 local boundaries).
- `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build` all green.

⚠️ **Not exercisable in the sandbox — declare in the PR:** real Oura `sleep`/`awake` `source` tagging and real overnight `sleep_sessions` rows only exist on the user's device; the Samsung S25 WebView's canvas rendering of the SVG-adjacent chart band (and the on-device browser timezone = user timezone assumption that aligns the reading x-axis with the tz-computed band) cannot be verified here. The Playwright checks use a synthetic seeded sleep session and a forced `Australia/Brisbane` context — run `docs/device-smoke-checklist.md` on the S25 APK to confirm the band renders against live Oura data before striking U3.
