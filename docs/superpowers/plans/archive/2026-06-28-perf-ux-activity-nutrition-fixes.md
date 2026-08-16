# Performance, UX & Feature Fixes — 2026-06-28

**Session type:** Bug-fix / UX / new feature  
**Target branch:** feature branch (e.g. `fix/perf-ux-batch-june28`), merge to `main` after local testing  
**Estimated complexity:** Medium-high (8 independent areas)

---

## Overview

8 issues raised from screenshots and device usage. Implement in priority order — each area is self-contained and can be shipped independently.

---

## Area 1 — Mood Tracker: Collapsible Optional Sections

**File:** `components/mood-checkin-sheet.tsx`

**Problem:** The daily check-in always shows all three sections in full. Sore Muscles and Issues are optional — most days you have neither. The full layout is overwhelming and buries the mandatory Energy section.

**Design:**
- **Energy Level** — always visible.
- **Sore Muscles** — collapsed by default. Tappable header row with `ChevronDown`/`ChevronUp`. Auto-expands when editing an existing log that has sore muscles recorded.
- **Issues** — same pattern. Auto-expands when editing if issues are recorded.
- The overlapping-muscles amber warning only shows when Sore Muscles is expanded.

### Steps

- [ ] **Step 1:** Add two collapsed-state booleans near the top of the component (after existing `useState` lines):
  ```ts
  const [soreExpanded, setSoreExpanded]     = useState(false)
  const [issuesExpanded, setIssuesExpanded] = useState(false)
  ```

- [ ] **Step 2:** In the `useEffect` that populates from `initialLog`, auto-expand when re-editing:
  ```ts
  setSoreExpanded(initialLog.soreMuscles.length > 0)
  setIssuesExpanded(initialLog.bodyState.filter(s => ISSUE_OPTIONS.some(o => o.value === s)).length > 0)
  ```
  And in the `else` branch (fresh log): `setSoreExpanded(false); setIssuesExpanded(false)`.

- [ ] **Step 3:** Replace the static `<p>` header for the Sore Muscles section with a tappable button row:
  ```tsx
  <button
    type="button"
    onClick={() => setSoreExpanded(v => !v)}
    className="flex items-center justify-between w-full"
  >
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      Sore Muscles
    </p>
    {soreExpanded
      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
  </button>
  ```
  Add `ChevronDown, ChevronUp` to the lucide-react import.

- [ ] **Step 4:** Wrap the muscle group buttons `<div className="space-y-3">` and the overlap warning in `{soreExpanded && (...)}`.

- [ ] **Step 5:** Do the same for the Issues section — replace the static `<p>` header with a tappable button using `issuesExpanded` / `setIssuesExpanded`, and wrap the buttons chip row in `{issuesExpanded && (...)}`.

- [ ] **Step 6:** Run `pnpm exec tsc --noEmit` — no errors expected.

- [ ] **Step 7:** Start dev server and open the check-in sheet. Verify:
  - Energy visible immediately, Sore Muscles and Issues headers show collapsed chevron.
  - Tapping each header expands/collapses correctly.
  - Selecting a sore muscle when expanded, then collapsing, preserves the selection (state persists).
  - Saving still works correctly.

---

## Area 2 — Home Screen Widget Loading Performance

**Problem:** Home screen widgets show loading skeletons for multiple seconds on first open and after navigations.

**Root causes:**
1. `invalidateCache('')` on every pull-to-sync wipes all caches — next navigation starts cold.
2. Some home-screen `cachedFetch` calls may have short TTLs (5 min) that expire between navigations.
3. Possible sequential fetches where parallel would be faster.

**Files:**
- `components/pull-to-sync.tsx`
- `components/session-select-content.tsx` (home screen root)
- `components/readiness-card.tsx`
- `lib/sqlite/cache.ts` (default TTL constants)

### Steps

- [ ] **Step 1:** Open `components/pull-to-sync.tsx` and find the `invalidateCache('')` call. Change the strategy: instead of a full wildcard wipe, invalidate only the known groups by calling `invalidateWorkoutSummaries()`, `invalidateReadinessInputs()`, and `invalidateProgramStructure()` from `lib/cache-groups.ts`. This preserves caches that weren't affected by the sync (e.g. exercise library, nutrition targets).

- [ ] **Step 2:** In `lib/sqlite/cache.ts` (or wherever TTL constants are defined), find the TTL used for `readiness-score`, `weekly-stats`, `streak-data`. Increase these to at least `TTL_LONG` (30 min) if they're currently on `TTL_MEDIUM` (10 min) or shorter. These values don't change between syncs.

- [ ] **Step 3:** In `components/session-select-content.tsx`, audit all `useEffect` data fetches. Confirm they are all inside a single `Promise.all(...)` — no `await fetch(...)` inside a loop or sequential `await fetch` chains. If any are sequential, parallelise them.

- [ ] **Step 4:** Confirm the `localStorage` seed path still works for the readiness card and recommended-session card (introduced in v1.57.0). Open browser DevTools → Application → Local Storage and confirm keys like `readiness-score` persist after navigation.

- [ ] **Step 5:** Run `pnpm dev` and navigate home → Health → home → Health several times. Confirm skeletons no longer appear after the first load. The second visit should be instant from cache.

---

## Area 3 — Health > Body Tab: Muscle SVG Caching

**Problem:** The muscle recovery heatmap SVG re-fetches and repaints on every visit to the Body tab, causing a slow load and visible colour-pop as muscle colours load in.

**Files:**
- Muscle heatmap component (likely `components/health/muscle-heatmap.tsx` or `components/health/muscle-status-card.tsx`)
- `app/api/muscle-recovery/route.ts`
- `lib/cache-groups.ts`

### Steps

- [ ] **Step 1:** Find where `muscle-recovery` is fetched in the Body tab. Change the fetch call from plain `fetch('/api/muscle-recovery')` to `cachedFetch('muscle-recovery', '/api/muscle-recovery', TTL_LONG)` (30 min TTL). Seed from cache synchronously before first paint if cached data exists, and background-refresh after.

- [ ] **Step 2:** In `lib/cache-groups.ts`, add `invalidateCache('muscle-recovery')` to `invalidateReadinessInputs()`. Currently it is only in `invalidateWorkoutSummaries()`, but a mood check-in with sore muscles should also refresh the muscle status.

- [ ] **Step 3:** Find the SVG rendering component (the front/back body figure). Wrap it in `React.memo()`:
  ```ts
  export const MuscleHeatmap = React.memo(function MuscleHeatmap({ colorMap }: Props) { ... })
  ```
  This prevents SVG re-renders when the parent re-renders but the muscle colour data hasn't changed.

- [ ] **Step 4:** Add a `useRef` to hold the last-fetched muscle data in the Body tab parent. On mount, immediately render from the ref (no skeleton) then trigger background refresh. Pattern:
  ```ts
  const cachedData = readCacheSync('muscle-recovery')
  const [data, setData] = useState(cachedData ?? null)
  useEffect(() => { /* refresh in background */ }, [])
  ```

- [ ] **Step 5:** Run `pnpm dev` → Health > Body. Navigate away and back. Confirm the muscle map renders immediately on the second visit with no skeleton flash. After logging a workout or mood check-in, confirm colours update within one navigation.

---

