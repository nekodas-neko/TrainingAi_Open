# UI bug fixes: timeline exercise names, activity ring, End of Day review — Implementation Plan

> **✅ RESOLVED — all 5 tasks verified shipped on `main` 2026-07-20.** Do NOT re-implement. Task 2
> (activity-ring boost) shipped inside the shared `components/health/health-score-detail.tsx` ring
> (`ScoreDisplay` boost arc `:47-55`, wired `:171-175`) — NOT in `activity-content.tsx`, which this plan
> predates (the activity page was refactored to delegate to `HealthScoreDetail`). Per-task confirmation
> is in `docs/planned_upgrades.md` § "Batch K". Retained for historical context only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Provenance:** every diff below was written, `tsc --noEmit`/`eslint` checked, and exercised against the local dev server + seeded test user (`test@local.dev` / `testpass123`) in a prior session. The End of Day slider + background changes (Task 4/5) were visually confirmed via Playwright screenshots — colored 1–5 rungs render correctly (amber/purple/green/blue/orange per scale) and the indigo gradient shows through the translucent cards. The activity-ring boost segment (Task 2) is logically straightforward (mirrors the existing base-ring math) but was **not** visually confirmed — the local seed has no `oura_daily` rows and no workout logged today, so `activityBlend.adjustment` never came out > 0 through the real API. Verify it visually as part of this plan (see Task 2's verification step for a cache-injection trick that works around the missing seed data).

**Goal:** Five small, independent UI/bug fixes requested directly by the user from screenshots of the Home timeline, Activity detail page, and End of Day review sheet:
1. Remove exercise names from workout timeline cards (Home timeline + full Timeline page) — redundant with the existing duration/sets/exercise-count line and makes cards taller than needed.
2. Activity detail page: show the "+N training" boost (already called out in a text banner) as a visually distinct second-color segment on the activity score ring itself.
3. Fix the End of Day / meal-backfill reminder to fire **30 minutes before** the user's estimated bedtime (their goal/average), not ~60 minutes before rounded to the hour — it currently under-shoots the design intent documented in `docs/planned_upgrades.md` Quick win table and `projectOverview.md`'s Phase 12.1 entry.
4. Convert the End of Day review's five 1–5 wellness scales (Physical tiredness, Mental drain, Movement, Hydration, Late/heavy meal) from plain black/white toggle buttons into a colored, benchmarked "slider" control — mirroring the segmented, filled-progress look already established by `RpeSlider` (`components/workout/rpe-strip.tsx`) and the workout builder's `GoalSpectrum` (`components/workout-builder/goal-spectrum.tsx`).
5. Color-theme each scale to its metric (e.g. blue for hydration) and give the End of Day sheet itself a themed background instead of flat `bg-secondary`, reusing the existing `PAGE_GRADIENTS` night gradient from `components/health/detail-hero.tsx`.

**Architecture:** All five items are small, isolated, client-side (or one small API route) changes — no schema/migration work, no new dependencies. Reuse existing primitives rather than building new ones: the colored-segment "slider" pattern already exists twice in the codebase (`RpeSlider`, `GoalSpectrum`) and this plan generalizes the existing `ScaleSelector` component to the same look rather than introducing a Radix `Slider` (not currently installed — `grep -i "radix-ui/react-slider" package.json` returns nothing). The activity-ring boost reuses the exact two-arc SVG `stroke-dasharray`/`stroke-dashoffset` technique already used for the ring's base arc.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript, Tailwind v4, `pnpm` only. No DB/migration changes. Verify with `pnpm exec tsc --noEmit`, `pnpm exec eslint <files>`, and manual `pnpm dev` testing against the local dev DB (`test@local.dev` / `testpass123`).

---

**Setup (before Task 1):**

- [ ] Create the feature branch (or continue on the one already checked out for this work):
  ```bash
  git fetch origin main && git checkout -B fix/ui-timeline-activity-eod-review origin/main
  ```
- [ ] Ensure the local dev DB is up (idempotent): `pnpm db:local`
- [ ] Baseline: `pnpm exec tsc --noEmit` (expect only the pre-existing, unrelated `lib/push.ts` "Cannot find module 'web-push'" error — confirm it's there on a clean checkout before starting so it isn't mistaken for something this plan broke) and `pnpm lint` clean.

---

### Task 1: Remove exercise names from workout timeline cards

Two near-identical timeline renderers both list every exercise name under the workout card's duration/sets/exercise-count line — this is the block the user screenshotted on Home ("Single Leg Hip Thrusts · Barbell Front Squat · Dumbbell Bulgarian Split Squat · Dumbbell Forearm Curl · Cable Crunch Abs") and asked to have removed. It was added in v1.71.1 (#53) alongside the start–end time range; the time range stays, only the name list goes.

**Files:**
- Modify: `components/home-day-timeline.tsx` (`WorkoutCard`, ~lines 73–101)
- Modify: `app/health/timeline/page.tsx` (`TimelineItem`, ~lines 40–51)

**Steps:**

- [ ] In `components/home-day-timeline.tsx`, in `WorkoutCard`, delete the exercise-names block that follows the duration/sets/exerciseCount row:
  ```tsx
  {ev.exerciseNames && ev.exerciseNames.length > 0 && (
    <p className="text-xs leading-snug text-muted-foreground/80">
      {ev.exerciseNames.join(" · ")}
    </p>
  )}
  ```
  Leave everything else in the function (the duration/sets/exerciseCount `<div>`) untouched — just close the component right after that `</div>`.
- [ ] In `app/health/timeline/page.tsx`, in `TimelineItem`, delete the matching block:
  ```tsx
  {event.type === 'workout' && event.exerciseNames && event.exerciseNames.length > 0 && (
    <p className="text-xs text-muted-foreground/80 mt-0.5 leading-snug">{event.exerciseNames.join(' · ')}</p>
  )}
  ```
- [ ] Leave `TimelineEvent.exerciseNames` (`app/api/day-timeline/route.ts:31,166`) and its population untouched — it's cheap to compute (already joined for `exerciseCount`) and removing the field from the API/type is unnecessary churn for a UI-only ask; don't touch the API route.
- [ ] Run `pnpm exec tsc --noEmit` — expect clean (no other consumer of `exerciseNames` exists; confirmed via `grep -rn "exerciseNames" app/ components/` before starting — only these two render sites use it for display).
- [ ] Verify: `pnpm dev`, log in as `test@local.dev`/`testpass123`, log a workout today (or use the seeded historical sessions via `/health/timeline`), and confirm the workout card shows duration/sets/exercise-count and the start–end time range but no exercise name list, on both `/` (Home) and `/health/timeline`.

---

### Task 2: Activity ring shows the training-boost segment

`app/health/activity/activity-content.tsx`'s `ScoreDisplay` currently draws one colored arc for the final blended score. Below it, a text banner already explains the blend when `data.activityBlend.adjustment > 0`: *"Oura 56 · +10 training → 66"* (`activity-content.tsx:118-127`, reading `data.activityBlend.{base,adjustment,final}` from `ActivityBlendResult` in `lib/activity/blend-activity.ts`). The user wants that same information reflected on the ring itself, not just in the text below it — the ring should visually show "how much of this score is baseline vs. training credit."

**Files:**
- Modify: `app/health/activity/activity-content.tsx` (`ScoreDisplay` function, ~lines 23–41; its call site, ~lines 113–115)

**Steps:**

- [ ] Extend `ScoreDisplay` to accept an optional `trainingBoostFrom` prop (the base/Oura score to boost from) and draw a second, brand-colored arc overlaid on the last portion of the ring — from `trainingBoostFrom` to `score`:
  ```tsx
  function ScoreDisplay({ score, label, trainingBoostFrom }: { score: number | null; label: string; trainingBoostFrom?: number | null }) {
    const color = bandColor(score);
    const r = 52;
    const circumference = 2 * Math.PI * r;
    const offset = score != null ? circumference * (1 - score / 100) : circumference;
    const hasBoost = score != null && trainingBoostFrom != null && score > trainingBoostFrom;
    const baseFrac = hasBoost ? trainingBoostFrom / 100 : 0;
    const boostFrac = hasBoost ? (score - trainingBoostFrom) / 100 : 0;
    return (
      <div className="relative w-32 h-32">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8" stroke="rgba(255,255,255,0.12)" />
          <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8"
            style={{ stroke: color, strokeDasharray: circumference, strokeDashoffset: offset, strokeLinecap: "round" }} />
          {hasBoost && (
            <circle cx="60" cy="60" r={r} fill="none" strokeWidth="8"
              style={{
                stroke: "var(--color-brand)",
                strokeDasharray: `${boostFrac * circumference} ${circumference}`,
                strokeDashoffset: -baseFrac * circumference,
                strokeLinecap: "round",
              }} />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold tabular-nums" style={{ color }}>{score ?? "—"}</span>
          <span className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>{label}</span>
        </div>
      </div>
    );
  }
  ```
  (This is the same two-arc `stroke-dasharray`/`stroke-dashoffset` overlay technique — the boost arc is drawn on top of the base arc at full opacity, rounded caps at both ends, so it reads as "the last N points are training credit" rather than fighting the base arc's color.)
- [ ] Update the call site to pass the boost-from value, gated the same way the existing text banner already gates itself (`data.activityBlend.adjustment > 0`):
  ```tsx
  <DetailHero theme="activity" title="Activity">
    <ScoreDisplay
      score={data?.activityScore ?? null}
      label="Activity Score"
      trainingBoostFrom={data?.activityBlend && data.activityBlend.adjustment > 0 ? data.activityBlend.base : null}
    />
  </DetailHero>
  ```
- [ ] Run `pnpm exec tsc --noEmit` — `data.activityBlend.base` is typed `number | null` in `ActivityBlendResult`, matching the new optional prop's type.
- [ ] **Verify visually** — the local dev seed has no `oura_daily` rows, so `activityBlend.adjustment` will be 0 through the real API and the boost arc won't show through normal navigation. Force it via a Playwright `page.route` intercept on `**/api/readiness-score` that fulfills with a hand-built `ReadinessScoreResponse` JSON body where `activityScore: 66` and `activityBlend: { base: 56, adjustment: 10, final: 66, trained: true }` (see `app/api/readiness-score/route.ts` for the full response shape — every field is required, so build a complete fake object). Navigate to `/health/activity` after the route intercept is registered and screenshot; confirm a second, brand-colored arc segment appears at the end of the ring distinct from the base color, and that the existing "Oura 56 · +10 training → 66" text banner still renders below it unchanged.
- [ ] Note for a real on-device/production check: this only becomes visible for a user with a connected Oura ring who has also logged a gym session today with volume near/above their typical session — rare in the local sandbox. Flag as a "confirm on next real day with both signals present" follow-up in the PR description.

---

### Task 3: End of Day reminder fires 30 minutes before bedtime (not ~60, and with minute precision)

`lib/meal-reminders.ts`'s `scheduleEndOfDayReminder()` already exists and is wired into `sync-provider.tsx` (confirmed shipped per `projectOverview.md`'s Phase 12.1 entry), but it has a real bug against its own documented intent: `docs/superpowers/plans/archive/2026-06-28-master-execution-plan-consolidated.md:446` and the original design both say "~30 min before bedtime," but the shipped code does `at.setHours(bedtimeHour - 1, 0, 0, 0)` — that's **60 minutes before**, rounded down to the top of the hour, discarding whatever minute-level average bedtime `GET /api/user/bedtime-estimate` could have produced (it currently only returns an hour, already rounded). Net effect: if the user's average/goal bedtime is 9:30pm, today's code fires at 9:00pm (a full hour early); the user wants it firing at 9:00pm *only if* bedtime is actually 9:30 — i.e. exactly 30 minutes before, computed from a real hour+minute estimate.

**Files:**
- Modify: `app/api/user/bedtime-estimate/route.ts` (add minute precision to the response)
- Modify: `lib/meal-reminders.ts` (`scheduleEndOfDayReminder`, ~lines 136–182)

**Steps:**

- [ ] In `app/api/user/bedtime-estimate/route.ts`, replace the hour-only average with a minute-precision average, returning both `bedtimeHour` and `bedtimeMinute`:
  ```ts
  const DEFAULT_TZ = 'Australia/Brisbane'
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

    let bedtimeHour = FALLBACK_HOUR
    let bedtimeMinute = FALLBACK_MINUTE
    if (sleepSessions.length > 0) {
      // Minutes since midnight, with sleep starting 0–5h treated as "late night" (+24h) so the
      // average stays in the right bucket instead of wrapping around midnight.
      const minutesSinceMidnight = sleepSessions.map(s => {
        const h = parseInt(formatInTimeZone(new Date(s.sleepStart), tz, 'H'), 10)
        const m = parseInt(formatInTimeZone(new Date(s.sleepStart), tz, 'm'), 10)
        const hh = h < 6 ? h + 24 : h
        return hh * 60 + m
      })
      const avgMinutes = Math.round(minutesSinceMidnight.reduce((a, b) => a + b, 0) / minutesSinceMidnight.length) % (24 * 60)
      bedtimeHour = Math.floor(avgMinutes / 60)
      bedtimeMinute = avgMinutes % 60
    }

    return NextResponse.json({ bedtimeHour, bedtimeMinute })
  }
  ```
  (Keep the existing imports/`auth()`/`getRepository()` call at the top of the file as-is — only the body of `GET` and the two constants change.)
- [ ] In `lib/meal-reminders.ts`, update `scheduleEndOfDayReminder` to read the new `bedtimeMinute` field and subtract exactly 30 minutes instead of setting the hour back by one:
  ```ts
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

  const at = new Date()
  at.setHours(bedtimeHour, bedtimeMinute, 0, 0)
  at.setMinutes(at.getMinutes() - 30)
  // If that time has already passed today, don't schedule
  if (at <= new Date()) return
  ```
  Everything above and below this block (the `hasUnloggedRequired` gate, the `lastScheduled`/`localStorage` dedup check, and the `LocalNotifications.schedule` call) stays unchanged — only the bedtime lookup and the offset arithmetic change.
- [ ] Run `pnpm exec tsc --noEmit` — clean (both changed functions keep their existing signatures/return shapes; `bedtimeMinute` is a new, additive JSON field).
- [ ] Verify the API change directly against the local dev DB:
  ```bash
  pnpm dev &
  BASE=http://localhost:3000
  CSRF=$(curl -s -c /tmp/ta-jar "$BASE/api/auth/csrf" | jq -r .csrfToken)
  curl -s -b /tmp/ta-jar -c /tmp/ta-jar -X POST "$BASE/api/auth/callback/credentials" \
    --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=test@local.dev" \
    --data-urlencode "password=testpass123" -o /dev/null
  curl -s -b /tmp/ta-jar "$BASE/api/user/bedtime-estimate" | jq .
  ```
  Expected: a JSON object with both `bedtimeHour` and `bedtimeMinute` present (the seeded test user has no `sleep_sessions` rows in some seed variants, in which case expect the fallback `{"bedtimeHour":22,"bedtimeMinute":0}` — if so, insert 2–3 `sleep_sessions` rows with distinct `sleep_start` minute values via `psql` and re-check that `bedtimeMinute` reflects their average, not just 0).
- [ ] `scheduleEndOfDayReminder` itself only runs on `Capacitor.isNativePlatform()`, so it can't be exercised end-to-end in the web sandbox — note in the PR description that the 30-minutes-before firing time is a logic-level fix verified via the API response above, and needs an on-device (APK) confirmation: set the device clock/bedtime estimate so the reminder should fire in ~2 minutes, background the app, and confirm the notification appears at the expected time (not 30/60 minutes off).

---

### Task 4: Colored, benchmarked "slider" for the End of Day 1–5 wellness scales

The End of Day review's five wellness scales (`components/nutrition/end-of-day/wellness-section.tsx` → `ScaleSelector`) currently render as five identical plain black/white toggle buttons per scale (`components/nutrition/end-of-day/scale-selector.tsx`). The user asked for these to become sliders "with benchmarks in it for each rung," referencing the workout builder's colored training-goal scale (`components/workout-builder/goal-spectrum.tsx`'s `GoalSpectrum`) as the visual reference. There is no Radix/shadcn `Slider` primitive installed (`grep -i "radix-ui/react-slider" package.json` → no match) — rather than adding a new dependency, generalize the existing tap-to-select "filled progress" pattern already used for RPE (`components/workout/rpe-strip.tsx`'s `RpeSlider`, which _is_ called a slider in this codebase despite being button-based) to a single theme color per scale.

**Files:**
- Modify: `lib/types/day-checkin.ts` (`EVENING_SCALES`, add a `color` per scale)
- Modify: `components/nutrition/end-of-day/scale-selector.tsx` (rewrite as a colored filled-progress control)
- Modify: `components/nutrition/end-of-day/wellness-section.tsx` (pass the new `color` prop through)

**Steps:**

- [ ] In `lib/types/day-checkin.ts`, add a `color` field to each entry in `EVENING_SCALES` (this is also Task 5's color-theming — do it here since it's the same array):
  ```ts
  // The five evening scales, in display order, with their end labels and a theme colour
  // (matches the metric, e.g. blue for hydration). Drives the WellnessSection UI and the
  // pre-fill helper so they never drift apart.
  export const EVENING_SCALES = [
    { key: 'physicalTiredness', label: 'Physical tiredness', low: 'Fresh',       high: 'Drained',      color: '#f59e0b' },
    { key: 'mentalDrain',       label: 'Mental drain',       low: 'Clear',       high: 'Fried',        color: '#a855f7' },
    { key: 'barelyMoved',       label: 'Movement',           low: 'Very active', high: 'Barely moved', color: '#22c55e' },
    { key: 'hydration',         label: 'Hydration',          low: 'Well hydrated', high: 'Barely drank', color: '#3b82f6' },
    { key: 'lateHeavyMeal',     label: 'Late / heavy meal',  low: 'None / light', high: 'Big & late',   color: '#f97316' },
  ] as const
  ```
  This is purely additive (`EVENING_SCALES` has exactly one consumer, `wellness-section.tsx`, confirmed via `grep -rn "EVENING_SCALES"` before starting) so nothing else needs to change shape.
- [ ] Rewrite `components/nutrition/end-of-day/scale-selector.tsx` to accept an optional `color` prop (default to a neutral gray so any future caller — e.g. the documented-but-not-yet-built morning-scales variant — keeps working without a color) and render the RPE-style filled-progress bar instead of plain toggle buttons:
  ```tsx
  'use client'
  interface Props { label: string; low: string; high: string; value: number; onChange: (v: number) => void; color?: string }
  export function ScaleSelector({ label, low, high, value, onChange, color = '#6b7280' }: Props) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex gap-0.5 rounded-xl overflow-hidden h-11">
          {[1, 2, 3, 4, 5].map(n => {
            const selected = value === n
            const filled = n <= value
            return (
              <button key={n} type="button" onClick={() => onChange(n)} aria-pressed={selected}
                className="flex-1 flex items-center justify-center text-sm font-bold transition-all active:scale-95"
                style={{
                  background: selected ? color : filled ? `${color}44` : `${color}18`,
                  color: selected ? '#000' : filled ? '#ffffffcc' : `${color}88`,
                  boxShadow: selected ? `0 0 8px ${color}88` : 'none',
                }}>
                {n}
              </button>
            )
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground"><span>{low}</span><span>{high}</span></div>
      </div>
    )
  }
  ```
  (Each of the 5 rungs is a "benchmark" — filled solid up to the selected value, dim after — same visual language as `RpeSlider`'s `filled ? color44 : color18` / `selected ? color : ...` treatment, just one hue per scale instead of RPE's rainbow-per-level.)
- [ ] In `components/nutrition/end-of-day/wellness-section.tsx`, pass `color={scale.color}` through to `ScaleSelector`:
  ```tsx
  <ScaleSelector
    key={scale.key}
    label={scale.label}
    low={scale.low}
    high={scale.high}
    value={scales[scale.key]}
    onChange={v => onScale(scale.key, v)}
    color={scale.color}
  />
  ```
- [ ] Run `pnpm exec tsc --noEmit` and `pnpm exec eslint components/nutrition/end-of-day/scale-selector.tsx components/nutrition/end-of-day/wellness-section.tsx lib/types/day-checkin.ts` — expect clean.
- [ ] Verify visually: `pnpm dev`, log in, open `/nutrition`, tap "End of Day review," scroll to the wellness scales. Confirm each of the 5 scales renders as a 5-segment colored bar (amber, purple, green, blue, orange in that order) with the selected rung fully bright/black-text and rungs before it dimmer-filled, rungs after it faint — and that tapping a different number updates the fill and persists on Save (re-open the sheet and confirm the value stuck). **This exact rendering was already confirmed working** in a prior session's Playwright screenshot — if it doesn't match, something regressed versus this plan's snippet.

---

### Task 5: Themed background on the End of Day sheet

The End of Day sheet (`components/nutrition/end-of-day/end-of-day-review.tsx`) currently uses a flat `bg-secondary` on both the sheet container and the sticky footer. The user asked for "some kind of background" — reuse the existing night/evening gradient already defined for the Sleep detail page (`PAGE_GRADIENTS.sleep` in `components/health/detail-hero.tsx`) rather than inventing a new one, since End of Day is thematically an evening/bedtime screen (it already uses a `Moon` icon in its header).

**Files:**
- Modify: `components/nutrition/end-of-day/end-of-day-review.tsx` (~lines 12–14 imports, ~lines 183–197 `SheetContent`, ~line 207 footer)

**Steps:**

- [ ] Import `PAGE_GRADIENTS` alongside the existing imports:
  ```ts
  import { PAGE_GRADIENTS } from '@/components/health/detail-hero'
  ```
- [ ] Replace the `bg-secondary` class on `SheetContent` with an inline gradient background (inline `style` wins over any `bg-*` utility class from the base `Sheet` component, so no `!important` needed):
  ```tsx
  <SheetContent
    side="bottom"
    className="rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[92vh] flex flex-col p-0 border-t border-border/70"
    style={{ background: PAGE_GRADIENTS.sleep }}
    hideCloseButton
  >
  ```
- [ ] Change the sticky footer from a solid `bg-secondary` box to a translucent overlay so it blends with the new gradient instead of reading as a hard-edged panel:
  ```tsx
  <div className="shrink-0 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-border/60 bg-black/30 backdrop-blur-sm">
  ```
- [ ] Do not touch the child section components (`DaySummaryCard`, `MealBackfillSection`, `WellnessSection`, `JournalSection`, `TodayInsightCard`) — they already use translucent `bg-muted/40` surfaces (confirmed via `grep -n "bg-" components/nutrition/end-of-day/*.tsx` before starting), so the new gradient shows through them correctly with no further changes needed.
- [ ] Run `pnpm exec tsc --noEmit` — clean (purely presentational, no prop/type changes).
- [ ] Verify visually: open the End of Day sheet as in Task 4's verification step and confirm a dark indigo/navy gradient is visible behind the cards (darkest at the bottom, lighter near the top near the header), the header/close button remain legible, and the Save button's footer bar reads as a subtle translucent overlay rather than a flat gray box. **This was already confirmed working** in a prior session's Playwright screenshot.

---

**Acceptance (all 5 tasks):**
- Workout timeline cards (Home + full Timeline page) show duration/sets/exercise-count and the start–end time range, never a list of exercise names.
- The Activity detail page's ring shows a visually distinct brand-colored segment for the training-boost portion whenever `activityBlend.adjustment > 0` (verified via API-mocking since the local sandbox has no real Oura+workout day); the ring shows only the base color when there's no boost. The existing text banner is unchanged.
- `GET /api/user/bedtime-estimate` returns both `bedtimeHour` and `bedtimeMinute`; `scheduleEndOfDayReminder` schedules exactly 30 minutes before that time (on-device confirmation still required — Capacitor-only code path).
- All five End of Day wellness scales render as colored 5-rung filled-progress bars (not plain toggle buttons), each in a color matching its metric (blue for hydration, etc.), and selecting/saving still round-trips correctly.
- The End of Day sheet has a visible themed (indigo/navy night) gradient background instead of a flat panel color.
- `pnpm exec tsc --noEmit` and `pnpm lint` are clean (aside from the pre-existing unrelated `lib/push.ts` error).

**Out of scope (don't do these as part of this plan):** a Start-of-Day/morning variant of the wellness scales (documented as a fast-follow in `docs/superpowers/specs/2026-07-01-end-of-day-review-design.md` and Batch F of `docs/planned_upgrades.md` — the `color` prop added here is deliberately optional/defaulted so that future work can adopt it without another refactor); adding a real Radix `Slider` dependency; changing the End of Day reminder's `hasUnloggedRequired` gating logic (only its *timing* was in scope here).
