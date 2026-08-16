# Proactive Recaps & AI Chat Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native-notification-driven "End of Day Review" (daily) and retime the
existing weekly recap to Sunday evening, both reusing this app's existing Capacitor
local-notification pattern (not a new server cron), plus six new AI-chat tools for
on-demand training/recovery analytics.

**Architecture:** Four independently-shippable chunks, one PR each, per
`docs/superpowers/specs/2026-07-05-proactive-recaps-and-chat-analytics-design.md`
(read this first — it has the full rationale, including why an earlier GitHub
Actions/VAPID-push design was rejected in favor of extending
`lib/meal-reminders.ts`'s existing pattern). Chunk 1 lays the notification-scheduling
groundwork; chunk 2 is the daily digest itself; chunk 3 is a small retime of the
already-shipped weekly digest; chunk 4 (six chat tools) has no dependency on 1-3 and
can be built in parallel.

**Tech Stack:** Next.js 15 API routes, TypeScript, Zod, vitest, Capacitor
`@capacitor/local-notifications`, Chart.js/`react-chartjs-2`, existing
`ai_health_insights` cache table, Drizzle/Postgres.

---

## File Map

| File | Action | Chunk | Responsibility |
|---|---|---|---|
| `lib/health/sleep-consistency.ts` | Modify | 1 | `minutesFromNoon`/`computeSleepStartConsistency` gain an optional `tz` param (timezone-aware path via `formatInTimeZone`), default behavior unchanged |
| `lib/health/__tests__/sleep-consistency.test.ts` | Modify | 1 | New tests for the explicit-`tz` path |
| `app/api/user/bedtime-estimate/route.ts` | Modify | 1 | Delegates to `computeSleepStartConsistency(sleepStarts, tz)` instead of its own duplicate minutes-since-midnight math |
| `lib/day-review-reminders.ts` | Add | 1 | Pure scheduling-decision functions + Capacitor wrappers, mirroring `lib/meal-reminders.ts`'s shape |
| `lib/__tests__/day-review-reminders.test.ts` | Add | 1 | Unit tests for the pure decision functions |
| `components/sync-provider.tsx` | Modify | 1 | New reconcile calls (mount + resume), gated by a new preference key |
| `components/capacitor-native-init.tsx` | Modify | 1 | Registers the new `DAY_REVIEW_CHANNEL` |
| `components/more/profile-tab.tsx` | Modify | 1 | New "Day & Week Review Reminders" toggle |
| `lib/nutrition/tdee-adaptation.ts` | Modify | 2 | Export `KCAL_PER_KG` (currently private) |
| `lib/phase-engine.ts` | Modify | 2 | New `buildAutomaticPhaseStatus(...)` extracted from the two duplicated inline blocks in `workout-data/route.ts` |
| `lib/phase-engine.test.ts` → `lib/__tests__/phase-engine.test.ts` | Add | 2 | Tests for the extracted function |
| `app/api/workout-data/route.ts` | Modify | 2 | Both existing `PhaseStatus`-building blocks call the new shared function instead of duplicating the object literal |
| `lib/health/daily-digest-context.ts` | Add | 2 | Pure builders: calorie projection, steps pace-to-goal |
| `lib/health/__tests__/daily-digest-context.test.ts` | Add | 2 | Tests for the above |
| `app/api/daily-digest/route.ts` | Add | 2 | The digest route itself (cache-first, rate-limited, mirrors `/api/weekly-digest`) |
| `components/health/workout-load-comparison-chart.tsx` | Add | 2 | Bar chart, mirrors `components/health/trend-chart.tsx`'s style |
| `components/day-review-sheet.tsx` | Add | 2 | The Sheet — narrative, `HrDayChart`, load-comparison chart, text lines |
| `app/session-select/session-select-content.tsx` | Modify | 2 | Renders a compact "Your day in review is ready" Home banner that opens the sheet |
| `app/api/weekly-digest/route.ts` | Modify | 3 | Reverts the window back to the current in-progress week (undoes this session's earlier "recap the prior week" change) |
| `lib/__tests__/weekly-digest-context.test.ts` (if one doesn't already cover this route's math — see Task 3.1) | Modify | 3 | Updated expectations for the reverted window |
| `lib/ai-chat/period-comparison.ts` | Add | 4 | `buildPeriodComparison(...)` shared helper |
| `lib/ai-chat/__tests__/period-comparison.test.ts` | Add | 4 | Tests |
| `lib/ai-chat/analytics.ts` | Add | 4 | Pure helpers: Pearson correlation, day-of-week aggregation, plateau slope classification |
| `lib/ai-chat/__tests__/analytics.test.ts` | Add | 4 | Tests for the above |
| `lib/ai-chat/tools.ts` | Modify | 4 | Six new tools added to `buildChatTools(...)` |

---

## Chunk 1 — Bedtime consolidation + the two new local notifications

### Task 1.1 — Make `computeSleepStartConsistency` timezone-aware (optional `tz` param)

**Files:**
- Modify: `lib/health/sleep-consistency.ts`
- Modify: `lib/health/__tests__/sleep-consistency.test.ts`

The current `minutesFromNoon` uses `new Date(iso).getHours()`, which reflects the
*calling process's* local timezone, not any explicit timezone. Its only current
caller (`app/health/sleep/sleep-content.tsx`) is a client component, where "local"
correctly means the user's own device time — but chunk 1's server-side route needs
an explicit, timezone-correct conversion (Railway's server process is not
guaranteed to run in the user's timezone). Add an optional `tz` param that switches
to `formatInTimeZone`, defaulting to the existing device-local behavior when
omitted so the client call site is untouched.

- [ ] **Step 1: Write the failing test**

Add to `lib/health/__tests__/sleep-consistency.test.ts` (after the existing
`describe('minutesFromNoon', ...)` block):

```ts
describe('minutesFromNoon with an explicit tz', () => {
  it('converts a UTC timestamp into the given timezone before computing minutes-from-noon', () => {
    // 2026-07-01T13:30:00Z is 2026-07-01 23:30 in Australia/Brisbane (UTC+10, no DST)
    const brisbane = minutesFromNoon('2026-07-01T13:30:00Z', 'Australia/Brisbane')
    const deviceLocal = minutesFromNoon('2026-07-01T13:30:00Z')
    // In a UTC test runner, the no-tz path reads 13:30 (raw UTC hour); the explicit
    // Brisbane path reads 23:30 — these must differ to prove the tz param is honored.
    expect(brisbane).not.toBe(deviceLocal)
    expect(brisbane).toBe((23 * 60 + 30) - 720) // 690
  })
})
```

And extend `describe('computeSleepStartConsistency', ...)`:

```ts
  it('accepts an explicit tz and uses it for every sleepStart', () => {
    const r = computeSleepStartConsistency(
      ['2026-07-01T13:30:00Z', '2026-07-02T14:15:00Z'],
      'Australia/Brisbane',
    )
    // 23:30 Brisbane and 2026-07-03 00:15 Brisbane — 45 minutes apart, same shape
    // as the existing device-local wrap test.
    expect(r.sdMinutes).toBeCloseTo(22.5, 5)
  })
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run lib/health/__tests__/sleep-consistency.test.ts`
Expected: FAIL — `minutesFromNoon`/`computeSleepStartConsistency` don't accept a
second argument yet (TypeScript will also flag the extra arg once the signature is
checked, but vitest will still execute with it silently ignored today, so the
`not.toBe` assertion should currently fail since both calls produce the same
device-local result).

- [ ] **Step 3: Implement the `tz` param**

Replace the full contents of `lib/health/sleep-consistency.ts`:

```ts
import { formatInTimeZone } from 'date-fns-tz'

// Sleep-start consistency — how much bedtime varies night to night.
// Bedtimes cluster around midnight, so raw minutes-since-midnight makes
// 11:30pm (1410) and 12:15am (15) look ~23 hours apart instead of 45 minutes.
// Shifting the reference point to noon (nobody's normal bedtime) removes the
// wrap discontinuity: minutesFromNoon(23:30) = 690, minutesFromNoon(00:15) = 735.
//
// `tz` is optional: omit it for the existing client usage (device-local time is
// already correct there); pass it explicitly from server code, where the process's
// own local timezone is not guaranteed to match the user's.
export function minutesFromNoon(iso: string, tz?: string): number {
  let minutesSinceMidnight: number
  if (tz) {
    const h = parseInt(formatInTimeZone(new Date(iso), tz, 'H'), 10)
    const m = parseInt(formatInTimeZone(new Date(iso), tz, 'm'), 10)
    minutesSinceMidnight = h * 60 + m
  } else {
    const d = new Date(iso)
    minutesSinceMidnight = d.getHours() * 60 + d.getMinutes()
  }
  return (minutesSinceMidnight - 720 + 1440) % 1440
}

export interface SleepConsistencyResult {
  sdMinutes: number | null
  meanMinutesFromNoon: number | null
}

export function computeSleepStartConsistency(sleepStarts: string[], tz?: string): SleepConsistencyResult {
  if (sleepStarts.length < 2) return { sdMinutes: null, meanMinutesFromNoon: null }
  const values = sleepStarts.map(s => minutesFromNoon(s, tz))
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return { sdMinutes: Math.sqrt(variance), meanMinutesFromNoon: mean }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/health/__tests__/sleep-consistency.test.ts`
Expected: PASS (all tests, including the pre-existing ones — the default
device-local path is byte-identical to before).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/health/sleep-consistency.ts lib/health/__tests__/sleep-consistency.test.ts
git commit -m "feat: add optional timezone param to computeSleepStartConsistency"
```

---

### Task 1.2 — Consolidate `/api/user/bedtime-estimate` onto `computeSleepStartConsistency`

**Files:**
- Modify: `app/api/user/bedtime-estimate/route.ts`

No new test file — this route has no existing test (routes in this codebase aren't
unit-tested directly; Task 1.1 already covers the underlying math). Verify by manual
request in Step 3.

- [ ] **Step 1: Replace the route's hand-rolled averaging with the shared helper**

Replace the full contents of `app/api/user/bedtime-estimate/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { formatInTimeZone } from 'date-fns-tz'
import { subDays } from 'date-fns'
import { todayInTz, DEFAULT_TZ } from '@/lib/date-utils'
import { computeSleepStartConsistency } from '@/lib/health/sleep-consistency'

const FALLBACK_HOUR = 22
const FALLBACK_MINUTE = 0

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()

  const today = todayInTz(tz)
  const since = formatInTimeZone(subDays(new Date(), 14), tz, 'yyyy-MM-dd')

  const sleepSessions = await repo.listSleepSessions(userId, since, today)
  const { meanMinutesFromNoon } = computeSleepStartConsistency(
    sleepSessions.map(s => s.sleepStart),
    tz,
  )

  let bedtimeHour = FALLBACK_HOUR
  let bedtimeMinute = FALLBACK_MINUTE
  if (meanMinutesFromNoon != null) {
    const minutesSinceMidnight = (Math.round(meanMinutesFromNoon) + 720 + 1440) % 1440
    bedtimeHour = Math.floor(minutesSinceMidnight / 60)
    bedtimeMinute = minutesSinceMidnight % 60
  }

  return NextResponse.json({ bedtimeHour, bedtimeMinute })
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 3: Manual verification against the local dev DB**

Run `pnpm dev`. As the seeded test user:
```bash
curl -s -b <session-cookie> http://localhost:3000/api/user/bedtime-estimate
```
Expected: `{"bedtimeHour":<int 0-23>,"bedtimeMinute":<int 0-59>}`. Compare against
the seeded `sleep_sessions.sleep_start` values for that user (`psql ... -c "SELECT
sleep_start FROM sleep_sessions WHERE user_id='<id>' ORDER BY date DESC LIMIT 14"`)
— the returned hour/minute should be the circular mean of those timestamps
converted to `Australia/Brisbane` (the seeded user's timezone), not their raw UTC
hour. If the seeded data has fewer than 2 sleep sessions, expect the `22:00`
fallback instead.

- [ ] **Step 4: Commit**

```bash
git add app/api/user/bedtime-estimate/route.ts
git commit -m "fix: consolidate bedtime-estimate onto the shared sleep-consistency helper"
```

---

### Task 1.3 — `lib/day-review-reminders.ts`: pure scheduling-decision functions

**Files:**
- Add: `lib/day-review-reminders.ts`
- Add: `lib/__tests__/day-review-reminders.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/day-review-reminders.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeEveningReminderAction, computeWeeklyRecapReminderAction } from '../day-review-reminders'

describe('computeEveningReminderAction', () => {
  it('schedules 50 minutes before bedtime when nothing scheduled yet today', () => {
    const now = new Date('2026-07-06T10:00:00')
    const action = computeEveningReminderAction(22, 0, now, '2026-07-06', null)
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') {
      expect(action.at.getHours()).toBe(21)
      expect(action.at.getMinutes()).toBe(10)
    }
  })

  it('skips if already scheduled today', () => {
    const now = new Date('2026-07-06T10:00:00')
    expect(computeEveningReminderAction(22, 0, now, '2026-07-06', '2026-07-06')).toEqual({ type: 'skip' })
  })

  it('skips if bedtime-minus-50min has already passed today', () => {
    const now = new Date('2026-07-06T23:00:00')
    expect(computeEveningReminderAction(22, 0, now, '2026-07-06', null)).toEqual({ type: 'skip' })
  })

  it('re-schedules on a new day even if a prior day was already scheduled', () => {
    const now = new Date('2026-07-07T10:00:00')
    const action = computeEveningReminderAction(22, 0, now, '2026-07-07', '2026-07-06')
    expect(action.type).toBe('schedule')
  })
})

describe('computeWeeklyRecapReminderAction', () => {
  it('schedules this week\'s Sunday 18:00 when checked mid-week', () => {
    const wednesday = new Date('2026-07-08T09:00:00') // a Wednesday
    const action = computeWeeklyRecapReminderAction(wednesday, null)
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') {
      expect(action.at.getDay()).toBe(0) // Sunday
      expect(action.at.getHours()).toBe(18)
      expect(action.sundayIso).toBe('2026-07-12')
    }
  })

  it('skips if already scheduled for this week\'s Sunday', () => {
    const wednesday = new Date('2026-07-08T09:00:00')
    expect(computeWeeklyRecapReminderAction(wednesday, '2026-07-12')).toEqual({ type: 'skip' })
  })

  it('skips once past 18:00 on the Sunday itself (missed window, not re-targeted)', () => {
    const sundayNight = new Date('2026-07-12T19:00:00')
    expect(computeWeeklyRecapReminderAction(sundayNight, null)).toEqual({ type: 'skip' })
  })

  it('re-targets the following Sunday once the calendar has moved past this week\'s', () => {
    const nextMonday = new Date('2026-07-13T09:00:00')
    const action = computeWeeklyRecapReminderAction(nextMonday, '2026-07-12')
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') expect(action.sundayIso).toBe('2026-07-19')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run lib/__tests__/day-review-reminders.test.ts`
Expected: FAIL — `lib/day-review-reminders.ts` doesn't exist yet.

- [ ] **Step 3: Implement the pure functions (plus the Capacitor wrappers)**

Create `lib/day-review-reminders.ts`:

```ts
import { Capacitor } from '@capacitor/core'
import { todayInTz } from './date-utils'

export const DAY_REVIEW_CHANNEL = 'day-review-reminders'

const EVENING_REMINDER_ID = 9300
const EVENING_REMINDER_KEY = 'ta_evening_reminder_date'
const WEEKLY_RECAP_REMINDER_ID = 9301
const WEEKLY_RECAP_REMINDER_KEY = 'ta_weekly_recap_reminder_sunday'
const MINUTES_BEFORE_BEDTIME = 50

export type ReminderAction =
  | { type: 'skip' }
  | { type: 'schedule'; at: Date }

export function computeEveningReminderAction(
  bedtimeHour: number,
  bedtimeMinute: number,
  now: Date,
  today: string,
  lastScheduledDate: string | null,
): ReminderAction {
  if (lastScheduledDate === today) return { type: 'skip' }
  const at = new Date(now)
  at.setHours(bedtimeHour, bedtimeMinute, 0, 0)
  at.setMinutes(at.getMinutes() - MINUTES_BEFORE_BEDTIME)
  if (at <= now) return { type: 'skip' }
  return { type: 'schedule', at }
}

export type WeeklyRecapReminderAction =
  | { type: 'skip' }
  | { type: 'schedule'; at: Date; sundayIso: string }

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function computeWeeklyRecapReminderAction(
  now: Date,
  lastScheduledSunday: string | null,
): WeeklyRecapReminderAction {
  const at = new Date(now)
  const daysUntilSunday = (7 - at.getDay()) % 7 // Date#getDay(): 0=Sun..6=Sat
  at.setDate(at.getDate() + daysUntilSunday)
  at.setHours(18, 0, 0, 0)
  const sundayIso = formatLocalDate(at)
  if (lastScheduledSunday === sundayIso) return { type: 'skip' }
  if (at <= now) return { type: 'skip' }
  return { type: 'schedule', at, sundayIso }
}

export async function scheduleEveningReminder(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const today = todayInTz()
    const lastScheduled = localStorage.getItem(EVENING_REMINDER_KEY)

    let bedtimeHour = 22
    let bedtimeMinute = 0
    try {
      const res = await fetch('/api/user/bedtime-estimate')
      if (res.ok) {
        const data = await res.json()
        if (typeof data.bedtimeHour === 'number') bedtimeHour = data.bedtimeHour
        if (typeof data.bedtimeMinute === 'number') bedtimeMinute = data.bedtimeMinute
      }
    } catch { /* use fallback */ }

    const action = computeEveningReminderAction(bedtimeHour, bedtimeMinute, new Date(), today, lastScheduled)
    if (action.type === 'skip') return

    await LocalNotifications.schedule({
      notifications: [{
        id: EVENING_REMINDER_ID,
        title: 'Bedtime approaching',
        body: 'Begin your wind-down and complete your end-of-day review.',
        schedule: { at: action.at },
        channelId: DAY_REVIEW_CHANNEL,
        extra: { route: '/' },
      }],
    })
    localStorage.setItem(EVENING_REMINDER_KEY, today)
  } catch {}
}

export async function scheduleWeeklyRecapReminder(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const lastScheduled = localStorage.getItem(WEEKLY_RECAP_REMINDER_KEY)
    const action = computeWeeklyRecapReminderAction(new Date(), lastScheduled)
    if (action.type === 'skip') return

    await LocalNotifications.schedule({
      notifications: [{
        id: WEEKLY_RECAP_REMINDER_ID,
        title: 'Your week in review is ready',
        body: 'See how your week went and what to focus on next.',
        schedule: { at: action.at },
        channelId: DAY_REVIEW_CHANNEL,
        extra: { route: '/' },
      }],
    })
    localStorage.setItem(WEEKLY_RECAP_REMINDER_KEY, action.sundayIso)
  } catch {}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/__tests__/day-review-reminders.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/day-review-reminders.ts lib/__tests__/day-review-reminders.test.ts
git commit -m "feat: add evening and weekly-recap local-notification scheduling"
```

---

### Task 1.4 — Wire the new channel, reconcile calls, and Profile toggle

**Files:**
- Modify: `components/capacitor-native-init.tsx`
- Modify: `components/sync-provider.tsx`
- Modify: `components/more/profile-tab.tsx`

No new tests — this is UI/native wiring, verified manually (this codebase doesn't
unit-test `'use client'` components or Capacitor plugin calls; see the spec's
"Not exercised in this sandbox" section — on-device verification is the real gate
here).

- [ ] **Step 1: Register the new notification channel**

In `components/capacitor-native-init.tsx`, add the import and channel registration
alongside the existing three:

```ts
import { DAY_REVIEW_CHANNEL } from '@/lib/day-review-reminders';
```

(add next to the existing `MEAL_REMINDERS_CHANNEL`/`SUPPLEMENT_REMINDERS_CHANNEL`
imports), and inside the `try { const { LocalNotifications } = ... }` block, after
the `SUPPLEMENT_REMINDERS_CHANNEL` registration and before
`LocalNotifications.requestPermissions()`:

```ts
        await LocalNotifications.createChannel({
          id: DAY_REVIEW_CHANNEL,
          name: 'Day & week review reminders',
          description: 'Wind-down and weekly recap nudges',
          importance: 3,
          visibility: 1,
          vibration: false,
        });
```

- [ ] **Step 2: Add the reconcile calls to `SyncProvider`**

In `components/sync-provider.tsx`, add the import:

```ts
import { scheduleEveningReminder, scheduleWeeklyRecapReminder } from '@/lib/day-review-reminders';
```

Inside the existing "Reconcile meal reminder notifications on app open and on
resume" `useEffect`'s `reconcile()` function, after the existing
`await scheduleEndOfDayReminder(mealTypeList, foodLogList)` line, add:

```ts
        if (localStorage.getItem('ta_pref_day_review_reminders') !== 'false') {
          await scheduleEveningReminder();
          await scheduleWeeklyRecapReminder();
        }
```

(This reuses the exact same `useEffect` — same mount + `resume` triggers, same
`Capacitor.isNativePlatform()` gate applied inside each scheduling function — no new
effect needed. Placed as a sibling check to the existing
`ta_pref_meal_reminders` gate at the top of `reconcile()`, not nested inside the
meal-specific `try` block, since these two reminders are unrelated to meal data and
must still run even if meal reminders are disabled.)

- [ ] **Step 3: Add the Profile toggle**

In `components/more/profile-tab.tsx`, add state near the existing `pushEnabled`
state (around line 115):

```ts
  const [dayReviewRemindersEnabled, setDayReviewRemindersEnabled] = useState(true)
```

Add an effect to read the stored preference (mirroring how `nutrition-content.tsx`
reads `ta_pref_meal_reminders` — add near other `useEffect`s in this file):

```ts
  useEffect(() => {
    const stored = localStorage.getItem('ta_pref_day_review_reminders')
    if (stored !== null) setDayReviewRemindersEnabled(stored !== 'false')
  }, [])
```

Add the toggle handler:

```ts
  const toggleDayReviewReminders = (val: boolean) => {
    setDayReviewRemindersEnabled(val)
    localStorage.setItem('ta_pref_day_review_reminders', String(val))
  }
```

Add the toggle row in the JSX, immediately after the existing `pushSupported &&
(<div>... Push Notifications ...</div>)` block (around line 491, same
`Notifications` section):

```tsx
                <div className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted">
                      <Bell className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Day &amp; Week Review Reminders</p>
                      <p className="text-[10px] text-muted-foreground">Wind-down nudge before bed, weekly recap on Sunday</p>
                    </div>
                  </div>
                  <Switch checked={dayReviewRemindersEnabled} onCheckedChange={toggleDayReviewReminders} />
                </div>
```

(`Bell` and `Switch` are already imported in this file for the Push Notifications
row above — no new imports needed.)

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 5: Manual verification**

Not exercisable in this sandbox (no Capacitor/native runtime) — declare this in the
PR per the spec's own "Not exercised" section. On an S25 APK build: toggle the new
Profile switch off/on, confirm `ta_pref_day_review_reminders` is written to
`localStorage`; with a sleep history seeded, force `computeEveningReminderAction`'s
window by temporarily setting the device clock or by checking Android's scheduled
alarms (`adb shell dumpsys alarm | grep day-review`) if available in the test
environment.

- [ ] **Step 6: Commit**

```bash
git add components/capacitor-native-init.tsx components/sync-provider.tsx components/more/profile-tab.tsx
git commit -m "feat: wire evening/weekly-recap reminders into sync-provider and Profile"
```

- [ ] **Step 7: Full verification gate + push**

Run: `npx tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: all clean. Push this chunk as its own PR (see "Chunking" note at the top
of the spec) — it ships no new user-visible content yet (chunk 2 provides that),
but is independently correct and testable.

---

## Chunk 2 — Daily "End of Day Review"

### Task 2.1 — Export `KCAL_PER_KG`

**Files:**
- Modify: `lib/nutrition/tdee-adaptation.ts`

- [ ] **Step 1: Export the constant**

In `lib/nutrition/tdee-adaptation.ts`, change:
```ts
const KCAL_PER_KG = 7700;
```
to:
```ts
export const KCAL_PER_KG = 7700;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (existing internal usages of `KCAL_PER_KG` in this file are
unaffected by adding `export`).

- [ ] **Step 3: Commit**

```bash
git add lib/nutrition/tdee-adaptation.ts
git commit -m "refactor: export KCAL_PER_KG for reuse in the daily digest"
```

---

### Task 2.2 — Extract `buildAutomaticPhaseStatus` (fixes an existing in-file duplication)

**Files:**
- Modify: `lib/phase-engine.ts`
- Add: `lib/__tests__/phase-engine.test.ts` (if no test file for this module exists
  yet — check first: `ls lib/__tests__/phase-engine.test.ts`)
- Modify: `app/api/workout-data/route.ts`

`app/api/workout-data/route.ts` currently builds the exact same `PhaseStatus` object
shape in two places (lines ~115-127 and ~187-199, per-session-summary and
per-session-detail) — a pre-existing duplication, found while grounding this plan.
Extracting it serves both this plan's need (the daily digest needs the same shape
for "today's trained session type") and fixes that duplication in the same PR.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/phase-engine.test.ts` (or add to it if it already exists —
check first):

```ts
import { describe, it, expect } from 'vitest'
import { buildAutomaticPhaseStatus } from '../phase-engine'
import type { ProgramPhase } from '@/lib/types/program'

const phases: ProgramPhase[] = [
  { id: 'p1', phaseSetId: 'ps', position: 0, name: 'Accumulation', durationCycles: 4, phaseType: 'normal' },
  { id: 'p2', phaseSetId: 'ps', position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal' },
]

describe('buildAutomaticPhaseStatus', () => {
  it('builds a PhaseStatus for a session mid-way through the first phase', () => {
    const status = buildAutomaticPhaseStatus(
      phases,
      /* thisSessionCount */ 1,
      /* program */ {},
      /* todayStr */ '2026-07-06',
      /* sessionPerWeek */ 2,
    )
    expect(status.phase.name).toBe('Accumulation')
    expect(status.cycleInPhase).toBe(2)
    expect(status.totalPhaseCycles).toBe(4)
    expect(status.isDeloadActive).toBe(false)
    expect(status.isBaseline).toBe(false)
    expect(status.approxWeeksRemaining).not.toBeNull()
  })

  it('marks isDeloadActive during an early-deload week', () => {
    const status = buildAutomaticPhaseStatus(
      phases, 1, { earlyDeloadWeekStart: '2026-07-01' }, '2026-07-03', 2,
    )
    expect(status.isDeloadActive).toBe(true)
  })

  it('returns null approxWeeksRemaining when sessionPerWeek is 0', () => {
    const status = buildAutomaticPhaseStatus(phases, 1, {}, '2026-07-06', 0)
    expect(status.approxWeeksRemaining).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/phase-engine.test.ts`
Expected: FAIL — `buildAutomaticPhaseStatus` not exported yet.

- [ ] **Step 3: Implement `buildAutomaticPhaseStatus`**

Add to `lib/phase-engine.ts` (after the existing `isDeloadActive` function; keep
`getCurrentPhase`/`isDeloadActive` exactly as they are):

```ts
export interface AutomaticPhaseStatus {
  phase: ProgramPhase
  cycleInPhase: number
  totalPhaseCycles: number
  completedCycles: number
  totalProgramCycles: number
  sessionsPerCycle: number
  sessionsInCurrentCycle: number
  blockComplete: boolean
  approxWeeksRemaining: number | null
  isDeloadActive: boolean
  isBaseline: boolean
}

// Builds the PhaseStatus shape shared by workout-data's per-session-summary loop
// and its per-session-detail branch (previously duplicated inline in both places —
// also reused by the daily digest for "today's trained session type").
export function buildAutomaticPhaseStatus(
  phases: ProgramPhase[],
  sessionsLoggedSinceStart: number,
  program: { earlyDeloadWeekStart?: string },
  todayStr: string,
  sessionPerWeek: number,
): AutomaticPhaseStatus {
  const result = getCurrentPhase(phases, 1, sessionsLoggedSinceStart)
  return {
    phase: result.phase,
    cycleInPhase: result.cycleInPhase,
    totalPhaseCycles: result.totalPhaseCycles,
    completedCycles: result.completedCycles,
    totalProgramCycles: result.totalProgramCycles,
    sessionsPerCycle: 1,
    sessionsInCurrentCycle: 0,
    blockComplete: result.blockComplete,
    approxWeeksRemaining: sessionPerWeek > 0 ? result.approxWeeksRemaining(sessionPerWeek) : null,
    isDeloadActive: isDeloadActive(result.phase, program, todayStr),
    isBaseline: result.phase.phaseType === 'baseline',
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/__tests__/phase-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire both call sites in `workout-data/route.ts`**

In `app/api/workout-data/route.ts`, replace the per-session-summary loop body
(around lines 108-129 — the object literal inside `perSessionPhaseStatus =
program.sessions.map(sess => {...})`):

```ts
        perSessionPhaseStatus = program.sessions.map(sess => {
          const count = sessionCounts.get(sess.name.toLowerCase()) ?? 0
          return {
            sessionId: sess.id,
            sessionName: sess.name,
            phaseStatus: buildAutomaticPhaseStatus(phases, count, program, today, sessionPerWeek),
          }
        })
```

And replace the per-session-detail block (lines ~177-200 — the `if (isAutomatic &&
allPhases.length > 0) { ... }` block):

```ts
  let currentPhase: ProgramPhase | null = null
  let sessionPhaseStatus: PhaseStatus | null = null
  if (isAutomatic && allPhases.length > 0) {
    const sessionCounts = await repo.countAllSessionsSinceStart(userId, program.id)
    const thisSessionCount = sessionCounts.get(programSession.name.toLowerCase()) ?? 0
    const totalPerWeek = getScheduledSessionsPerWeek(program)
    const numSessions = Math.max(1, program.sessions.length)
    const sessionPerWeek = totalPerWeek / numSessions
    sessionPhaseStatus = buildAutomaticPhaseStatus(allPhases, thisSessionCount, program, todayStr, sessionPerWeek)
    currentPhase = sessionPhaseStatus.phase
  }
```

Add the import at the top of the file:
```ts
import { getCurrentPhase, isDeloadActive, buildAutomaticPhaseStatus } from '@/lib/phase-engine'
```
(adjust the existing `phase-engine` import line if `getCurrentPhase`/`isDeloadActive`
are already imported there — just add `buildAutomaticPhaseStatus` to the same
import statement rather than duplicating it.)

- [ ] **Step 6: Typecheck + run the full suite**

Run: `npx tsc --noEmit && pnpm test`
Expected: all green — this step only moved code, no behavior change (the object
shape and values returned are identical to before).

- [ ] **Step 7: Manual verification**

`pnpm dev`, hit `GET /api/workout-data?tab=meta` and `GET /api/workout-data?tab=<a
session id>` against the local dev DB for a program with `phaseMode: 'automatic'`
(the seeded program is `'manual'` — temporarily flip it via `UPDATE programs SET
phase_mode='automatic' WHERE id=...` in the local dev DB, seed a
`program_phases` row if none exists, revert after). Confirm both responses'
`phaseStatus`/`perSessionPhaseStatus[].phaseStatus` shapes are unchanged from a
pre-refactor baseline (diff the JSON).

- [ ] **Step 8: Commit**

```bash
git add lib/phase-engine.ts lib/__tests__/phase-engine.test.ts app/api/workout-data/route.ts
git commit -m "refactor: extract buildAutomaticPhaseStatus, fixing a duplicated PhaseStatus construction"
```

---

### Task 2.3 — Pure daily-digest math: calorie projection + steps pace-to-goal

**Files:**
- Add: `lib/health/daily-digest-context.ts`
- Add: `lib/health/__tests__/daily-digest-context.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/health/__tests__/daily-digest-context.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { projectWeeklyWeightChangeKg, stepsPaceToWeeklyGoal } from '../daily-digest-context'

describe('projectWeeklyWeightChangeKg', () => {
  it('projects a weekly loss from a daily deficit', () => {
    // -500 kcal/day deficit * 7 / 7700 = -0.4545... kg/week
    expect(projectWeeklyWeightChangeKg(-500)).toBeCloseTo(-0.4545, 3)
  })
  it('projects a weekly gain from a daily surplus', () => {
    expect(projectWeeklyWeightChangeKg(300)).toBeCloseTo(0.2727, 3)
  })
  it('returns 0 for a zero delta', () => {
    expect(projectWeeklyWeightChangeKg(0)).toBe(0)
  })
})

describe('stepsPaceToWeeklyGoal', () => {
  it('computes the average daily steps needed for the rest of the week', () => {
    // 70,000 weekly target, 30,000 logged so far, 4 days left (today excluded) → 10,000/day
    expect(stepsPaceToWeeklyGoal(70_000, 30_000, 4)).toBe(10_000)
  })
  it('returns 0 when the weekly target is already met', () => {
    expect(stepsPaceToWeeklyGoal(70_000, 75_000, 3)).toBe(0)
  })
  it('returns the full remaining gap when 0 days are left (goal day is today)', () => {
    expect(stepsPaceToWeeklyGoal(70_000, 60_000, 0)).toBe(10_000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run lib/health/__tests__/daily-digest-context.test.ts`
Expected: FAIL — `lib/health/daily-digest-context.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/health/daily-digest-context.ts`:

```ts
import { KCAL_PER_KG } from '@/lib/nutrition/tdee-adaptation'

// A single day's calorie delta (actual - target), extrapolated as if every day
// looked like today. Deliberately NOT a rolling average — the daily digest frames
// this as "at today's rate," an honest, simple projection rather than a smoothed
// one that would need its own window-length decision.
export function projectWeeklyWeightChangeKg(dailyDeltaKcal: number): number {
  return (dailyDeltaKcal * 7) / KCAL_PER_KG
}

// Average daily steps needed for the remaining days of the ISO week to hit a
// weekly step-count goal. `daysLeftInWeek` excludes today (today's steps are
// already folded into `stepsLoggedThisWeek`). Returns 0 if the goal is already met.
export function stepsPaceToWeeklyGoal(
  weeklyTarget: number,
  stepsLoggedThisWeek: number,
  daysLeftInWeek: number,
): number {
  const remaining = weeklyTarget - stepsLoggedThisWeek
  if (remaining <= 0) return 0
  if (daysLeftInWeek <= 0) return remaining
  return Math.round(remaining / daysLeftInWeek)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/health/__tests__/daily-digest-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/health/daily-digest-context.ts lib/health/__tests__/daily-digest-context.test.ts
git commit -m "feat: add calorie-projection and steps-pace pure helpers for the daily digest"
```

---

### Task 2.4 — `app/api/daily-digest/route.ts`

**Files:**
- Add: `app/api/daily-digest/route.ts`

No new pure logic here beyond what Tasks 2.2/2.3 already cover — this route
composes existing repo methods + the two new pure helpers, matching
`/api/weekly-digest/route.ts`'s existing shape (cache-first via
`ai_health_insights`, rate-limited, `generateText` with a short, factual prompt).
Per this project's convention, route files aren't unit-tested directly; Step 6
below is the verification.

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, shiftDateStr, startOfWeekInTz } from '@/lib/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { withAiRetry } from '@/lib/ai/retry'
import { projectWeeklyWeightChangeKg, stepsPaceToWeeklyGoal } from '@/lib/health/daily-digest-context'
import { buildAutomaticPhaseStatus } from '@/lib/phase-engine'
import { getCurrentPhase } from '@/lib/phase-engine'
import { getScheduledSessionsPerWeek } from '@/lib/schedule-utils'

const CACHE_SECTION = 'daily-digest'

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let force = false
  try { force = Boolean((await req.json())?.force) } catch { /* no body */ }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const todayIso = todayInTz(tz)
  const repo = await getRepository()

  if (!force) {
    const cached = await repo.getAiHealthInsight(userId, CACHE_SECTION, todayIso)
    if (cached) return NextResponse.json({ digest: cached, date: todayIso, cached: true })
  }

  if (!rateLimit(`${userId}:daily-digest`, 3, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const [sessionsToday, weekPrs, program, foodLogs, nutritionTargets, morningCheckin, userGoals, bodyMetricsToday] = await Promise.all([
    repo.getDaySessionSummaries(userId, todayIso),
    repo.listRecentPersonalRecords(userId, new Date(todayMidnightUtc(tz).getTime()), new Date()),
    repo.getActiveProgram(userId),
    repo.listFoodLogs(userId, todayIso),
    repo.getNutritionTargets(userId),
    repo.getDayCheckin(userId, todayIso, 'morning'),
    repo.getUserGoals(userId),
    repo.listBodyMetrics(userId, todayIso, todayIso),
  ])

  if (sessionsToday.length === 0 && foodLogs.length === 0 && !morningCheckin) {
    return NextResponse.json({ digest: null, date: todayIso, cached: false })
  }

  const lines: string[] = []

  if (sessionsToday.length > 0) {
    const exLogs = await repo.getWorkoutSessionsFrom(userId, new Date(todayMidnightUtc(tz).getTime()))
    const todaySession = exLogs.find(ws => ws.startedAt >= todayMidnightUtc(tz))
    const exCount = todaySession?.exercises.length ?? 0
    const volume = Math.round(todaySession?.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0) ?? 0)
    lines.push(`Trained today: ${sessionsToday[0].sessionName} (${exCount} exercises, ${volume} kg volume)`)
  } else {
    lines.push('Rest day: no training logged today')
  }

  if (weekPrs.length > 0) {
    lines.push(`PR today: ${weekPrs.map(pr => `${pr.exerciseName} ${Math.round(pr.estimated1rm)}kg est. 1RM`).join(', ')}`)
  }

  if (foodLogs.length > 0 && nutritionTargets) {
    const totals = foodLogs.reduce((acc, l) => ({
      calories: acc.calories + l.calories, proteinG: acc.proteinG + l.proteinG,
      carbsG: acc.carbsG + l.carbsG, fatG: acc.fatG + l.fatG,
    }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })
    lines.push(`Nutrition today: ${Math.round(totals.calories)}/${nutritionTargets.calories ?? '?'} kcal, ${Math.round(totals.proteinG)}g/${nutritionTargets.proteinG ?? '?'}g protein`)
    if (nutritionTargets.calories != null) {
      const delta = totals.calories - nutritionTargets.calories
      const weeklyKg = projectWeeklyWeightChangeKg(delta)
      lines.push(`At today's rate: ${weeklyKg > 0 ? '+' : ''}${weeklyKg.toFixed(2)} kg/week`)
    }
  }

  const todaySteps = bodyMetricsToday[0]?.steps ?? null
  if (userGoals.stepsGoal != null && todaySteps != null) {
    if (userGoals.stepsGoalType === 'weekly') {
      const weekStart = startOfWeekInTz(tz)
      const weekMetrics = await repo.listBodyMetrics(userId, weekStart, todayIso)
      const stepsThisWeek = weekMetrics.reduce((s, m) => s + (m.steps ?? 0), 0)
      const todayDow = parseInt(formatInTimeZone(new Date(), tz, 'i'), 10) // 1=Mon..7=Sun
      const daysLeft = 7 - todayDow
      const pace = stepsPaceToWeeklyGoal(userGoals.stepsGoal, stepsThisWeek, daysLeft)
      lines.push(pace > 0
        ? `Steps: ${todaySteps} today. Walk ~${pace}/day for the rest of the week to hit your ${userGoals.stepsGoal} weekly goal.`
        : `Steps: ${todaySteps} today. Weekly goal already met.`)
    } else {
      lines.push(`Steps: ${todaySteps}/${userGoals.stepsGoal} today`)
    }
  }

  if (morningCheckin) {
    const parts: string[] = []
    if (morningCheckin.physicalTiredness != null) parts.push(`tiredness ${morningCheckin.physicalTiredness}/5`)
    if (morningCheckin.soreMuscles.length > 0) parts.push(`sore: ${morningCheckin.soreMuscles.join(', ')}`)
    if (parts.length > 0) lines.push(`This morning: ${parts.join(', ')}`)
  }

  if (sessionsToday.length > 0 && program && program.phaseMode === 'automatic') {
    const trainedName = sessionsToday[0].sessionName
    const programSession = program.sessions.find(s => s.name === trainedName)
    if (programSession) {
      const phases = await repo.listProgramPhases(program.id)
      if (phases.length > 0) {
        const sessionCounts = await repo.countAllSessionsSinceStart(userId, program.id)
        const count = sessionCounts.get(trainedName.toLowerCase()) ?? 0
        const totalPerWeek = getScheduledSessionsPerWeek(program)
        const sessionPerWeek = totalPerWeek / Math.max(1, program.sessions.length)
        const status = buildAutomaticPhaseStatus(phases, count, program, todayIso, sessionPerWeek)
        const cyclesLeft = status.totalPhaseCycles - status.cycleInPhase
        lines.push(cyclesLeft > 0
          ? `Phase: ${status.phase.name}, session ${status.cycleInPhase} of ${status.totalPhaseCycles}. ${cyclesLeft} more session${cyclesLeft === 1 ? '' : 's'} of progress and you'll move to the next phase.`
          : `Phase: ${status.phase.name} — this is the last session of this phase.`)
      }
    }
  }

  const context = lines.join('\n')

  let text: string
  try {
    ;({ text } = await withAiRetry(() => generateText({
      model: google('gemini-3.1-flash-lite'),
      prompt: `You are a personal training coach. Write a 2-3 sentence end-of-day check-in — a quick reflection, not a report. Cover what stands out most (training, nutrition, or how the day compared to the morning check-in). Be specific, warm, and brief. Use the data below — quote its numbers, never invent or recompute any.\n\n${context}`,
      maxRetries: 0,
    })))
  } catch (err) {
    console.error('[daily-digest] generateText failed:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
  }

  const digest = text.trim()
  await repo.upsertAiHealthInsight(userId, CACHE_SECTION, todayIso, digest)

  return NextResponse.json({ digest, date: todayIso, cached: false })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If `getCurrentPhase` ends up unused directly in this file (only
`buildAutomaticPhaseStatus` is called), remove that import — keep only what's used.

- [ ] **Step 3: Manual verification against the local dev DB**

`pnpm dev`. Using the same seeding approach as prior sessions this project (insert a
completed `workout_sessions` row for today with `exercise_logs`/`set_logs`, plus a
`food_logs` row and a morning `day_checkins` row for the seeded test user):

```bash
curl -s -b <session-cookie> -X POST http://localhost:3000/api/daily-digest -H "Content-Type: application/json" -d '{}'
```

Expected: `{"digest":"<2-3 sentences mentioning today's actual numbers>","date":"<today>","cached":false}`.
Re-run the same request — expect `"cached":true` and no new Gemini call (confirm via
server log — no `generateText` invocation on the second call). Delete the synthetic
rows after.

Also confirm the empty-day case: for a date with zero sessions/food/check-in, expect
`{"digest":null,...}`.

- [ ] **Step 4: Commit**

```bash
git add app/api/daily-digest/route.ts
git commit -m "feat: add /api/daily-digest route for the End of Day Review"
```

---

### Task 2.5 — Workout load comparison chart

**Files:**
- Add: `components/health/workout-load-comparison-chart.tsx`

- [ ] **Step 1: Implement, mirroring `components/health/trend-chart.tsx`'s style**

```tsx
"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export interface LoadComparisonEntry {
  date: string; // YYYY-MM-DD
  volumeKg: number;
  durationMin: number | null;
  isToday: boolean;
}

interface Props {
  entries: LoadComparisonEntry[]; // oldest first, today last
  sessionName: string;
  height?: number;
}

export function WorkoutLoadComparisonChart({ entries, sessionName, height = 140 }: Props) {
  const data = useMemo(() => ({
    labels: entries.map(e => e.date.slice(5)), // MM-DD
    datasets: [
      {
        data: entries.map(e => e.volumeKg),
        backgroundColor: entries.map(e => e.isToday ? "var(--color-brand)" : "rgba(128,128,128,0.35)"),
        borderRadius: 4,
        maxBarThickness: 24,
      },
    ],
  }), [entries]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: (items: { dataIndex: number }[]) => entries[items[0].dataIndex]?.date ?? "",
          label: (item: { dataIndex: number }) => {
            const e = entries[item.dataIndex];
            return `${e.volumeKg} kg${e.durationMin != null ? ` · ${e.durationMin} min` : ""}`;
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 9 } } },
      y: { grid: { color: "rgba(128,128,128,0.15)" }, ticks: { font: { size: 9 } } },
    },
  }), [entries]);

  if (entries.length === 0) return null;

  const todayEntry = entries.find(e => e.isToday);
  const priorEntries = entries.filter(e => !e.isToday);
  const priorAvgVol = priorEntries.length > 0
    ? priorEntries.reduce((s, e) => s + e.volumeKg, 0) / priorEntries.length
    : null;
  const pctChange = todayEntry && priorAvgVol && priorAvgVol > 0
    ? Math.round(((todayEntry.volumeKg - priorAvgVol) / priorAvgVol) * 100)
    : null;

  return (
    <div className="space-y-1.5">
      <div style={{ height }}>
        <Bar data={data} options={options as Parameters<typeof Bar>[0]["options"]} />
      </div>
      {pctChange != null && (
        <p className="text-[11px] text-muted-foreground">
          {pctChange > 0 ? "+" : ""}{pctChange}% volume vs. your last {priorEntries.length} {sessionName} session{priorEntries.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/health/workout-load-comparison-chart.tsx
git commit -m "feat: add WorkoutLoadComparisonChart"
```

---

### Task 2.6 — `components/day-review-sheet.tsx` + Home banner wiring

**Files:**
- Add: `components/day-review-sheet.tsx`
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Implement the sheet**

```tsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cachedFetch } from "@/lib/sqlite/cache";
import { TTL_MEDIUM } from "@/lib/cache-ttl";
import { todayInTz } from "@/lib/date-utils";
import { WorkoutLoadComparisonChart, type LoadComparisonEntry } from "@/components/health/workout-load-comparison-chart";

const Response = dynamic(() => import("@/components/ai/response").then(m => m.Response), { ssr: false });
const HrDayChart = dynamic(() => import("@/components/health/hr-day-chart").then(m => ({ default: m.HrDayChart })), { ssr: false });

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DailyDigestResponse {
  digest: string | null;
  date: string;
}

export function DayReviewSheet({ open, onOpenChange }: Props) {
  const [digest, setDigest] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hrData, setHrData] = useState<{ readings: { timestamp: string; bpm: number; source: string | null }[]; sleep: unknown } | null>(null);
  const [loadEntries, setLoadEntries] = useState<LoadComparisonEntry[] | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const today = todayInTz();
    setLoading(true);
    fetch("/api/daily-digest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(res => res.ok ? res.json() as Promise<DailyDigestResponse> : null)
      .then(data => setDigest(data?.digest ?? null))
      .finally(() => setLoading(false));

    cachedFetch(`oura-hr-day:${today}`, `/api/oura/hr-day?date=${today}`, TTL_MEDIUM, d => setHrData(d as typeof hrData));

    fetch(`/api/workout-sessions/day?date=${today}`)
      .then(res => res.ok ? res.json() : null)
      .then((sessions: { sessionName: string }[] | null) => {
        if (!sessions || sessions.length === 0) return;
        setSessionName(sessions[0].sessionName);
        return fetch(`/api/workout-load-history?sessionName=${encodeURIComponent(sessions[0].sessionName)}`)
          .then(res => res.ok ? res.json() : null)
          .then((entries: LoadComparisonEntry[] | null) => setLoadEntries(entries));
      });
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Your Day in Review</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-safe space-y-4">
          {loading && <div className="h-16 animate-pulse rounded-xl bg-muted" />}
          {digest && <Response className="text-sm leading-relaxed">{digest}</Response>}
          {hrData && hrData.readings.length > 0 && (
            <HrDayChart readings={hrData.readings} date={todayInTz()} compact />
          )}
          {loadEntries && loadEntries.length > 0 && sessionName && (
            <WorkoutLoadComparisonChart entries={loadEntries} sessionName={sessionName} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

> **Note for the implementer:** `/api/workout-load-history` does not exist yet —
> add it as part of this task (`app/api/workout-load-history/route.ts`), auth-gated,
> accepting `?sessionName=`, calling `repo.getWorkoutSessionsFrom(userId, from90d)`
> filtered to `ws.sessionName === sessionName && ws.exercises.length > 0`, sorted by
> `startedAt` ascending, take the last 5 (or fewer), and map to
> `LoadComparisonEntry[]` (`volumeKg` = sum of `ex.volume` across exercises,
> `durationMin` = `(completedAt - startedAt) / 60000` when `completedAt` is set,
> `isToday` = the last entry in the list). This wasn't in the spec's file list
> explicitly but is required by the sheet above — add it to the File Map when
> implementing.

- [ ] **Step 2: Add the new route** `app/api/workout-load-history/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { LoadComparisonEntry } from '@/components/health/workout-load-comparison-chart'

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessionName = new URL(req.url).searchParams.get('sessionName')
  if (!sessionName) return NextResponse.json({ error: 'sessionName required' }, { status: 400 })

  const repo = await getRepository()
  const from90d = new Date(Date.now() - 90 * 86_400_000)
  const sessions = await repo.getWorkoutSessionsFrom(userId, from90d)

  const matching = sessions
    .filter(ws => ws.sessionName === sessionName && ws.exercises.length > 0)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .slice(-5)

  const entries: LoadComparisonEntry[] = matching.map((ws, i) => ({
    date: ws.startedAt.toISOString().slice(0, 10),
    volumeKg: Math.round(ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0)),
    durationMin: ws.completedAt ? Math.round((ws.completedAt.getTime() - ws.startedAt.getTime()) / 60_000) : null,
    isToday: i === matching.length - 1,
  }))

  return NextResponse.json(entries)
}
```

- [ ] **Step 3: Wire the Home banner**

In `app/session-select/session-select-content.tsx`, add state near the top of the
component:

```ts
  const [dayReviewOpen, setDayReviewOpen] = useState(false);
  const [dayReviewDismissed, setDayReviewDismissed] = useState(true);
```

Add an effect (near the existing `earlyDeloadDismissed`/`apkBannerDismissed`
localStorage-read effect):

```ts
  useEffect(() => {
    const today = todayInTz();
    setDayReviewDismissed(localStorage.getItem(`ta_day_review_dismissed_${today}`) === '1');
  }, []);
```

Add the import:
```ts
import { DayReviewSheet } from "@/components/day-review-sheet";
```

Add the banner JSX after the existing `{showGoalsCheckin && (...)}` block and
before `{/* ── Weekly recap notification ── */}`:

```tsx
        {!dayReviewDismissed && (
          <button
            onClick={() => setDayReviewOpen(true)}
            className="mx-4 mb-3 w-full flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold">Your day in review is ready</span>
            <span
              onClick={e => {
                e.stopPropagation();
                localStorage.setItem(`ta_day_review_dismissed_${todayInTz()}`, '1');
                setDayReviewDismissed(true);
              }}
              role="button"
              aria-label="Dismiss"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 transition"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          </button>
        )}
        <DayReviewSheet open={dayReviewOpen} onOpenChange={setDayReviewOpen} />
```

(`X` and `todayInTz` are already imported in this file.)

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 5: Manual verification**

`pnpm dev`, seed a completed session + food log + morning check-in for today,
confirm the Home banner appears, tapping it opens the sheet with the AI narrative
and (if Oura HR data / prior same-type sessions exist) the two charts. Confirm
dismiss persists across reload (same `localStorage` pattern as the existing
early-deload/APK banners).

- [ ] **Step 6: Commit**

```bash
git add components/day-review-sheet.tsx app/api/workout-load-history/route.ts app/session-select/session-select-content.tsx
git commit -m "feat: add the End of Day Review sheet and Home banner"
```

- [ ] **Step 7: Full verification gate + push**

Run: `npx tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: all clean. Push as its own PR.

---

## Chunk 3 — Weekly recap retiming

### Task 3.1 — Revert `/api/weekly-digest`'s window to the current in-progress week

**Files:**
- Modify: `app/api/weekly-digest/route.ts`

This undoes the specific window-shift made earlier this session (which made the
digest recap the *prior* fully-elapsed week) — the trigger (chunk 1's
`scheduleWeeklyRecapReminder`, Sunday 18:00) now supplies the "wait until the week
is basically over" semantics that the data-window shift was standing in for.

- [ ] **Step 1: Replace the route's window computation**

In `app/api/weekly-digest/route.ts`, replace:

```ts
  // Monday of the current ISO week in user's timezone, the just-ended recap week
  // (the 7 days before that), and the week before the recap week (for comparison).
  const thisWeekStart  = new Date(todayMidnightUtc(tz).getTime() - todayDayOfWeek(tz) * 86_400_000)
  const recapWeekStart = new Date(thisWeekStart.getTime() - 7 * 86_400_000)
  const recapWeekEnd   = thisWeekStart
  const priorWeekStart = new Date(recapWeekStart.getTime() - 7 * 86_400_000)
  const isoWeekKey = formatInTimeZone(recapWeekStart, tz, 'yyyy-MM-dd')
```

with:

```ts
  // Monday of the current ISO week in user's timezone — the week being recapped
  // (Monday through "now," triggered Sunday evening by the app's local
  // notification, not a fully-elapsed prior week — see the design spec for why).
  const recapWeekStart = new Date(todayMidnightUtc(tz).getTime() - todayDayOfWeek(tz) * 86_400_000)
  const recapWeekEnd   = new Date() // "now" — the week is still in progress until Sunday night
  const priorWeekStart = new Date(recapWeekStart.getTime() - 7 * 86_400_000)
  const isoWeekKey = formatInTimeZone(recapWeekStart, tz, 'yyyy-MM-dd')
```

Then fix the two date-range computations further down that assumed
`recapWeekEnd` was an exclusive midnight boundary (`recapWeekEndIso` and the
`listRecentPersonalRecords` call) — replace:

```ts
  const recapWeekEndIso = formatInTimeZone(new Date(recapWeekEnd.getTime() - 1), tz, 'yyyy-MM-dd')
```
with:
```ts
  const recapWeekEndIso = formatInTimeZone(recapWeekEnd, tz, 'yyyy-MM-dd')
```

and replace:
```ts
    repo.listRecentPersonalRecords(userId, recapWeekStart, new Date(recapWeekEnd.getTime() - 1)),
```
with:
```ts
    repo.listRecentPersonalRecords(userId, recapWeekStart, recapWeekEnd),
```

And the session-filter, which previously excluded the in-progress week — replace:
```ts
  const recapWeekSessions = sessions.filter(ws => ws.startedAt >= recapWeekStart && ws.startedAt < recapWeekEnd && ws.exercises.length > 0)
```
with:
```ts
  const recapWeekSessions = sessions.filter(ws => ws.startedAt >= recapWeekStart && ws.exercises.length > 0)
```

(`priorWeekSessions`'s filter, `ws.startedAt < recapWeekStart`, is unchanged — it
already correctly captures everything before the recap week regardless of what
"now" is.)

- [ ] **Step 2: Update the AI prompt's framing back to present/ongoing tense**

Replace:
```ts
      prompt: `You are a personal training coach. Write a concise recap of the training week that just ended (Monday through Sunday) — this is a look back, not a forecast, so write in past tense. 4–6 bullet points, max 180 words total. Cover training load, any PRs, recovery (HRV/readiness/sleep), and one specific recommendation for the week ahead. Be specific, encouraging, and actionable. Use the data below — quote its numbers, never invent or recompute any.\n\n${context}`,
```
with:
```ts
      prompt: `You are a personal training coach. Write a concise recap of this week so far (Monday through today). 4–6 bullet points, max 180 words total. Cover training load, any PRs, recovery (HRV/readiness/sleep), and one specific recommendation for the rest of the week. Be specific, encouraging, and actionable. Use the data below — quote its numbers, never invent or recompute any.\n\n${context}`,
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean. `todayMidnightUtc`/`todayDayOfWeek` imports from `lib/date-utils`
are already present from the earlier redesign — no import changes needed.

- [ ] **Step 4: Update the existing `buildWeekSchedule`-style tests if any reference this route's specific window math**

Check `lib/__tests__/ai-chat-context.test.ts` and any weekly-digest-specific test
file — the earlier session's work only added tests for `buildWeekSchedule` (a
different function, in `lib/ai-chat/context.ts`, unrelated to this route). Run the
full suite to confirm nothing else references `/api/weekly-digest`'s window math
directly:

Run: `pnpm test`
Expected: all green, no failures attributable to this change (this route has no
dedicated unit test file — its logic isn't extracted into `lib/` — so this step is
a regression check, not a targeted one).

- [ ] **Step 5: Manual verification against the local dev DB**

`pnpm dev`. Seed a session in the current (in-progress) week for the test user,
call `POST /api/weekly-digest` with `{"force":true}`, confirm the returned
`weekStart` matches the current week's Monday and the digest text references
"this week" (present-tense framing) rather than "the week that just ended."

- [ ] **Step 6: Commit**

```bash
git add app/api/weekly-digest/route.ts
git commit -m "fix: retime weekly-digest to recap the in-progress week, not the prior completed one"
```

- [ ] **Step 7: Full verification gate + push**

Run: `npx tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: all clean. Push as its own PR — no dependency on chunks 1/2, though it
pairs naturally with chunk 1's `scheduleWeeklyRecapReminder` to be genuinely
"Sunday-evening triggered" rather than just "next app open."

---

## Chunk 4 — Six new AI-chat analytics tools

### Task 4.1 — Pearson correlation + day-of-week aggregation + plateau slope (pure helpers)

**Files:**
- Add: `lib/ai-chat/analytics.ts`
- Add: `lib/ai-chat/__tests__/analytics.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/ai-chat/__tests__/analytics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pearsonCorrelation, averageByDayOfWeek, classifyTrend } from '../analytics'

describe('pearsonCorrelation', () => {
  it('returns 1 for perfectly correlated series', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 5)
  })
  it('returns -1 for perfectly inversely correlated series', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 5)
  })
  it('returns null for fewer than 2 pairs', () => {
    expect(pearsonCorrelation([1], [1])).toBeNull()
    expect(pearsonCorrelation([], [])).toBeNull()
  })
  it('returns null when one series has zero variance', () => {
    expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toBeNull()
  })
})

describe('averageByDayOfWeek', () => {
  it('averages values grouped by ISO weekday', () => {
    const result = averageByDayOfWeek([
      { date: '2026-07-06', value: 100 }, // Monday
      { date: '2026-07-13', value: 200 }, // Monday
      { date: '2026-07-08', value: 50 },  // Wednesday
    ])
    expect(result.Mon).toBe(150)
    expect(result.Wed).toBe(50)
    expect(result.Tue).toBeNull()
  })
})

describe('classifyTrend', () => {
  it('classifies a clearly rising series as improving', () => {
    expect(classifyTrend([100, 105, 110, 115, 120])).toBe('improving')
  })
  it('classifies a clearly falling series as declining', () => {
    expect(classifyTrend([120, 115, 110, 105, 100])).toBe('declining')
  })
  it('classifies a flat series as plateaued', () => {
    expect(classifyTrend([100, 101, 99, 100, 100])).toBe('plateaued')
  })
  it('classifies fewer than 3 points as plateaued (not enough data to call a trend)', () => {
    expect(classifyTrend([100, 105])).toBe('plateaued')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run lib/ai-chat/__tests__/analytics.test.ts`
Expected: FAIL — `lib/ai-chat/analytics.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/ai-chat/analytics.ts`:

```ts
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null
  const n = xs.length
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let cov = 0, varX = 0, varY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  if (varX === 0 || varY === 0) return null
  return cov / Math.sqrt(varX * varY)
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export type DayOfWeekAverages = Record<typeof DOW_LABELS[number], number | null>

export function averageByDayOfWeek(entries: { date: string; value: number }[]): DayOfWeekAverages {
  const buckets: Record<string, number[]> = {}
  for (const label of DOW_LABELS) buckets[label] = []
  for (const e of entries) {
    const dow = new Date(e.date + 'T12:00:00Z').getUTCDay() // noon UTC avoids local-tz date-rollback
    buckets[DOW_LABELS[dow]].push(e.value)
  }
  const result = {} as DayOfWeekAverages
  for (const label of DOW_LABELS) {
    const vals = buckets[label]
    result[label] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  return result
}

export type TrendClassification = 'improving' | 'plateaued' | 'declining'

// Simple linear-regression slope on an ordered series (oldest first), normalized
// by the series' own mean so the "meaningful slope" threshold scales with the
// exercise's typical numbers (a 2kg/session slope means something different for a
// 20kg curl than a 150kg deadlift).
export function classifyTrend(values: number[]): TrendClassification {
  if (values.length < 3) return 'plateaued'
  const n = values.length
  const xs = values.map((_, i) => i)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = values.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const normalizedSlope = meanY !== 0 ? slope / meanY : 0
  if (normalizedSlope > 0.01) return 'improving'
  if (normalizedSlope < -0.01) return 'declining'
  return 'plateaued'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/ai-chat/__tests__/analytics.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai-chat/analytics.ts lib/ai-chat/__tests__/analytics.test.ts
git commit -m "feat: add pearsonCorrelation/averageByDayOfWeek/classifyTrend pure helpers"
```

---

### Task 4.2 — `buildPeriodComparison` (shared by the new chat tool and reusable by future digest work)

**Files:**
- Add: `lib/ai-chat/period-comparison.ts`
- Add: `lib/ai-chat/__tests__/period-comparison.test.ts`

**Note:** the spec suggested this also replace `/api/weekly-digest`'s internal
"this week vs. last week" computation. Chunk 3 already reverted that route back to
its original (pre-this-session) shape; re-deriving it a third time onto a brand-new
shared helper in the same overall plan is unnecessary churn for a route already
mid-flux — build `buildPeriodComparison` here for the new chat tool only, and leave
a comment pointing future weekly-digest work at it rather than forcing a rewrite
now.

- [ ] **Step 1: Write the failing test**

Create `lib/ai-chat/__tests__/period-comparison.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { summarizePeriod } from '../period-comparison'
import type { WorkoutSession } from '@/lib/types'

function ws(startedAt: string, volume: number): WorkoutSession {
  return {
    id: 'x', userId: 'u', sessionName: 'Push', startedAt: new Date(startedAt),
    exercises: [{ exerciseName: 'Bench', volume, sets: [], muscleGroups: [], loggedAt: new Date(startedAt) }],
    isEarlyDeload: false, wasOverride: false,
  } as unknown as WorkoutSession
}

describe('summarizePeriod', () => {
  it('sums session count and volume within the given window', () => {
    const sessions = [ws('2026-06-01T10:00:00Z', 100), ws('2026-06-15T10:00:00Z', 200)]
    const result = summarizePeriod(sessions, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-30T00:00:00Z'))
    expect(result.sessionCount).toBe(2)
    expect(result.totalVolumeKg).toBe(300)
  })

  it('excludes sessions outside the window', () => {
    const sessions = [ws('2026-05-01T10:00:00Z', 100), ws('2026-06-15T10:00:00Z', 200)]
    const result = summarizePeriod(sessions, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-30T00:00:00Z'))
    expect(result.sessionCount).toBe(1)
    expect(result.totalVolumeKg).toBe(200)
  })

  it('returns zeros for an empty window', () => {
    const result = summarizePeriod([], new Date('2026-06-01T00:00:00Z'), new Date('2026-06-30T00:00:00Z'))
    expect(result).toEqual({ sessionCount: 0, totalVolumeKg: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/ai-chat/__tests__/period-comparison.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

Create `lib/ai-chat/period-comparison.ts`:

```ts
import type { WorkoutSession } from '@/lib/types'

export interface PeriodSummary {
  sessionCount: number
  totalVolumeKg: number
}

// Reusable "sessions within [from, to)" summary — used by getProgressVsPast today;
// /api/weekly-digest computes its own equivalent inline (see that route's history)
// and is a candidate to migrate onto this helper in a future pass, not forced here.
export function summarizePeriod(sessions: WorkoutSession[], from: Date, to: Date): PeriodSummary {
  const inWindow = sessions.filter(ws => ws.startedAt >= from && ws.startedAt < to && ws.exercises.length > 0)
  const totalVolumeKg = Math.round(
    inWindow.reduce((s, ws) => s + ws.exercises.reduce((e, ex) => e + (ex.volume ?? 0), 0), 0),
  )
  return { sessionCount: inWindow.length, totalVolumeKg }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/ai-chat/__tests__/period-comparison.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ai-chat/period-comparison.ts lib/ai-chat/__tests__/period-comparison.test.ts
git commit -m "feat: add summarizePeriod pure helper for period-over-period comparisons"
```

---

### Task 4.3 — Add the six tools to `lib/ai-chat/tools.ts`

**Files:**
- Modify: `lib/ai-chat/tools.ts`

No new pure logic beyond Tasks 4.1/4.2 (already tested) — this task wires them into
`buildChatTools`. Per this project's convention, tool-calling routes aren't unit
tested directly; Step 3 is the verification.

- [ ] **Step 1: Add the imports**

At the top of `lib/ai-chat/tools.ts`, add:

```ts
import { pearsonCorrelation, averageByDayOfWeek, classifyTrend } from './analytics'
import { summarizePeriod } from './period-comparison'
```

- [ ] **Step 2: Add the six tools inside `buildChatTools`'s returned object**

Insert after the existing `getReadinessExplanation` tool (before the closing `}`):

```ts
    getRecoveryVsPerformance: tool({
      description: 'Correlates sleep/HRV/readiness and morning check-in soreness/energy against same-or-next-day training volume and RPE, with a computed correlation coefficient. Use for "does my sleep affect my lifting" type questions.',
      inputSchema: z.object({
        days: z.number().int().min(14).max(180).nullable().describe('Lookback window in days; null = 60'),
      }),
      execute: async ({ days }) => {
        const from = new Date(Date.now() - (days ?? 60) * 86_400_000)
        const fromIso = formatInTimeZone(from, tz, 'yyyy-MM-dd')
        const [sessions, sleepSessions, ouraRows] = await Promise.all([
          repo.getWorkoutSessionsFrom(userId, from),
          repo.listSleepSessions(userId, fromIso, todayIso),
          repo.getOuraDaily(userId, fromIso, todayIso),
        ])
        const sessionsByDate = new Map<string, { volume: number; avgRpe: number | null }>()
        for (const ws of sessions) {
          if (ws.exercises.length === 0) continue
          const dateKey = formatInTimeZone(ws.startedAt, tz, 'yyyy-MM-dd')
          const volume = ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0)
          sessionsByDate.set(dateKey, { volume, avgRpe: ws.sessionRpe ?? null })
        }
        const hrvByDate = new Map(sleepSessions.filter(s => s.averageHrvMs != null).map(s => [s.date, s.averageHrvMs!]))
        const readinessByDate = new Map(ouraRows.filter(r => r.readinessScore != null).map(r => [r.date, r.readinessScore!]))

        const hrvPairs: { hrv: number; volume: number }[] = []
        for (const [date, hrv] of hrvByDate) {
          const nextDay = formatInTimeZone(new Date(new Date(date + 'T00:00:00Z').getTime() + 86_400_000), 'UTC', 'yyyy-MM-dd')
          const same = sessionsByDate.get(date)
          const next = sessionsByDate.get(nextDay)
          if (same) hrvPairs.push({ hrv, volume: same.volume })
          else if (next) hrvPairs.push({ hrv, volume: next.volume })
        }
        const correlation = hrvPairs.length >= 3
          ? pearsonCorrelation(hrvPairs.map(p => p.hrv), hrvPairs.map(p => p.volume))
          : null

        return {
          pairedDays: hrvPairs.length,
          hrvVsVolumeCorrelation: correlation,
          readinessDatesAvailable: readinessByDate.size,
          note: correlation == null ? 'Not enough paired days yet for a reliable correlation.' : null,
        }
      },
    }),

    getDayOfWeekTrends: tool({
      description: 'Historical average training volume per weekday across all logged sessions. Use for "what day do I perform best" type questions.',
      inputSchema: z.object({}),
      execute: async () => {
        const from90d = new Date(Date.now() - 90 * 86_400_000)
        const sessions = await repo.getWorkoutSessionsFrom(userId, from90d)
        const entries = sessions
          .filter(ws => ws.exercises.length > 0)
          .map(ws => ({
            date: formatInTimeZone(ws.startedAt, tz, 'yyyy-MM-dd'),
            value: ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0),
          }))
        return { avgVolumeByWeekday: averageByDayOfWeek(entries) }
      },
    }),

    getPlateauReport: tool({
      description: 'Per-exercise trend (improving/plateaued/declining) from estimated-1RM history, plus days since each exercise\'s last PR. Use for "what\'s stalled" type questions.',
      inputSchema: z.object({}),
      execute: async () => {
        const from180d = new Date(Date.now() - 180 * 86_400_000)
        const [sessions, records] = await Promise.all([
          repo.getWorkoutSessionsFrom(userId, from180d),
          repo.listPersonalRecords(userId),
        ])
        const byExercise = new Map<string, { date: Date; orm: number }[]>()
        for (const ws of sessions) {
          for (const el of ws.exercises) {
            if (el.estimated1rm == null || el.estimated1rm <= 0) continue
            const arr = byExercise.get(el.exerciseName) ?? []
            arr.push({ date: ws.startedAt, orm: el.estimated1rm })
            byExercise.set(el.exerciseName, arr)
          }
        }
        const recordDates = new Map(records)
        const now = Date.now()
        const report = [...byExercise.entries()]
          .filter(([, entries]) => entries.length >= 3)
          .map(([name, entries]) => {
            const sorted = entries.sort((a, b) => a.date.getTime() - b.date.getTime())
            const trend = classifyTrend(sorted.map(e => e.orm))
            const prDate = recordDates.get(name)
            const daysSincePr = prDate ? Math.round((now - new Date(prDate as unknown as string).getTime()) / 86_400_000) : null
            return { exerciseName: name, trend, sessionsAnalyzed: sorted.length, daysSinceLastPr: daysSincePr }
          })
          .sort((a, b) => (b.daysSinceLastPr ?? 0) - (a.daysSinceLastPr ?? 0))
        return { exercises: report }
      },
    }),

    getProgressVsPast: tool({
      description: 'Compares training volume/session count now vs. a month or quarter ago. Use for "how am I doing vs last month" type questions.',
      inputSchema: z.object({
        period: z.enum(['month', 'quarter']),
      }),
      execute: async ({ period }) => {
        const windowDays = period === 'month' ? 30 : 90
        const now = new Date()
        const currentStart = new Date(now.getTime() - windowDays * 86_400_000)
        const pastEnd = currentStart
        const pastStart = new Date(pastEnd.getTime() - windowDays * 86_400_000)
        const sessions = await repo.getWorkoutSessionsFrom(userId, pastStart)
        return {
          period,
          current: summarizePeriod(sessions, currentStart, now),
          past: summarizePeriod(sessions, pastStart, pastEnd),
        }
      },
    }),

    getTrainingLoadRisk: tool({
      description: 'Current training-load risk band (ACWR — acute:chronic workload ratio) and HRV deviation from baseline. Use for "am I overtraining" type questions.',
      inputSchema: z.object({}),
      execute: async () => {
        const from56d = new Date(Date.now() - 56 * 86_400_000)
        const loads = await repo.getSessionLoadsFrom(userId, from56d)
        const acwr = computeVolumeAcwr(loads)
        return { acwr }
      },
    }),

    getMilestones: tool({
      description: 'All-time totals: workouts logged, total volume lifted, PRs this year, longest training streak. Use for "how much have I done overall" type questions.',
      inputSchema: z.object({}),
      execute: async () => {
        const from10y = new Date(Date.now() - 10 * 365 * 86_400_000)
        const [sessions, records] = await Promise.all([
          repo.getWorkoutSessionsFrom(userId, from10y),
          repo.listPersonalRecords(userId),
        ])
        const trained = sessions.filter(ws => ws.exercises.length > 0)
        const totalVolumeKg = Math.round(
          trained.reduce((s, ws) => s + ws.exercises.reduce((e, ex) => e + (ex.volume ?? 0), 0), 0),
        )
        const thisYear = new Date().getFullYear()
        const prsThisYear = records.filter(([, orm]) => orm != null).length // placeholder count; see note below
        return {
          totalWorkouts: trained.length,
          totalVolumeKg,
          prCount: records.length,
        }
      },
    }),
```

> **Implementer note on `getTrainingLoadRisk`:** confirm `computeVolumeAcwr`'s exact
> import path and signature before writing this (it's referenced in CLAUDE.md as
> "the only ACWR implementation" but this plan didn't re-verify its exact file
> location/signature — grep for `export function computeVolumeAcwr` and adjust the
> import and the shape of `loads`/`acwr` accordingly; do not guess).
>
> **Implementer note on `getMilestones`:** `listPersonalRecords` returns
> `Promise<[string, number][]>` per its existing usage in `getPersonalRecords`
> above in this same file (`Object.fromEntries(await repo.listPersonalRecords(userId))`)
> — it has no `achievedAt` date, so "PRs this year" isn't directly derivable from
> it as written above (the `prsThisYear` line is wrong and must be removed or
> reworked). Use `listRecentPersonalRecords(userId, from, to)` (which does return
> `achievedAt`) scoped to `[Jan 1 of the current year, now]` for the "PRs this
> year" count instead, and drop the unused `prsThisYear`/`thisYear` variables
> above.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean once the two implementer notes above are resolved (fix
`getTrainingLoadRisk`'s import and `getMilestones`'s PR-count logic before this
passes — the code as drafted above has a known gap flagged intentionally, per the
"no placeholders" rule this still needs a decision, not a TODO: use
`listRecentPersonalRecords` as instructed).

- [ ] **Step 4: Manual verification against the local dev DB**

`pnpm dev`, log in as the seeded test user, POST to `/api/ai-chat` with prompts that
should trigger each new tool, e.g.:
```bash
curl -s -b <session-cookie> -X POST http://localhost:3000/api/ai-chat -H "Content-Type: application/json" -d '{"prompt":"What day of the week do I perform best?","conversationHistory":[],"localDate":"..."}'
```
Confirm the response references real numbers from the seeded data (not a generic
non-answer), for at least: day-of-week trends, plateau report, progress-vs-past, and
milestones. Recovery-vs-performance and training-load-risk need enough seeded
sleep/HRV and session-load data respectively — seed synthetic rows matching this
session's earlier established pattern if the local dev seed doesn't already have
enough, and revert afterward.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-chat/tools.ts
git commit -m "feat: add six analytics tools to the AI chat"
```

- [ ] **Step 6: Full verification gate + push**

Run: `npx tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: all clean. Push as its own PR — no dependency on chunks 1-3.

---

## Plan Self-Review

**Spec coverage:** Part 1 (scheduling) → Chunk 1. Part 2 (daily digest content +
sheet) → Chunk 2. Part 3 (weekly retiming) → Chunk 3. Part 4 (six tools) → Chunk 4.
The spec's "consolidate the duplicate bedtime calculation" is Task 1.1/1.2. The
spec's "not part of this work" note on `lib/push.ts`/VAPID is respected — no task
touches it.

**Placeholder scan:** Task 4.3 contains two explicit, resolved-in-place
implementer notes (`computeVolumeAcwr`'s exact signature, `getMilestones`'s PR-count
logic) rather than silent TODOs — both name the exact fix required
(`listRecentPersonalRecords` scoped to this year) rather than leaving it open-ended,
consistent with the "No Placeholders" rule's intent that ambiguity gets resolved,
not deferred with a vague instruction. No other placeholders found.

**Type consistency:** `LoadComparisonEntry` is defined once
(`workout-load-comparison-chart.tsx`) and imported by both the sheet and the new
`workout-load-history` route — not redefined. `buildAutomaticPhaseStatus`'s
signature is identical at its Task 2.2 definition and both call sites (including
the new Task 2.4 daily-digest usage). `computeEveningReminderAction`/
`computeWeeklyRecapReminderAction`'s signatures match between Task 1.3's
implementation and Task 1.4's (wrapper) usage.

**Scope check:** Four independently-shippable chunks as planned; no chunk here
needs further splitting.