## Area 4 — Health > Training Tab: Widget Load Speed (Caching)

**Problem:** AI Periodization card and Weekly Muscle Volume bars show loading skeletons on every Training tab visit. Both make fresh API calls with no client-side cache.

**Files:**
- `components/health/ai-periodization-status-card.tsx`
- `components/health/ai-weekly-volume-card.tsx`
- `lib/cache-groups.ts`

### Steps

- [ ] **Step 1:** In `ai-periodization-status-card.tsx`, replace the bare `fetch('/api/ai-periodization/program-overview')` call with:
  ```ts
  import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
  
  // Seed from cache immediately (no skeleton on second visit)
  const [sessions, setSessions] = useState<SessionOverview[] | null>(
    () => readCacheSync<{ sessions: SessionOverview[] }>('ai-periodization-overview')?.sessions ?? null
  )
  
  useEffect(() => {
    cachedFetch('ai-periodization-overview', '/api/ai-periodization/program-overview', 15 * 60)
      .then(d => { if (d?.sessions) setSessions(d.sessions) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  ```
  Set `loading` initial value to `sessions === null` (i.e. only show skeleton if no cached data).

- [ ] **Step 2:** In `ai-weekly-volume-card.tsx`, do the same: replace bare `fetch` with `cachedFetch('ai-weekly-volume', '/api/ai-periodization/weekly-volume', 15 * 60)` and seed from `readCacheSync` in initial state.

- [ ] **Step 3:** In `lib/cache-groups.ts`, add these two keys to `invalidateWorkoutSummaries()`:
  ```ts
  invalidateCache('ai-periodization-overview'),
  invalidateCache('ai-weekly-volume'),
  ```
  This ensures the Training tab shows fresh data after a workout is completed.

- [ ] **Step 4:** Run `pnpm exec tsc --noEmit` — no errors.

- [ ] **Step 5:** Start dev server → Health > Training. Navigate away and back. Confirm the AI Periodization card and volume bars render instantly on the second visit with no skeleton. After completing a workout session (or simulating via API), confirm the data updates.

---

## Area 5 — AI Periodization: "Baseline Needed" Not Clearing

**Problem:** Sessions with completed AMRAP baseline tests still show "Baseline needed" in the AI Periodization card (seen for Push, Legs, Upper, Lower while Pull correctly shows accumulation phase).

**Investigation first:**

- [ ] **Step 1 (investigate):** Query the local DB to check the state of `session_periodization` rows:
  ```bash
  PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev \
    -c "SELECT ps.name, sp.phase, sp.baseline_complete, sp.sessions_in_phase FROM session_periodization sp JOIN program_sessions ps ON ps.id = sp.program_session_id ORDER BY ps.name;"
  ```
  Identify whether rows exist for the affected sessions and what `baseline_complete` value they have.

- [ ] **Step 2 (investigate):** Trace `POST /api/ai-periodization/baseline/complete` — check if it's being called after AMRAP workouts complete. Add a `console.log` at the top of `app/api/ai-periodization/baseline/complete/route.ts` temporarily and run a baseline workout to confirm the route fires.

**Fix — Part A: Accept existing 1RM as baseline source**

- [ ] **Step 3:** In `app/api/ai-periodization/baseline/complete/route.ts`, update `BodySchema` to allow `amrapResults` to be empty when `useExisting: true` is passed:
  ```ts
  const BodySchema = z.object({
    sessionId: z.string().uuid(),
    useExisting: z.boolean().optional(),
    amrapResults: z.array(z.object({
      sessionExerciseId: z.string().uuid(),
      exerciseName: z.string(),
      weightKg: z.number().positive(),
      reps: z.number().int().min(1),
    })),
  })
  ```
  In the handler, if `useExisting === true`, skip the `amrapResults.length === 0` guard and fetch `personal_records` for this session's exercises to build the `baseline1rm` map using `source: 'existing'`.

**Fix — Part B: Surface "Use prior data" button in UI**

- [ ] **Step 4:** In `components/health/ai-periodization-status-card.tsx`, for sessions where `state !== null && phase === 'baseline' && !baselineComplete`, add a small `"Use prior data →"` tappable label below "Baseline needed". Tapping calls `POST /api/ai-periodization/baseline/complete` with `{ sessionId, useExisting: true, amrapResults: [] }` and refreshes the card.

- [ ] **Step 5:** Test: tap "Use prior data" for a stuck session → card updates to show "Accum. · 0 sessions".

---

## Area 6 — Activity Tracking: Walk Detection Quality Filters

**File:** `app/api/oura/workouts/route.ts`

**Problem:** Oura is surfacing non-walks as "Walk Detected" review cards: sessions as short as 0.01 km over 260 minutes (walking around home), or 0.39 km over 145 minutes. These aren't outdoor walks — they're all-day low-level movement that Oura tags as walking.

**Observed bad sessions from screenshots:**

| Duration | Distance | Avg speed | Verdict |
|----------|----------|-----------|---------|
| 260 min | 0.01 km | 0.002 km/h | home pottering — REJECT |
| 145 min | 0.39 km | 0.16 km/h | barely moving — REJECT |
| 87 min | 0.75 km | 0.52 km/h | slow but borderline — REJECT |
| 211 min | 2.07 km | 0.59 km/h | extended home wander — REJECT |

### Steps

- [ ] **Step 1:** At the top of `app/api/oura/workouts/route.ts`, add the new filter constants alongside `MIN_DURATION_MS`:
  ```ts
  const MIN_DISTANCE_M   = 500    // genuine walk leaves the property
  const MIN_AVG_SPEED_KMH = 1.5  // absolute minimum walking pace (4–6 km/h is normal)
  const MAX_DURATION_SEC = 3 * 3600  // cap at 3 hours — longer = all-day noise
  ```

- [ ] **Step 2:** In the `GET` handler, after the existing `.filter(w => ...)` chain, add three more filters. You'll need to calculate avg speed from `w.distanceMeters` and `w.durationSeconds` (confirm these field names match the `OuraWorkout` type in the DB / `lib/oura/types.ts`):
  ```ts
  .filter(w => (w.distanceMeters ?? 0) >= MIN_DISTANCE_M)
  .filter(w => {
    const durationSec = (new Date(w.endDatetime).getTime() - new Date(w.startDatetime).getTime()) / 1000
    const avgSpeedKmh = ((w.distanceMeters ?? 0) / 1000) / (durationSec / 3600)
    return avgSpeedKmh >= MIN_AVG_SPEED_KMH
  })
  .filter(w => {
    const durationSec = (new Date(w.endDatetime).getTime() - new Date(w.startDatetime).getTime()) / 1000
    return durationSec <= MAX_DURATION_SEC
  })
  ```
  Consolidate the two `durationSec` calculations into one to avoid redundancy.

- [ ] **Step 3:** Confirm `OuraWorkout` type has `distanceMeters` (check `lib/oura/types.ts` and `lib/data/postgres/schema.ts` for `oura_workouts` table). If the field is named differently (e.g. `distance_meters`), adjust accordingly.

- [ ] **Step 4:** Run `pnpm exec tsc --noEmit` — no errors.

- [ ] **Step 5:** Start dev server and open Health > Training. The "Walk Detected" card should no longer show any of the bad sessions. If the DB still has unreviewed Oura workouts from before this fix, dismiss them via "Dismiss all".

- [ ] **Step 6:** Verify a good walk is still accepted: a simulated session with `distanceMeters: 3000`, `durationSec: 2400` (3 km, 40 min, 4.5 km/h) should pass all filters.

---

## Area 7 — Workout Tab: Completed Session Visual Indicator

**Problem:** Completed sessions on the Workout tab look almost identical to incomplete sessions — only a small `✓ Trained today` subtitle distinguishes them. The user wants a strong visual "done" state.

**Files to confirm:** The session swiper cards are rendered in the Workout tab's page component (likely `app/workout/page.tsx` or `components/workout-screen.tsx` pre-workout view). Locate the card that shows `✓ Trained today` and update it.

### Steps

- [ ] **Step 1:** Find the component rendering the Workout tab session cards. Search for `"Trained today"` string in the codebase to locate the exact file and line.

- [ ] **Step 2:** On the session card container element, add a conditional class when the session is marked as trained today:
  ```tsx
  className={cn(
    "relative rounded-2xl overflow-hidden ...",
    isTrainedToday && "ring-1 ring-green-500/40"
  )}
  ```

- [ ] **Step 3:** Replace the plain `✓ Trained today` subtitle text with a coloured pill badge:
  ```tsx
  {isTrainedToday && (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-green-500/20 text-green-400">
      <CheckCircle2 className="h-3 w-3" />
      Trained today
    </span>
  )}
  ```
  Add `CheckCircle2` to the lucide-react import.

- [ ] **Step 4:** Add a subtle green tint overlay to the card background when trained:
  ```tsx
  {isTrainedToday && (
    <div className="absolute inset-0 bg-green-500/5 pointer-events-none rounded-2xl" />
  )}
  ```

- [ ] **Step 5:** On the "Start Again" button (shown when trained today), add a green border tint:
  ```tsx
  className={cn("...", isTrainedToday && "border-green-500/40")}
  ```

- [ ] **Step 6:** Run `pnpm dev` and navigate to the Workout tab after logging a workout (or simulate by setting `todayLogged` in state). Confirm the completed card looks clearly distinct. Check that other (non-completed) session cards are visually unchanged.

---

## Area 8 — Nutrition: End-of-Day Notification + AI Backfill (New Feature)

**Problem / Request:** At bedtime, if mandatory meal types haven't been logged, the user should receive a notification that (a) gives a daily nutrition summary and (b) lets them backfill via AI chat.

**Architecture overview:**
- `meal_types` gains a `required` boolean (in addition to the existing `reminders_enabled`)
- Bedtime is estimated from Oura sleep history (avg `sleep_start` over last 14 days), defaulting to 22:30
- A single notification (ID `9100`) fires ~30 min before estimated bedtime if any `required` meal type is unlogged
- Notification body includes calorie summary + list of missed meals
- Tap opens `/nutrition?chat=backfill` — Nutrition tab auto-opens AI chat pre-filled

### Steps

**8a — DB migration**

- [ ] **Step 1:** Create migration `lib/data/postgres/migrations/NNN_meal_types_required.sql`:
  ```sql
  ALTER TABLE meal_types ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT true;
  ```
  Use the next available migration number (check the highest existing number in the migrations folder).

- [ ] **Step 2:** Add `required: boolean('required').notNull().default(true)` to the `mealTypes` table in `lib/data/postgres/schema.ts`.

- [ ] **Step 3:** Add `required: r.required` to `rowToMealType()` in `lib/data/postgres/adapter.ts` and add `required: boolean` to the `MealType` interface in `lib/types/nutrition.ts`.

- [ ] **Step 4:** Run `pnpm db:local` to apply the migration. Verify:
  ```bash
  PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev \
    -c "SELECT column_name FROM information_schema.columns WHERE table_name='meal_types';"
  ```

**8b — Bedtime estimate API**

- [ ] **Step 5:** Create `app/api/user/bedtime-estimate/route.ts`:
  ```ts
  // Returns estimated bedtime hour (0–23) from avg sleep_start over last 14 days.
  // Falls back to 22 (10pm) if no sleep data.
  export async function GET() {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const repo = await getRepository()
    const tz = session.user?.timezone ?? DEFAULT_TZ
    const since = formatInTimeZone(subDays(new Date(), 14), tz, 'yyyy-MM-dd')
    const sleepRows = await repo.getSleepSessions(session.user.id, since, todayInTz(tz))
    const DEFAULT_BEDTIME_HOUR = 22
    if (!sleepRows.length) return NextResponse.json({ hour: DEFAULT_BEDTIME_HOUR })
    const avgMinutes = sleepRows
      .map(s => { const d = new Date(s.sleepStart); return d.getHours() * 60 + d.getMinutes() })
      .reduce((a, b) => a + b, 0) / sleepRows.length
    return NextResponse.json({ hour: Math.round(avgMinutes / 60) % 24 })
  }
  ```

**8c — End-of-day reminder logic**

- [ ] **Step 6:** In `lib/meal-reminders.ts`, add a new exported function `scheduleEndOfDayReminder`:
  ```ts
  const EOD_NOTIFICATION_ID = 9100
  
  export async function scheduleEndOfDayReminder(
    bedtimeHour: number,        // 0–23, estimated bedtime
    mealTypes: MealType[],
    foodLogs: Pick<FoodLog, 'mealTypeId'>[],
    caloriesConsumed: number,
    caloriesTarget: number,
    now: Date = new Date(),
  ): Promise<void> {
    if (!Capacitor.isNativePlatform()) return
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const loggedIds = new Set(foodLogs.map(l => l.mealTypeId))
      const missedRequired = mealTypes.filter(mt => mt.required && !loggedIds.has(mt.id))
  
      // Cancel if everything logged
      if (missedRequired.length === 0) {
        await LocalNotifications.cancel({ notifications: [{ id: EOD_NOTIFICATION_ID }] })
        return
      }
  
      // Fire 30 min before bedtime
      const fireAt = new Date(now)
      fireAt.setHours(bedtimeHour === 0 ? 23 : bedtimeHour - 1, bedtimeHour === 0 ? 30 : 30, 0, 0)
      if (fireAt <= now) return // window already passed today
  
      const missedNames = missedRequired.map(mt => `${mt.emoji} ${mt.name}`).join(', ')
      await LocalNotifications.schedule({
        notifications: [{
          id: EOD_NOTIFICATION_ID,
          title: `Daily summary · ${caloriesConsumed}/${caloriesTarget} kcal`,
          body: `Missed: ${missedNames}. Tap to backfill with AI.`,
          schedule: { at: fireAt },
          channelId: MEAL_REMINDERS_CHANNEL,
          extra: { action: 'backfill' },
        }],
      })
    } catch {}
  }
  ```

**8d — Wire into SyncProvider**

- [ ] **Step 7:** In `components/sync-provider.tsx`, in the existing meal reminder `reconcile()` function, extend it to also call `scheduleEndOfDayReminder`:
  ```ts
  const [bedtime, nutritionDay] = await Promise.all([
    fetch('/api/user/bedtime-estimate').then(r => r.json()),
    fetch(`/api/nutrition/day-log?date=${todayInTz()}`).then(r => r.json()),
  ])
  await scheduleEndOfDayReminder(
    bedtime.hour ?? 22,
    Array.isArray(mealTypes) ? mealTypes : [],
    Array.isArray(foodLogs) ? foodLogs : [],
    nutritionDay?.calories ?? 0,
    1950, // TODO: fetch from user's nutrition targets
  )
  ```
  Import `scheduleEndOfDayReminder` from `@/lib/meal-reminders`.

**8e — Backfill deep-link handler**

- [ ] **Step 8:** In the Nutrition tab root component (`app/nutrition/nutrition-content.tsx` or equivalent), add a `useEffect` that reads the `?chat=backfill` query param on mount. If present, auto-open the AI chat sheet and pre-fill with the backfill prompt:
  ```ts
  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get('chat') === 'backfill') {
      setAiChatOpen(true)
      setAiChatPrefill('I missed logging some meals today. Help me estimate and backfill what I ate.')
    }
  }, [])
  ```
  Pass `prefill` prop to the AI chat sheet component to auto-populate the input.

**8f — Meal type manager: Required toggle**

- [ ] **Step 9:** In `components/nutrition/meal-type-manager.tsx`, add `required` to `editForm` and `newForm` state (default `true`). In the edit form, add a toggle row beneath the `remindersEnabled` switch:
  ```tsx
  <div className="flex items-center justify-between text-xs">
    <span className="text-muted-foreground">Required (end-of-day reminder)</span>
    <Switch
      checked={editForm.required}
      onCheckedChange={val => setEditForm(f => ({ ...f, required: val }))}
    />
  </div>
  ```

- [ ] **Step 10:** Run `pnpm exec tsc --noEmit && pnpm lint` — no errors.

- [ ] **Step 11 (web verification):** Start `pnpm dev`. Open Nutrition Settings → Meal Types. Confirm the `Required` toggle appears on each meal type editor. Save a change and confirm it persists (reload). Navigate to `/nutrition?chat=backfill` — confirm the AI chat opens with the pre-filled message. Check console — no errors on web (all notification calls should be no-ops on web).

---

---

## Area 9 — Home Screen: Oura-style Score Icon Chip Row

**Context from screenshots:** Oura app shows a horizontal row of 4 tappable score chips at the top of its home screen — Readiness, Heart Rate, Sleep, Activity. Each chip is a small pill with an icon, a score or value, and a colour that reflects the score band. Tapping navigates to a dedicated full-screen detail page. We want the same on our home screen.

**Current state:** The home screen already has a `ReadinessCard` (a larger card with score arc + contributor bars) in `components/readiness-card.tsx`, rendered at line 1161 of `app/session-select/session-select-content.tsx`. The `readiness` state object already contains `ouraScore`, `sleepScore`, `activityScore`, `hrCurrent`, `hrMin`, `hrAvg`, `hrMax` — all the data needed. No new API calls are required.

**Design:**
- 4 chips in a horizontal scrollable row: **Readiness** (ouraScore), **Heart Rate** (hrCurrent bpm), **Sleep** (sleepScore), **Activity** (activityScore)
- Each chip: small pill `~60px wide × 40px tall`, icon + score number, background tinted by score band (≥70 green, 50-69 amber, <50 red)
- Row sits above or replaces the existing `ReadinessCard` — see Area 11 for de-duplication discussion
- Tapping any chip calls `router.push('/health/readiness')`, `/health/sleep`, `/health/heart-rate`, `/health/activity` respectively

### Steps

- [ ] **Step 1:** Create `components/oura-score-chip-row.tsx`. Accept `readiness: ReadinessScoreResponse | null` as a prop. Render a `<div className="flex gap-2 px-4 overflow-x-auto scrollbar-none">` containing 4 chips. Expose from the component: `OuraScoreChipRow`.

  Each chip structure:
  ```tsx
  <button
    onClick={() => router.push(href)}
    className={cn(
      "flex flex-col items-center gap-0.5 rounded-2xl px-3 py-2 min-w-[68px] flex-none",
      "border border-white/5 backdrop-blur-sm",
      bandBg(score),
    )}
  >
    <Icon className="h-3.5 w-3.5" style={{ color: bandColor(score) }} />
    <span className="text-base font-bold tabular-nums leading-none" style={{ color: bandColor(score) }}>
      {score ?? '—'}
    </span>
    <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
  </button>
  ```

  Band helper:
  ```ts
  function bandColor(score: number | null): string {
    if (score == null) return 'hsl(var(--muted-foreground))'
    if (score >= 70) return '#22c55e'
    if (score >= 50) return '#f59e0b'
    return '#ef4444'
  }
  function bandBg(score: number | null): string {
    if (score == null) return 'bg-muted/30'
    if (score >= 70) return 'bg-green-500/10'
    if (score >= 50) return 'bg-amber-500/10'
    return 'bg-red-500/10'
  }
  ```

  The 4 chip definitions:
  ```ts
  const chips = [
    { label: 'Readiness', score: readiness?.ouraScore ?? null, icon: ZapIcon,    href: '/health/readiness'   },
    { label: 'Heart Rate', score: readiness?.hrCurrent ?? null, icon: HeartIcon, href: '/health/heart-rate'  },
    { label: 'Sleep',      score: readiness?.sleepScore ?? null, icon: MoonIcon, href: '/health/sleep'       },
    { label: 'Activity',   score: readiness?.activityScore ?? null, icon: ActivityIcon, href: '/health/activity' },
  ]
  ```
  Use `ActivityIcon` from lucide-react (or `ZapIcon` if not available).

- [ ] **Step 2:** In `app/session-select/session-select-content.tsx`, import `OuraScoreChipRow`. Place the chip row **above** the existing `ReadinessCard` block (before line ~1158):
  ```tsx
  {readiness && (
    <div className="mb-2">
      <OuraScoreChipRow readiness={readiness} />
    </div>
  )}
  ```
  The chip row and `ReadinessCard` coexist for now — de-duplication is Area 11.

- [ ] **Step 3:** Run `pnpm exec tsc --noEmit` — no errors.

- [ ] **Step 4:** Start dev server. Open home screen. Confirm 4 chips appear when Oura data is available, chips show correct colours per band. When `readiness` is null (no data), confirm no chips render (component returns null). Tap each chip — confirm navigation fires (pages 404 for now — detail pages come in Area 10).

---

## Area 10 — Detail Pages: Readiness, Sleep, Heart Rate & Stress, Activity

**Context:** Each chip from Area 9 navigates to a full-screen detail page. These replicate the depth of Oura's built-in screens: a large score arc, labelled contributor bars for each category, relevant charts, and an AI insight section (Area 13). Data is already in `/api/readiness-score` for readiness/sleep/activity contributors and HR ranges. Sleep staging detail comes from `/api/sleep-sessions`.

**Routes to create:**
- `app/health/readiness/page.tsx` → Readiness detail
- `app/health/sleep/page.tsx` → Sleep detail
- `app/health/heart-rate/page.tsx` → Heart Rate & Stress detail
- `app/health/activity/page.tsx` → Activity detail

**Note:** Check whether any of these route segments conflict with the existing `app/health/page.tsx` and `app/health/health-content.tsx`. The existing health page is a tab-based view (`/health`), so sub-routes `/health/readiness` etc. are new and won't conflict.

### Shared Layout Pattern

Each detail page follows this structure:
1. Full-screen `<div className="min-h-screen bg-background">` with a sticky top bar (`← Back` button + page title)
2. Score arc (large, 80–100px) at the top with colour-coded ring, score number, and label ("Optimal" / "Good" / "Pay Attention")
3. Contributing factors section: a vertical list of labelled progress bars (0–100), grouped by category
4. A chart section (varies by page)
5. An AI insight card at the bottom (lazy-loaded, cached — implemented in Area 13)

Reuse `ScoreArc` from `components/readiness-card.tsx` — extract it into a shared `components/ui/score-arc.tsx` so all detail pages can import it.

### Steps — Shared Infrastructure

- [ ] **Step 1:** Extract `ScoreArc` from `components/readiness-card.tsx` into a standalone `components/ui/score-arc.tsx`. Export it. Update `components/readiness-card.tsx` to import from the new location. No functional change.

- [ ] **Step 2:** Create `components/health/contributor-bars.tsx` — a reusable component that accepts `{ title: string, contributors: Record<string, number | null>, labelMap?: Record<string, string> }` and renders a labelled vertical list of progress bars. Style each bar with a colour that matches the score (green/amber/red). This replaces the existing inline `ContributorBars` inside `readiness-card.tsx` — update that file to import this new component.

- [ ] **Step 3:** Create a shared back-button header component `components/health/detail-page-header.tsx`:
  ```tsx
  export function DetailPageHeader({ title }: { title: string }) {
    const router = useRouter()
    return (
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/20 px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="h-8 w-8 rounded-full flex items-center justify-center bg-muted/40">
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <h1 className="text-sm font-semibold">{title}</h1>
      </div>
    )
  }
  ```

### Steps — Readiness Detail Page (`/health/readiness`)

- [ ] **Step 4:** Create `app/health/readiness/page.tsx` as a client component. Fetch `/api/readiness-score` on mount using `cachedFetch('readiness-score', '/api/readiness-score', TTL_MEDIUM)`. Seed from `readCacheSync` for instant render.

  Layout sections:
  - **Header:** "Readiness" title + back button
  - **Score hero:** Large `ScoreArc` (size 100) + label + `daySummary` text if available
  - **Temperature:** if `temperatureDeviation != null`, show deviation chip and trend text
  - **Readiness contributors:** `readinessContributors` passed to `ContributorBars`; use human-readable label map: `{ activity_balance: 'Activity Balance', hrv_balance: 'HRV Balance', previous_day_activity: 'Previous Activity', resting_heart_rate: 'Resting HR', recovery_index: 'Recovery Index', sleep_balance: 'Sleep Balance', body_temperature: 'Body Temperature', previous_night: 'Previous Night' }`
  - **AI Insight card:** (placeholder for Area 13 — render a "Generate analysis" button stub)
  - **Stress indicators:** if `stressHigh > 0 || recoveryHigh > 0`, show a small stress vs. recovery chip pair

- [ ] **Step 5:** Wire up navigation: confirm tapping the Readiness chip from Area 9 loads this page, back button returns to home.

### Steps — Sleep Detail Page (`/health/sleep`)

- [ ] **Step 6:** Create `app/health/sleep/page.tsx`. Fetch both `/api/readiness-score` and `/api/sleep-sessions` in parallel on mount.

  Layout sections:
  - **Header:** "Sleep" title + back button
  - **Score hero:** Large `ScoreArc` from `sleepScore` + bedtime recommendation if `recommendedBedtimeStart/End` are non-null
  - **Last night summary:** Duration, deep %, REM %, efficiency, onset latency — from the most recent sleep session (sessions[0])
  - **Sleep contributors:** `sleepContributors` passed to `ContributorBars`; label map: `{ deep_sleep: 'Deep Sleep', efficiency: 'Efficiency', latency: 'Latency', rem_sleep: 'REM Sleep', restfulness: 'Restfulness', timing: 'Timing', total_sleep: 'Total Sleep' }`
  - **Staging bar:** If `sleepPhase5Min` is available on the latest session, render a simple horizontal stacked bar showing deep/light/REM/awake segments across the night
  - **7-day sleep duration chart:** A simple bar chart using `react-chartjs-2` showing the last 7 days of `durationHours` from the sleep-sessions response
  - **AI Insight card:** Area 13 stub

- [ ] **Step 7:** The sleep detail page effectively replaces the sleep-related content in Health > Body tab. See Area 11 for de-duplication.

### Steps — Heart Rate & Stress Detail Page (`/health/heart-rate`)

- [ ] **Step 8:** Create `app/health/heart-rate/page.tsx`. Fetch `/api/readiness-score` on mount for `hrCurrent`, `hrMin`, `hrAvg`, `hrMax`, `stressHigh`, `recoveryHigh`, `vascularAge`, `vo2Max`.

  Layout sections:
  - **Header:** "Heart Rate & Stress" title + back button
  - **Current HR hero:** Large number + BPM label + trend vs. last night's minimum
  - **HR range:** Min/Avg/Max chips row (reuse `MetricChip` from readiness-card or inline)
  - **HR day chart:** Render `HrDayChart` component (already exists in `components/health/hr-day-chart.tsx`) — this is already imported in `session-select-content.tsx` so it's a known stable component
  - **Stress vs. Recovery:** If `stressHigh/recoveryHigh` available, show minutes-in-stress vs. minutes-in-recovery as a stacked bar
  - **VO₂ Max + Vascular Age:** If non-null, show as metric tiles
  - **AI Insight card:** Area 13 stub

### Steps — Activity Detail Page (`/health/activity`)

- [ ] **Step 9:** Create `app/health/activity/page.tsx`. Fetch `/api/readiness-score` for `activityScore` and `activityContributors`. Also fetch `/api/body-metadata` for steps and active calories.

  Layout sections:
  - **Header:** "Activity" title + back button
  - **Score hero:** Large `ScoreArc` from `activityScore`
  - **Today's stats:** Steps, active calories, distance — from body-metadata
  - **Activity contributors:** `activityContributors` passed to `ContributorBars`; label map: `{ meet_daily_targets: 'Daily Targets', move_every_hour: 'Move Every Hour', recovery_time: 'Recovery Time', stay_active: 'Stay Active', training_frequency: 'Training Frequency', training_volume: 'Training Volume' }`
  - **AI Insight card:** Area 13 stub

- [ ] **Step 10:** Run `pnpm exec tsc --noEmit` on all new files — no errors.

- [ ] **Step 11:** Start dev server. Navigate to each detail page via the home screen chips. Verify:
  - Each page renders without console errors
  - Score arc shows the correct colour/value
  - Contributor bars are labelled and proportioned correctly
  - Back button returns to home
  - Pages render fast on second visit (cached data)

---

## Area 11 — De-duplication: Health Tab Consolidation

**Problem:** With 4 new detail pages (Area 10), several existing screens now show duplicate data:
- Home `ReadinessCard` shows the same contributors as the new Readiness detail page
- Health > Body tab has sleep staging and HRV chart — same data as the new Sleep detail page
- Health tab's existing sections may feel redundant once chip-row + detail pages exist

**Guiding principle:** Don't delete working screens in the same commit as adding new ones — too much blast radius. Instead, phase it: (a) add detail pages and chip row, (b) in the same PR or a follow-up, trim the overlap.

### Steps

- [ ] **Step 1 (audit):** Open each affected page and list every widget/card present:
  - Home: ReadinessCard, HrDayChart widget (if enabled), sleepWidget
  - Health > Body: weight sparkline, body fat, sleep chart, HRV chart, muscle recovery
  - Health > Training: AI periodization card, weekly volume bars

- [ ] **Step 2 (ReadinessCard — simplify, don't remove):** The `ReadinessCard` on the home screen will now sit below the new chip row. Consider simplifying it: collapse contributor bars by default (show just the `ChevronDownIcon` row), or reduce its height. Do NOT remove it entirely — it gives an at-a-glance readiness summary. The chip row above it gives the navigation entry point to the full detail.

  Optionally: make the `ReadinessCard` itself tappable to navigate to `/health/readiness`, with a subtle `→` chevron at the trailing edge.

- [ ] **Step 3 (Health > Body — reroute sleep/HRV content):** In Health > Body tab (`app/health/health-content.tsx` or the Body sub-tab component), replace the inline sleep staging chart and HRV chart with a small "Sleep detail →" and "Heart Rate →" navigation link card. These link to the new detail pages rather than rendering the full chart in the Body tab.

  This keeps Health > Body focused on body composition (weight, body fat, muscle map) and clears space for the new dedicated pages to own biometric depth.

- [ ] **Step 4 (Health > Training — no change needed):** The Training tab (AI periodization, volume, walk detection) has no overlap with the new detail pages. Leave it as-is.

- [ ] **Step 5:** After changes, run through all tabs end-to-end. Confirm no broken links, no orphaned data (all data is accessible somewhere — either inline or via a link to a detail page).

---

## Area 12 — Timeline Feature: Chronological Day View

**Context from screenshots:** Oura shows a "Today" timeline — a scrollable vertical list of the day's events in chronological order: wakeup, meals, workouts, walks, bedtime target. We want the same using our own data: sleep wakeup, food logs, workout sessions, walk activities.

**Architecture approach:** Add a new route `/health/timeline` (or `/timeline`) containing a `TimelineContent` client component. A single new API route `GET /api/day-timeline` aggregates all events for today into one sorted response, so the UI only makes one network call.

### Data Sources for Timeline Events

| Event type | Source | Fields needed |
|---|---|---|
| Wakeup | `sleep_sessions` (latest session, `sleep_end`) | `sleepEnd`, `durationHours` |
| Meals | `food_logs` joined with `meal_types` | `mealTypeName`, `calories`, `loggedAt` |
| Workout | `workout_sessions` | `sessionName`, `startedAt`, `completedAt` |
| Walk | `oura_workouts` (reviewed/unreviewed, today) | `activity`, `startDatetime`, `endDatetime`, `distanceMeters` |
| Bedtime target | `/api/readiness-score` → `recommendedBedtimeStart/End` | hour/minute |

### Steps

**12a — API route**

- [ ] **Step 1:** Create `app/api/day-timeline/route.ts`. Accept optional `?date=YYYY-MM-DD` param (defaults to `todayInTz(tz)`).

  The route fetches in parallel:
  ```ts
  const [sleepRows, foodLogs, workouts, ouraWalks] = await Promise.all([
    repo.listSleepSessions(userId, date, date),
    repo.getFoodLogsByDate(userId, date),
    repo.getWorkoutSessionsByDate(userId, date),
    repo.getOuraWorkoutsByDate(userId, date),
  ])
  ```
  You may need to add `getWorkoutSessionsByDate` and `getOuraWorkoutsByDate(userId, date)` to the repository if they don't exist (check `lib/data/repository.ts`). If not, check what filtering is available.

- [ ] **Step 2:** Build a `TimelineEvent[]` array from the fetched data:
  ```ts
  type TimelineEvent = {
    id: string
    type: 'wakeup' | 'meal' | 'workout' | 'walk' | 'bedtime'
    time: string          // ISO timestamp — used for sorting
    title: string
    subtitle?: string
    durationMin?: number
    caloriesDelta?: number  // positive for meals, negative for activity (optional display)
  }
  ```
  Sort by `time` ascending. Return `{ events: TimelineEvent[], date: string }`.

- [ ] **Step 3:** For the wakeup event: take the most recent sleep session where `date === today` and `sleepEnd` is not null. Create one `'wakeup'` event with `time = sleepEnd`, `title = 'Woke Up'`, `subtitle = '${durationHours}h sleep'`.

- [ ] **Step 4:** For meals: each `food_log` row with `logged_at` on today becomes a `'meal'` event grouped by meal type. Or one event per meal type (not per food item). Summarise: `title = mealType.name`, `subtitle = '${totalCaloriesForMealType} kcal'`.

- [ ] **Step 5:** For workouts: each completed `workout_session` on today becomes a `'workout'` event: `title = session.name`, `subtitle = '${durationMin} min'`, `time = startedAt`.

- [ ] **Step 6:** For walks: each `oura_workout` on today passing the quality filters from Area 6 becomes a `'walk'` event: `title = 'Walk'`, `subtitle = '${distanceKm} km · ${durationMin} min'`.

**12b — UI**

- [ ] **Step 7:** Create `app/health/timeline/page.tsx` as a client component page. Fetch `cachedFetch('day-timeline', '/api/day-timeline', 5 * 60)` (5-min TTL — timeline changes throughout the day). Seed from `readCacheSync`.

- [ ] **Step 8:** In the timeline page UI, render events as a vertical list with a left-side time column and a card on the right. Use a simple dot connector (`w-px bg-border flex-grow`) between events to create the timeline line effect.

  Event icons:
  - `wakeup` → `SunriseIcon` (or `MoonIcon` with text "Woke up")
  - `meal` → `UtensilsIcon`
  - `workout` → `DumbbellIcon`
  - `walk` → `FootprintsIcon`
  - `bedtime` → `MoonIcon`

  Time format: `h:mm a` (e.g. "6:48 AM").

- [ ] **Step 9:** Add "Timeline" as a navigable route from the home screen. Add a `CalendarIcon` button or a row at the bottom of the home screen that links to `/health/timeline`. Alternatively, add it as a tab in the Health screen.

- [ ] **Step 10:** Run `pnpm exec tsc --noEmit` — no errors.

- [ ] **Step 11:** Start dev server → `/health/timeline`. Verify events are in chronological order, all types render correctly. Test with no data for a given type (e.g. no walks today) — timeline should gracefully omit that event type.

---

## Area 13 — AI Insights per Section (Rate-limited, Once-daily)

**Context from screenshots:** Oura shows a short AI-generated paragraph on each detail screen ("Your readiness is optimal today because your HRV was 10% above your baseline…"). We want similar insights on each of our 4 detail pages from Area 10.

**Constraints:**
- Must not burn through Gemini token quota — limit to 1 generation per section per calendar day
- Cache the response for 24h, keyed by `{section}:{date}`
- Model: `gemini-3.1-flash-lite` (very cheap, same as AI chat)
- Sleep insight: only trigger after morning Oura sync (when `sleepScore != null` for today)
- The user can tap a "Refresh analysis" button to force regenerate (consumes a new token call)

**API Design:**

```
POST /api/ai/health-insight
Body: { section: 'readiness' | 'sleep' | 'heart-rate' | 'activity', date: string }
Returns: { insight: string, cachedAt: string }
```

### Steps

**13a — Backend API**

- [ ] **Step 1:** Create `app/api/ai/health-insight/route.ts`. Auth-guard, validate section and date from body.

- [ ] **Step 2:** Add a DB table `ai_health_insights` to store generated insights:
  ```sql
  CREATE TABLE IF NOT EXISTS ai_health_insights (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT NOT NULL REFERENCES users(id),
    section      TEXT NOT NULL,       -- 'readiness' | 'sleep' | 'heart-rate' | 'activity'
    date         DATE NOT NULL,
    insight      TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, section, date)
  );
  ```
  Create migration `NNN_ai_health_insights.sql`.

- [ ] **Step 3:** In the API route, check the DB first:
  ```ts
  const existing = await repo.getAiHealthInsight(userId, section, date)
  if (existing) return NextResponse.json({ insight: existing.insight, cachedAt: existing.createdAt })
  ```

- [ ] **Step 4:** If no cached insight, fetch the data for that section and build a prompt:

  For `'readiness'`:
  ```ts
  const data = await fetch('/api/readiness-score').then(r => r.json())
  const prompt = `You are a fitness coach AI. The user's Oura readiness score today is ${data.ouraScore}/100 (${data.label}).
  Contributors: ${JSON.stringify(data.readinessContributors)}.
  Temperature deviation: ${data.temperatureDeviation}°C.
  Write 2–3 sentences explaining what today's readiness score means and one practical recommendation. Be specific about which contributors are strongest/weakest. Do not use markdown.`
  ```

  Adapt similarly for sleep (use `sleepScore`, `sleepContributors`, last night's stats), heart-rate (use `hrCurrent`, `hrMin`, `hrAvg`, `hrMax`, `stressHigh`, `recoveryHigh`), and activity (use `activityScore`, `activityContributors`).

- [ ] **Step 5:** Call Gemini:
  ```ts
  import { generateText } from 'ai'
  import { google } from '@ai-sdk/google'
  const { text } = await generateText({
    model: google('gemini-3.1-flash-lite'),
    prompt,
    maxTokens: 150,
  })
  await repo.upsertAiHealthInsight(userId, section, date, text)
  return NextResponse.json({ insight: text, cachedAt: new Date().toISOString() })
  ```

- [ ] **Step 6:** Add `getAiHealthInsight` and `upsertAiHealthInsight` to `lib/data/repository.ts` interface and `lib/data/postgres/adapter.ts` implementation. Simple select and insert-on-conflict-update.

**13b — UI integration on detail pages**

- [ ] **Step 7:** Create `components/health/ai-insight-card.tsx` — a card component that:
  - Accepts `section: string` and `date: string`
  - On mount, `POST`s to `/api/ai/health-insight` (with a short `cachedFetch`-style approach: always hits the API but returns instantly if DB-cached)
  - Shows a loading skeleton while generating
  - Displays the returned text inside a card with a small Gemini icon
  - Has a "↻ Refresh" button in the top-right that re-POSTs (forcing a new generation via a `?force=true` flag that bypasses DB cache)

- [ ] **Step 8:** Import `AiInsightCard` in each detail page from Area 10 (readiness, sleep, heart-rate, activity). Place it as the last section above the bottom padding.

- [ ] **Step 9:** Add rate-limiting safety in the API: even with `?force=true`, cap at 5 calls per userId per hour using `rateLimit()`.

- [ ] **Step 10:** Run `pnpm exec tsc --noEmit && pnpm lint` — no errors.

- [ ] **Step 11:** Test: open a detail page. Insight generates and displays within 2–3 seconds. Re-open the page — instant display from DB cache. Tap "↻ Refresh" — new text generated. Check `ai_health_insights` table in the DB:
  ```bash
  PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev \
    -c "SELECT section, date, LEFT(insight, 80) FROM ai_health_insights WHERE user_id IS NOT NULL;"
  ```

---

## Area 14 — Sleep Data Discrepancy Fix

**Problem:** The app shows 8h 1m for last night's sleep; Oura shows 7h 53m. Both values are in the DB as separate rows in `sleep_sessions`:

| Source | `sleep_start` | `sleep_end` | `duration_hours` |
|---|---|---|---|
| Samsung Health | 2026-06-27 20:10 | 2026-06-28 07:33 | 8.02 h |
| Oura Ring | 2026-06-27 22:26 | 2026-06-28 07:33 | 7.88 h |

**Root cause:** Samsung Health logs the session from when you got into bed (8:10 PM), including the ~2h of screen time before actually falling asleep. Oura logs from actual sleep onset (~10:26 PM). Both rows have the same wake-up `date` (`2026-06-28`), so `mergeByDate` in `app/api/sleep-sessions/route.ts` tries to merge them — but since `oura_id` is not passed through the current `listSleepSessions` query, the merge function can't distinguish them and **adds** the durations together (producing ~16h) or silently picks whichever comes first from the DB query.

**Why 8h 1m shows instead of 16h:** Looking at the query order — `orderBy(desc(sleepSessions.date))` — both rows have the same date, so order within that date is unspecified. If Samsung Health's row happens to come first from the DB, `mergeByDate` uses it as the base. The Oura row then tries to merge in but `durationHours` gets added → would be ~16h. The actual display of 8h 1m suggests the Oura row may not be returned (different `date` value if `sleep_end` midnight-spans differently) or only one is returned. Needs DB investigation.

**Regardless of exact cause, the correct fix is:**

**When Oura data exists for a night, prefer Oura's duration and staging data** — not Samsung Health's. Samsung Health's session start time is unreliable (includes pre-sleep in-bed time). Oura detects actual sleep onset.

### Steps

- [ ] **Step 1 (investigate):** Run a DB query to see exactly what rows exist for the affected night:
  ```bash
  PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev \
    -c "SELECT date, sleep_start, sleep_end, duration_hours, oura_id FROM sleep_sessions WHERE user_id IS NOT NULL ORDER BY date DESC LIMIT 10;"
  ```
  Confirm two rows exist for 2026-06-28, one with `oura_id` non-null and one null.

- [ ] **Step 2:** In `lib/data/postgres/adapter.ts`, update `listSleepSessions` to include `ouraId` in the returned `SleepSession` object. Add `ouraId: r.ouraId ?? undefined` to the map result. Update the `SleepSession` type in `lib/types/` (or wherever defined) to add `ouraId?: string`.

- [ ] **Step 3:** In `app/api/sleep-sessions/route.ts`, update the `mergeByDate` input type to include `ouraId: string | null`. Update the map call on line ~74 to pass `ouraId: r.ouraId ?? null`.

- [ ] **Step 4:** Update `mergeByDate` logic: when two rows share the same `date`, check if exactly one has a non-null `ouraId`. If so, **use the Oura row as the authoritative source for duration-based fields** (not additive merge). Only additive-merge when neither row has an `ouraId` (the Samsung-split-at-midnight case):

  ```ts
  const existing = map.get(r.date)
  if (!existing) { map.set(r.date, { ...r }); continue; }

  // If one is Oura and the other is Samsung Health, prefer Oura's duration data
  const existingIsOura = existing.ouraId != null
  const incomingIsOura = r.ouraId != null

  if (existingIsOura && !incomingIsOura) {
    // Keep existing (Oura) — Samsung Health row is redundant; only take sleepEnd if later
    if (r.sleepEnd && (!existing.sleepEnd || r.sleepEnd > existing.sleepEnd)) {
      existing.sleepEnd = r.sleepEnd
    }
    continue
  }

  if (!existingIsOura && incomingIsOura) {
    // Replace existing with Oura row (more accurate) — keep sleepStart from Samsung (earlier)
    const samsungStart = existing.sleepStart
    map.set(r.date, {
      ...r,
      sleepStart: samsungStart && (!r.sleepStart || samsungStart < r.sleepStart)
        ? samsungStart  // preserve earliest start for "in bed" reference if needed
        : r.sleepStart,
    })
    continue
  }

  // Both same source type (both Oura or both Samsung) → additive merge (existing behaviour)
  const add = (a: number | null, b: number | null) => ...
  ```

- [ ] **Step 5:** After the fix, the app's displayed sleep duration for last night should match Oura's reported 7h 53m. Run the fix and verify in the dev server:
  - Health > Body (or new Sleep detail page after Area 10) shows ~7h 53m for last night
  - 7-day sleep chart no longer shows inflated totals for nights that have both sources

- [ ] **Step 6:** Add `ouraId` to the JSON response of `GET /api/sleep-sessions` so the Sleep detail page can show a small "Oura verified" badge when Oura data is the source. If `ouraId` is non-null, mark the session as Oura-sourced in the UI (a small ring icon or "Oura" label).

- [ ] **Step 7:** Run `pnpm exec tsc --noEmit` — no errors.

---

## Implementation Order (Recommended)

| Priority | Area | Complexity | Impact |
|----------|------|------------|--------|
| P1 | #14 Sleep discrepancy fix | Low | Wrong data shown every day |
| P1 | #6 Activity tracking filters | Low | Immediately stops bad walk data |
| P1 | #1 Mood tracker collapsible sections | Low | Immediate daily UX improvement |
| P2 | #3 Muscle SVG caching | Low-medium | Fixes visible Body tab slowness |
| P2 | #4 Training tab caching | Low-medium | Fixes visible Training tab slowness |
| P2 | #2 Home screen loading | Medium | Investigate TTLs + pull-to-sync wipe |
| P3 | #7 Workout completed UI | Low | Polish / satisfaction |
| P3 | #5 AI periodization baseline bug | Medium | Requires DB investigation first |
| P3 | #9 Home screen Oura chip row | Low-medium | Navigation entry point for detail pages |
| P4 | #10 Detail pages (×4) | High | Full Oura-style depth screens |
| P4 | #12 Timeline feature | High | New chronological day view |
| P4 | #11 De-duplication | Medium | Do after #10 is stable |
| P4 | #13 AI insights per section | Medium | Do after detail pages exist (#10) |
| P5 | #8 End-of-day nutrition notification | High | Multi-step new feature |

---

## Testing Checklist

### #1 Mood tracker
- [ ] Open daily check-in → Energy visible, Sore Muscles and Issues collapsed with chevron
- [ ] Tap "Sore Muscles" → expands; tap again → collapses
- [ ] Select a sore muscle, then collapse → selection preserved on re-expand
- [ ] Overlapping muscle warning only shows when section is expanded
- [ ] Edit an existing log with sore muscles → section auto-expands
- [ ] Save works correctly end-to-end

### #2 Home screen loading
- [ ] First load: widgets appear (skeletons acceptable)
- [ ] Navigate away and back: no skeletons on second visit
- [ ] Pull-to-sync: data refreshes but second navigation is still fast from re-seeded cache

### #3 Muscle SVG caching
- [ ] Health > Body: SVG renders immediately on second visit (no skeleton flash)
- [ ] Log a workout → return to Body tab → muscle colours updated
- [ ] Mood check-in with sore muscles → muscle colours updated on next Body visit

### #4 Training tab caching
- [ ] Health > Training: AI Periodization and volume bars instant on second visit
- [ ] Complete a workout → Training tab shows updated volume on next visit

### #5 AI periodization baseline
- [ ] Sessions stuck on "Baseline needed" with existing 1RM show "Use prior data →" link
- [ ] Tapping it marks baseline complete and moves session to accumulation phase

### #6 Activity tracking
- [ ] 0.01 km / 260 min walk → does NOT appear in "Walk Detected"
- [ ] 0.39 km / 145 min walk → does NOT appear
- [ ] 3 km / 40 min walk → DOES appear correctly
- [ ] "Dismiss all" clears any backlog of stale sessions

### #7 Workout completed UI
- [ ] Completed session card: green ring, coloured pill badge, green tint
- [ ] Incomplete sessions: unchanged appearance
- [ ] "Start Again" button has green border tint when session done

### #8 End-of-day notification (device-only)
- [ ] Notification fires ~30 min before estimated bedtime if required meals unlogged
- [ ] Body shows calorie summary + missed meal names
- [ ] Tap → opens Nutrition tab with AI chat pre-filled for backfill
- [ ] If all required meals logged → notification cancelled
- [ ] `Required` toggle in Meal Types editor works and persists after save

### #9 Home screen Oura chip row
- [ ] 4 chips visible when Oura data is available: Readiness, Heart Rate, Sleep, Activity
- [ ] Chip colours match score bands (green ≥70, amber 50–69, red <50)
- [ ] No chips rendered when readiness state is null
- [ ] Tapping any chip fires the correct navigation route

### #10 Detail pages
- [ ] `/health/readiness` → loads with correct score, contributor bars, back button works
- [ ] `/health/sleep` → shows last night's duration matching Oura value (post #14 fix), staging bar if available
- [ ] `/health/heart-rate` → shows current HR, daily chart, stress/recovery data
- [ ] `/health/activity` → shows activity score + contributors + step/calorie metrics
- [ ] All pages cache correctly — second visit is instant
- [ ] AI insight stub renders without errors (Area 13 fills it later)

### #11 De-duplication
- [ ] Home ReadinessCard still shows (simplified — less height)
- [ ] Health > Body tab: sleep chart replaced by "Sleep detail →" link card
- [ ] Health > Body tab: HRV chart replaced by "Heart Rate →" link card
- [ ] No data is lost — all content accessible via detail pages

### #12 Timeline
- [ ] `/health/timeline` renders all event types for today in chronological order
- [ ] Wakeup event shows correct time from latest sleep session
- [ ] Meals grouped by meal type, not per food item
- [ ] Workouts and walks appear at correct times
- [ ] Missing event types (no walk today) → gracefully omitted from list
- [ ] Fast second-visit render from 5-min cache

### #13 AI insights
- [ ] Insight generates within ~3s on first visit to a detail page
- [ ] Second visit: instant display from DB cache
- [ ] Refresh button forces new generation
- [ ] All 4 sections produce coherent, non-markdown insights
- [ ] Rate limit: >5 calls/hour per user → 429 response

### #14 Sleep discrepancy
- [ ] DB query confirms two rows for affected date (one `oura_id` null, one non-null)
- [ ] After fix: app shows ~7h 53m for last night, not 8h 1m
- [ ] 7-day sleep chart no longer shows inflated totals
- [ ] Oura-verified sessions show "Oura" badge in sleep detail page
- [ ] Samsung Health session data is preserved (not deleted) — only display preference changes
