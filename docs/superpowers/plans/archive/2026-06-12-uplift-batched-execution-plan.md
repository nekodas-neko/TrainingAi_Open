> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# 2026-06-12 Uplift — Batched Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine the three pending 2026-06-12 uplift backlogs (`2026-06-12-uplift-design-accessibility-fixes.md`, `2026-06-12-uplift-performance-fixes.md`, `2026-06-12-uplift-security-fixes.md`) with 7 new findings from a follow-up review (3 high-severity logic bugs, a safe-area gap, a navigation dead-end, an uncached-fetch cluster, and two cache-busting gaps), and sequence **all 21 tasks** into batches that can be implemented, verified, and committed independently.

**Architecture:** A "batch" is a set of tasks where **no two tasks touch the same file** — every task in a batch can be handed to a separate subagent and committed in any order without merge conflicts. Batches run **sequentially** (Batch 2 starts only after every task in Batch 1 is committed), because several tasks in later batches insert code next to code that an earlier batch just added (e.g. three different tasks all add new repository methods near `getDayLog`/`getCalendarData`). Within a batch, tasks are fully independent and order doesn't matter.

For tasks that already have full step-by-step instructions in one of the three existing plan files, this document gives a short Problem/Fix/Files summary and a pointer — **do not duplicate those steps**, follow the referenced file. The 7 NEW tasks (not covered by any existing plan) are written out in full here, in the same format as the existing plans.

**Tech Stack:** Next.js 15 + React 19, TypeScript, Tailwind CSS v4, Drizzle ORM + PostgreSQL, `lib/sqlite/cache.ts` (`cachedFetch`/`invalidateCache`), `lib/date-utils.ts` (`todayInTz`, `aestMidnight`).

**Prerequisite:** Local dev Postgres must be running (`pnpm db:local`, already done automatically at session start per `CLAUDE.md`). Frontend-only tasks are verified via `pnpm dev` in a browser; DB-touching tasks (Batch 2 Task 4, Batch 3 Task 2, Batch 4 Task 2) run against `trainingai_dev`, never production.

---

## Batch Overview

| Batch | # Tasks | New tasks defined in this doc | Depends on |
|-------|---------|-------------------------------|------------|
| 1 | 11 | New Task D, New Task E | — |
| 2 | 4  | — | Batch 1 (no file overlap, but run after for a clean sequential history) |
| 3 | 4  | New Task 6, New Task C | Batch 2 (shares files with Perf#2, Perf#5) |
| 4 | 2  | New Task 7, New Task AB | Batch 3 (shares files with Sec#1, New Task C) |

---

## Batch 1 — Fully Independent (11 tasks)

None of these 11 tasks share a file with each other or with anything in later batches except where noted. Pick any subset and implement in parallel.

### 1.1 — Delete dead `app/history/history-content.tsx`
**Problem:** Unused legacy page (known issue H4 in `projectOverview.md`).
**Fix:** Delete the file (and route page if it imports nothing else needed).
**Files:** Delete `app/history/history-content.tsx` (+ `app/history/page.tsx` if it only renders this).
**Reference:** `2026-06-12-uplift-design-accessibility-fixes.md` Task 2 — follow its steps exactly.

### 1.2 — Delete orphaned `components/nutrition/saved-meals-section.tsx`
**Problem:** Orphaned component, no longer imported anywhere.
**Fix:** Delete the file.
**Files:** Delete `components/nutrition/saved-meals-section.tsx`.
**Reference:** `2026-06-12-uplift-design-accessibility-fixes.md` Task 3.

### 1.3 — Standardize activity done-screen tiles
**Problem:** `components/activity/done-activity-screen.tsx` mixes `bg-muted` tiles with the app's standard translucent-card style used elsewhere.
**Fix:** Change tiles at lines 78, 83, 89, 100, 104, 119 from `bg-muted` to `bg-muted/60 border border-border`.
**Files:** `components/activity/done-activity-screen.tsx`.
**Reference:** `2026-06-12-uplift-design-accessibility-fixes.md` Task 5.

### 1.4 — Weather-chip loading skeleton
**Problem:** `components/weather-chip.tsx` renders nothing while `useWeather()` is loading, causing a layout pop-in.
**Fix:** Destructure `loading` from `useWeather()` and render `<div className="h-[26px] w-14 rounded-full bg-muted/60 animate-pulse" />` while loading.
**Files:** `components/weather-chip.tsx`.
**Reference:** `2026-06-12-uplift-design-accessibility-fixes.md` Task 6.

### 1.5 — Gate `useWeather` behind `enabled` + dedup concurrent fetches
**Problem:** `DynamicBackground` calls `useWeather()` unconditionally on every page, even when the dynamic-background feature is off (default), triggering unnecessary geolocation + weather fetches.
**Fix:** Add an `enabled` param (default `true`) to `useWeather`; `DynamicBackground` computes `isActive` first and passes it in. Add module-level in-flight-fetch dedup keyed by rounded coordinates.
**Files:** `lib/weather/use-weather.ts`, `components/dynamic-background/dynamic-background.tsx:45-56`.
**Reference:** `2026-06-12-uplift-performance-fixes.md` Task 1.

### 1.6 — Throttle/memoize `activity-route-map.tsx`
**Problem:** The Leaflet route map re-renders on every GPS point during activity tracking; no offline fallback.
**Fix:** Throttle map updates to `THROTTLE_MS = 2000`, add a `useIsOnline()` hook with an offline fallback message.
**Files:** `components/activity/activity-route-map.tsx` (full rewrite per the plan).
**Reference:** `2026-06-12-uplift-performance-fixes.md` Task 3.

### 1.7 — Lazy-load `ExerciseStatsSheet`
**Problem:** `pre-workout-screen.tsx` eagerly imports `ExerciseStatsSheet`, bundling chart.js/react-chartjs-2 into the initial pre-workout chunk even though the sheet is opened on demand.
**Fix:** Load via `next/dynamic` with `{ ssr: false }`.
**Files:** `components/workout/pre-workout-screen.tsx:1-12`.
**Reference:** `2026-06-12-uplift-performance-fixes.md` Task 6.

### 1.8 — Timing-safe Health Connect ingest secret comparison
**Problem:** `app/api/health-connect/ingest/route.ts` compares the ingest secret with `===`, which is not constant-time.
**Fix:** Add `safeCompare()` using `timingSafeEqual` from `crypto`.
**Files:** `app/api/health-connect/ingest/route.ts`.
**Reference:** `2026-06-12-uplift-security-fixes.md` Task 2.

### 1.9 — Rate-limit `/api/friends` POST
**Problem:** `sendFriendRequest`'s 201/400 response split allows email enumeration with no rate limit.
**Fix:** `rateLimit(\`friend-request:${session.user.id}\`, 10, 15 * 60 * 1000)` returning 429 when exceeded.
**Files:** `app/api/friends/route.ts`.
**Reference:** `2026-06-12-uplift-security-fixes.md` Task 3.

### 1.10 — NEW Task D: Add safe-area inset to chat header

**Problem:** `components/chat.tsx`'s header (`<div className="bg-muted/50 flex items-center justify-between border-b px-4 py-3">`, line 501) has no top safe-area padding. Every other full-screen header in the app (e.g. `components/workout/warmup-screen.tsx:61`, `border-b px-4 pb-4 pt-safe`) uses the `.pt-safe` utility (`app/globals.css:265`, `padding-top: max(1rem, env(safe-area-inset-top, 0px))`) so content clears the Android status bar / iOS notch. The chat header is missing this and sits flush against the top edge on-device.

**Fix:** Replace `py-3` with `pb-3 pt-safe` on the header container, matching the convention used by `warmup-screen.tsx`.

**Files:** Modify `components/chat.tsx:501`.

- [ ] **Step 1: Update the header className**

Current (line 501):
```tsx
      <div className="bg-muted/50 flex items-center justify-between border-b px-4 py-3">
```

Change to:
```tsx
      <div className="bg-muted/50 flex items-center justify-between border-b px-4 pb-3 pt-safe">
```

- [ ] **Step 2: Type-check and lint**
```bash
npx tsc --noEmit
pnpm lint
```

- [ ] **Step 3: Verify locally**
`pnpm dev`, open `/chat`. The header should look visually unchanged on desktop (the `.pt-safe` minimum of `1rem` is close to the original `py-3` top padding of `0.75rem`). On a real device or with safe-area-inset simulated, the header content should sit clear of the status bar, matching the warm-up screen header's spacing.

- [ ] **Step 4: Commit**
```bash
git add components/chat.tsx
git commit -m "Add safe-area top padding to chat header"
```

### 1.11 — NEW Task E: Add back navigation to the activity pre-screen

**Problem:** `components/activity/pre-activity-screen.tsx` (the first screen shown at `/activity`) has no header, back button, or safe-area padding — just a centered icon/title/input/Start button (`flex h-full flex-col items-center justify-center gap-6 px-6`). `components/activity/activity-screen.tsx` switches between pre/active/done modes with no shared header wrapper either. There is no way to back out of the activity flow before starting one, other than the browser/OS back gesture.

**Fix:** Add a header to `PreActivityScreen` matching the established pattern (`flex items-center gap-3 border-b px-4 pb-4 pt-safe`, `ChevronLeftIcon` back button, used in `components/workout/warmup-screen.tsx:61-64`). The back button calls `resetSession()` (clears the selected activity type back to `INITIAL_STATE`, `mode: 'pre'`) and `router.back()`.

**Files:** Modify `components/activity/pre-activity-screen.tsx` (full file, 42 lines).

- [ ] **Step 1: Rewrite `pre-activity-screen.tsx` with a header**

Current (full file):
```tsx
'use client'

import { getActivityIcon } from '@/lib/constants/activity-icons'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useActivityStore } from '@/lib/stores/activity-store'

export function PreActivityScreen() {
  const { activityIcon, activityLabel, isDistanceBased, title, setTitle, begin } = useActivityStore()
  const Icon = getActivityIcon(activityIcon)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-2">
        <Icon size={48} weight="fill" style={{ color: 'var(--color-brand)' }} />
        <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{activityLabel}</span>
      </div>

      <div className="w-full max-w-xs space-y-1.5">
        <Label htmlFor="activity-title">Title</Label>
        <Input id="activity-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Activity name" />
      </div>

      {isDistanceBased && (
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          Your route, distance and pace will be tracked using GPS, including
          while your screen is off.
        </p>
      )}

      <button
        type="button"
        onClick={begin}
        className="w-full max-w-xs rounded-xl py-3.5 text-sm font-bold transition hover:opacity-90 active:scale-95"
        style={{ background: 'var(--color-brand)', color: '#000' }}
      >
        Start
      </button>
    </div>
  )
}
```

Change to:
```tsx
'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeftIcon } from 'lucide-react'
import { getActivityIcon } from '@/lib/constants/activity-icons'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useActivityStore } from '@/lib/stores/activity-store'

export function PreActivityScreen() {
  const router = useRouter()
  const { activityIcon, activityLabel, isDistanceBased, title, setTitle, begin, resetSession } = useActivityStore()
  const Icon = getActivityIcon(activityIcon)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-4 pb-4 pt-safe">
        <button onClick={() => { resetSession(); router.back() }} className="rounded-lg p-2.5 hover:bg-muted transition">
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">{activityLabel}</h1>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="flex flex-col items-center gap-2">
          <Icon size={48} weight="fill" style={{ color: 'var(--color-brand)' }} />
          <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{activityLabel}</span>
        </div>

        <div className="w-full max-w-xs space-y-1.5">
          <Label htmlFor="activity-title">Title</Label>
          <Input id="activity-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Activity name" />
        </div>

        {isDistanceBased && (
          <p className="max-w-xs text-center text-xs text-muted-foreground">
            Your route, distance and pace will be tracked using GPS, including
            while your screen is off.
          </p>
        )}

        <button
          type="button"
          onClick={begin}
          className="w-full max-w-xs rounded-xl py-3.5 text-sm font-bold transition hover:opacity-90 active:scale-95"
          style={{ background: 'var(--color-brand)', color: '#000' }}
        >
          Start
        </button>
      </div>
    </div>
  )
}
```

`resetSession` is already exported from `useActivityStore` (`lib/stores/activity-store.ts`, `resetSession: () => set({ ...INITIAL_STATE })`).

- [ ] **Step 2: Type-check and lint**
```bash
npx tsc --noEmit
pnpm lint
```

- [ ] **Step 3: Verify locally**
`pnpm dev`, navigate to `/activity` for any activity type. Confirm the header shows the activity label with a back chevron, content is otherwise unchanged and still centered below the header, and tapping the back button returns to the previous screen without leaving stale activity-type state (re-entering `/activity` directly should show `mode: 'pre'` with empty state, same as before this change).

- [ ] **Step 4: Commit**
```bash
git add components/activity/pre-activity-screen.tsx
git commit -m "Add back navigation header to the activity pre-screen"
```

---

## Batch 2 — 4 tasks (run after Batch 1)

These 4 tasks don't overlap each other, but each shares a file with one task in Batch 3 — run this batch first so Batch 3's anchors are accurate.

### 2.1 — `--card-tint-pct` CSS var + `accentCardStyle` light-mode fix
**Problem:** `accentCardStyle()` hardcodes `backgroundColor: 'color-mix(in oklch, var(--muted) 60%, transparent)'`, which reads fine in dark mode but barely separates from the page background in light mode.
**Fix:** Add a `--card-tint-pct` CSS variable to `:root`/`.dark` in `app/globals.css` and reference it from `accentCardStyle()`.
**Files:** `lib/utils.ts:53`, `app/globals.css` (`:root` ends line 91, `.dark` starts line 93).
**Reference:** `2026-06-12-uplift-design-accessibility-fixes.md` Task 1.
**Note:** Shares `lib/utils.ts` with Batch 3 Task 4 (New Task C) and Batch 4 Task 1 (New Task 7) — both edit different functions in the same file; this batch's edit lands first.

### 2.2 — Health info-button aria-labels + touch targets
**Problem:** 4 info buttons in `app/health/health-content.tsx` (lines 589, 732, 765, 792) lack `aria-label` and are below the 44×44pt minimum touch target (B11).
**Fix:** Add `aria-label="More information"` (or context-specific label) and bump `p-2` → `p-2.5`.
**Files:** `app/health/health-content.tsx:589,732,765,792`.
**Reference:** `2026-06-12-uplift-design-accessibility-fixes.md` Task 4.
**Note:** Shares `app/health/health-content.tsx` with Batch 3 Task 3 (New Task 6) — different line ranges (these are in the JSX render section ~lines 580-800; New Task 6 is in the data-fetching `useEffect` ~lines 261-276), this batch's edit lands first.

### 2.3 — Incremental distance calc in activity store
**Problem:** `appendPoint` recomputes total GPS distance from scratch on every point (O(n²)) via `computeTotalDistanceKm`.
**Fix:** Track running distance incrementally using `haversineDistanceKm` between the last two points only (O(n)).
**Files:** `lib/stores/activity-store.ts:1-13,99-108`.
**Reference:** `2026-06-12-uplift-performance-fixes.md` Task 2.
**Note:** Shares `lib/stores/activity-store.ts` with Batch 3 Task 1 (Perf Task 4, debounced persistence) — different sections (this is `appendPoint` ~lines 99-108; Perf Task 4 is the `persist`/`createJSONStorage` config ~lines 140-145), this batch's edit lands first.

### 2.4 — `getDayExerciseNames` repo method
**Problem:** The workout-data "done today" check uses `getDayLog` (full session+exercise+set hydration) just to check exercise names.
**Fix:** Add `getDayExerciseNames(userId, date)` — a single lighter join — to the repository interface and Postgres adapter, and use it in `app/api/workout-data/route.ts:122-135`.
**Files:** `lib/data/repository.ts:112`, `lib/data/postgres/adapter.ts:1217-1230` (insert after `getDayLog`), `app/api/workout-data/route.ts:122-135`.
**Reference:** `2026-06-12-uplift-performance-fixes.md` Task 5.
**Note:** Shares `lib/data/repository.ts` + `lib/data/postgres/adapter.ts` (both insert near `getDayLog`/`getCalendarData`) with Batch 3 Task 2 (Sec Task 1) and Batch 4 Task 2 (New Task AB) — this batch's edit lands first; Batch 3 Task 2 should anchor off this task's new method as its "previous neighbour" per the performance plan's own overlap note.

---

## Batch 3 — 4 tasks (run after Batch 2)

### 3.1 — Debounce activity-store localStorage persistence
**Problem:** `ta_activity_state` is written to `localStorage` on every GPS point during tracking.
**Fix:** Wrap `createJSONStorage` with a `debouncedLocalStorage(PERSIST_DEBOUNCE_MS = 2000)`.
**Files:** `lib/stores/activity-store.ts:140-145`.
**Reference:** `2026-06-12-uplift-performance-fixes.md` Task 4.
**Note:** Same file as Batch 2 Task 3 (incremental distance) — that edit has already landed; re-read the file before editing the `persist` config block.

### 3.2 — Fix write-IDOR in `/api/sync-workout`
**Problem:** `POST /api/sync-workout` upserts `workout_sessions`/`exercise_logs`/`set_logs` rows by client-supplied UUID with no ownership check — `logSets`'s `onConflictDoUpdate` can overwrite another user's set rows.
**Fix:** Batch-lookup existing owners via new `getWorkoutSessionOwners`/`getExerciseLogOwners` repo methods; skip mismatched items.
**Files:** `lib/data/repository.ts:109-116`, `lib/data/postgres/adapter.ts:1217-1230` (insert after `getDayLog` — adjust anchor since Batch 2 Task 4 already inserted `getDayExerciseNames` here), `app/api/sync-workout/route.ts`.
**Reference:** `2026-06-12-uplift-security-fixes.md` Task 1.
**Note:** Same files as Batch 2 Task 4 — insert these two methods using `getDayExerciseNames` as the new anchor point (additive either way, per the performance plan's own overlap note).

### 3.3 — NEW Task 6: Cache health-content.tsx uncached API calls

**Problem:** `app/health/health-content.tsx`'s data-loading `useEffect` (lines 259-281) mixes cached and uncached fetches. `body-metadata`, `sleep-sessions`, and `activity-types` already use `cachedFetch` (lines 241-253, 277-280), but four other calls are plain `fetch()` with no caching at all (lines 261-276):

```ts
    fetch('/api/training-load')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && d.interpretation !== 'insufficient_data') setTrainingLoad(d) })
      .catch(() => {});
    fetch('/api/sleep-performance-correlation')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSleepCorr(d) })
      .catch(() => {});
    fetch('/api/weekly-stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setWeeklyStats(d) })
      .catch(() => {});
    fetch('/api/workout-data?tab=meta')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.program?.sessions?.length) setActiveSessions(d.program.sessions) })
      .catch(() => {});
```

Every visit to `/health` re-fetches all four from the network with no stale-while-revalidate or offline support.

**Fix:** Wrap each in `cachedFetch`. `training-load`, `sleep-performance-correlation`, and `weekly-stats` are derived daily stats — use `TTL_MEDIUM` (matches `body-metadata`/`sleep-sessions` in the same effect). `workout-data?tab=meta` is program structure that only changes on config edits — use `TTL_LONG` with cache key `'workout-data:meta'`, which is already covered by the existing `invalidateCache('workout-data')` prefix-match calls in `config-screen.tsx` (lines 471, 492 — and the new `invalidateWorkoutCardCache()` call added by Batch 4 Task 1).

**Files:** Modify `app/health/health-content.tsx:261-276`.

- [ ] **Step 1: Replace the 4 plain fetches with `cachedFetch`**

Change the block shown above to:
```ts
    cachedFetch<import('@/app/api/training-load/route').TrainingLoadResponse>(
      'training-load', '/api/training-load', TTL_MEDIUM,
      d => { if (d && d.interpretation !== 'insufficient_data') setTrainingLoad(d) },
    ).catch(() => {});
    cachedFetch<import('@/app/api/sleep-performance-correlation/route').SleepCorrelationResponse>(
      'sleep-performance-correlation', '/api/sleep-performance-correlation', TTL_MEDIUM,
      d => { if (d) setSleepCorr(d) },
    ).catch(() => {});
    cachedFetch<WeeklyStatsResponse>(
      'weekly-stats', '/api/weekly-stats', TTL_MEDIUM,
      d => { if (d) setWeeklyStats(d) },
    ).catch(() => {});
    cachedFetch<{ program?: { sessions?: ProgramSession[] } }>(
      'workout-data:meta', '/api/workout-data?tab=meta', TTL_LONG,
      d => { if (d?.program?.sessions?.length) setActiveSessions(d.program.sessions) },
    ).catch(() => {});
```

`cachedFetch`, `TTL_MEDIUM`, `TTL_LONG`, `WeeklyStatsResponse`, and `ProgramSession` are all already imported at the top of `health-content.tsx` (lines 10-11, 17, 25, 27).

- [ ] **Step 2: Type-check and lint**
```bash
npx tsc --noEmit
pnpm lint
```

- [ ] **Step 3: Verify locally**
`pnpm dev`, log in as `test@local.dev`, open `/health`. Confirm Training Load, Sleep vs Performance, Weekly stats, and program-dependent UI render as before. Reload — these cards should now populate instantly from the sessionStorage mirror before the network responses land (same behavior as the `body-metadata` card).

- [ ] **Step 4: Commit**
```bash
git add app/health/health-content.tsx
git commit -m "Cache health page training-load, sleep-correlation, weekly-stats and program meta fetches"
```

### 3.4 — NEW Task C: Fix mood log date-format mismatch + cache-busting

**Problem:** Two date formats collide on the mood feature, and a save doesn't invalidate the read cache.

1. `app/api/mood/route.ts` GET (line 13) does `searchParams.get('date') ?? formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')` — dash format `YYYY-MM-DD`. POST (line 32) stores `logDate` in the same dash format. `getMoodLog` does an exact string match `eq(s.moodLogs.logDate, date)`.
2. Both client callers build the query param with `localDateString()` (`lib/utils.ts:16-19`), which returns **slash** format `YYYY/MM/DD`:
   - `app/session-select/session-select-content.tsx:558-564`
   - `components/workout/warmup-screen.tsx:27-32`

   Since `date` is always present, the `??` fallback in the GET handler never triggers — `getMoodLog` is queried with `"2026/06/12"` against a column storing `"2026-06-12"`, which **never matches**. `GET /api/mood` therefore always returns `null`, even when today's mood log exists.

3. `components/mood-checkin-sheet.tsx:89-107` (`handleSave`) POSTs successfully and calls `onSaved?.(log)` to update the caller's local state immediately, but never calls `invalidateCache('mood:...')`. Once (1)/(2) are fixed and `mood:${date}` becomes a real cache key, a stale cached `null` from before the save would still be served by `cachedFetch` on the next mount (within `TTL_SHORT`), reverting the just-saved mood back to "not logged".

**Fix:**
1. Both client callers switch from `localDateString()` to `todayInTz()` (`lib/date-utils.ts`, dash format, AEST-correct per `CLAUDE.md`) when building the `/api/mood?date=...` URL and cache key.
2. `MoodCheckInSheet.handleSave()` calls `invalidateCache('mood:')` after a successful save.

**Files:** `app/session-select/session-select-content.tsx:558-564`, `components/workout/warmup-screen.tsx:1-32`, `components/mood-checkin-sheet.tsx:1-107`.

- [ ] **Step 1: Fix the cache key/URL in `session-select-content.tsx`**

Current (lines 558-564):
```ts
  useEffect(() => {
    const today = localDateString();
    cachedFetch<import('@/lib/types/mood').MoodLog | null>(
      `mood:${today}`, `/api/mood?date=${today}`, TTL_SHORT,
      (d) => setMoodLog(d ?? null),
    ).catch(() => setMoodLog(null));
  }, []);
```

Change to:
```ts
  useEffect(() => {
    const today = todayInTz();
    cachedFetch<import('@/lib/types/mood').MoodLog | null>(
      `mood:${today}`, `/api/mood?date=${today}`, TTL_SHORT,
      (d) => setMoodLog(d ?? null),
    ).catch(() => setMoodLog(null));
  }, []);
```

Add `todayInTz` to the `@/lib/date-utils` import (the file already imports other helpers from `lib/date-utils`, e.g. `formatInTimeZone`/`deviceTz` usage nearby — check the top-of-file import block and add `todayInTz` to whichever `lib/date-utils` import already exists, or add a new `import { todayInTz } from '@/lib/date-utils'`).

- [ ] **Step 2: Fix the fetch URL in `warmup-screen.tsx`**

Current (lines 27-32):
```ts
  useEffect(() => {
    fetch(`/api/mood?date=${localDateString()}`)
      .then(r => r.json())
      .then(d => setMoodLog(d ?? null))
      .catch(() => setMoodLog(null));
  }, []);
```

Change to:
```ts
  useEffect(() => {
    fetch(`/api/mood?date=${todayInTz()}`)
      .then(r => r.json())
      .then(d => setMoodLog(d ?? null))
      .catch(() => setMoodLog(null));
  }, []);
```

Replace the import at line 9 — current:
```ts
import { localDateString } from "@/lib/utils";
```
Change to:
```ts
import { todayInTz } from "@/lib/date-utils";
```
(Confirm `localDateString` isn't used elsewhere in this file before removing the import — `grep -n localDateString components/workout/warmup-screen.tsx` should only show the import and the one call site being replaced.)

- [ ] **Step 3: Invalidate the mood cache on save in `mood-checkin-sheet.tsx`**

Current (lines 89-107):
```ts
  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/mood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ energyLevel: energy, sleepQuality: sleepQ, bodyState, soreMuscles }),
      })
      if (!res.ok) throw new Error()
      const log: MoodLog = await res.json()
      toast.success("Mood logged")
      onSaved?.(log)
      onOpenChange(false)
    } catch {
      toast.error("Failed to save mood")
    } finally {
      setSaving(false)
    }
  }
```

Change to:
```ts
  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch("/api/mood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ energyLevel: energy, sleepQuality: sleepQ, bodyState, soreMuscles }),
      })
      if (!res.ok) throw new Error()
      const log: MoodLog = await res.json()
      await invalidateCache('mood:')
      toast.success("Mood logged")
      onSaved?.(log)
      onOpenChange(false)
    } catch {
      toast.error("Failed to save mood")
    } finally {
      setSaving(false)
    }
  }
```

Add `import { invalidateCache } from "@/lib/sqlite/cache"` to the top of `components/mood-checkin-sheet.tsx`.

- [ ] **Step 4: Type-check and lint**
```bash
npx tsc --noEmit
pnpm lint
```

- [ ] **Step 5: Verify locally**
`pnpm dev`, log in as `test@local.dev`. Open `/session-select` and `/workout` (warm-up screen) — the "How are you feeling today?" prompt should show (seeded data has no mood log for today). Tap it, fill in the check-in, save — confirm the "Mood logged" toast and the card switching to "Mood logged · tap to edit". Reload the page — the mood card should still show "logged" (previously it reverted to the prompt due to the date-format bug). In the Network tab, confirm `GET /api/mood?date=2026-06-12` (dash format) returns the saved log object, not `null`.

- [ ] **Step 6: Commit**
```bash
git add app/session-select/session-select-content.tsx components/workout/warmup-screen.tsx components/mood-checkin-sheet.tsx
git commit -m "Fix mood log date-format mismatch and invalidate mood cache on save"
```

---

## Batch 4 — 2 tasks (run after Batch 3)

### 4.1 — NEW Task 7: Clear `ta_wc_*` session cache on program save

**Problem:** `session-select-content.tsx` caches each session's workout-data response in `sessionStorage` under `ta_wc_${sess.id}` (line 514) — read by `lastSessionDay()` (lines 228-250) and by `app/workout-select/workout-select-content.tsx` for per-session previews. When the user edits their program in `config-screen.tsx`, both save paths call `invalidateCache('workout-data')` (lines 471, 492), which correctly clears the SQLite/localStorage `workout-data*` cache and its sessionStorage mirror (`ta_sscache:workout-data*`) — but **not** the separately-keyed `ta_wc_${sessionId}` entries. Until the page fully reloads, stale per-session data (old exercise list, old "last trained" date) is shown.

**Fix:** Add `invalidateWorkoutCardCache()` to `lib/utils.ts` (alongside the existing `invalidateCalendarCache()`) that clears all `ta_wc_*` sessionStorage keys, and call it from both `invalidateCache('workout-data')` sites in `config-screen.tsx`.

**Files:** `lib/utils.ts`, `components/config-screen.tsx:471,492`.

- [ ] **Step 1: Add `invalidateWorkoutCardCache()` to `lib/utils.ts`**

Current (lines 26-30):
```ts
export function invalidateCalendarCache() {
  const n = new Date();
  const key = `ta_calendar_v2_${n.getFullYear()}_${String(n.getMonth() + 1).padStart(2, "0")}`;
  sessionStorage.removeItem(key);
}
```

Add immediately after:
```ts

export function invalidateWorkoutCardCache() {
  Object.keys(sessionStorage)
    .filter(k => k.startsWith("ta_wc_"))
    .forEach(k => sessionStorage.removeItem(k));
}
```

- [ ] **Step 2: Call it from both program-save paths in `config-screen.tsx`**

Update the import at line 13 — current:
```ts
import { cn } from "@/lib/utils";
```
Change to:
```ts
import { cn, invalidateWorkoutCardCache } from "@/lib/utils";
```

Current (line 471, inside the program-save handler):
```ts
      toast.success("Program saved");
      invalidateCache('workout-data');
```
Change to:
```ts
      toast.success("Program saved");
      invalidateCache('workout-data');
      invalidateWorkoutCardCache();
```

Current (line 492, inside `activateProgram`):
```ts
      if (!res.ok) throw new Error();
      await invalidateCache('workout-data');
```
Change to:
```ts
      if (!res.ok) throw new Error();
      await invalidateCache('workout-data');
      invalidateWorkoutCardCache();
```

- [ ] **Step 3: Type-check and lint**
```bash
npx tsc --noEmit
pnpm lint
```

- [ ] **Step 4: Verify locally**
`pnpm dev`, log in, go to `/session-select` and note the "Last trained" text on a session card. Open Config, rename that session (or add an exercise), save. Navigate back to `/session-select` via client-side nav (not a full reload) — confirm the stale `ta_wc_${id}` snapshot is cleared and the card re-fetches fresh data.

- [ ] **Step 5: Commit**
```bash
git add lib/utils.ts components/config-screen.tsx
git commit -m "Clear ta_wc_* session cache when program config is saved"
```

### 4.2 — NEW Task AB: Fix cross-month streak/bar-strip data gap and best-streak definition mismatch

This combines two related findings into one task because both touch the same `streak` useMemo block in `session-select-content.tsx`.

**Problem A — cross-month data gap:** `calendarDays` (`app/session-select/session-select-content.tsx:349`, `Record<string, string[]>`) is the **only** data source for `weekStrip` (lines 718-737), the `streak` useMemo (lines 740-759), and the 10-day bar strip (line 1057). It is populated **exclusively** from `/api/calendar-data?year=Y&month=M` for the **current calendar month**:

- The sessionStorage seed on mount (lines 430-437) reads only `ta_calendar_v2_${year}_${month}` (current month).
- The fetch in `fetchWorkoutData` (lines 517-525) requests only the current month and **wholesale-replaces** `calendarDays` via `setCalendarDays(d.trainedDays ?? {})`.

The `streak` useMemo walks back via `aestDateString(ago)` (`yyyy/MM/dd`, AEST) for `ago = 1..364`. Once `ago` crosses the 1st of the current month into the previous month, `calendarDays[aestDateString(ago)]` is `undefined` for **every** prior day — `consecutiveRest` increments every iteration and the loop `break`s once `consecutiveRest > MAX_REST_GAP (1)`. So near the start of any month, the streak is truncated to at most a couple of days, regardless of actual training history. The 10-day bar strip and `weekStrip` have the same issue whenever their lookback window crosses into the previous month.

**Problem B — best-streak definition mismatch:** `app/api/achievements/route.ts`'s `computeStreak()` (lines 29-64) computes `best` using `diffDays === 1` between consecutive sorted workout dates — the longest run of **literally back-to-back** training days, zero rest-day tolerance. `bestStreak = workoutStreaks.best` (line 197) feeds the `streak_7/14/30/60` achievements (lines 237-240). The home screen's `streak` useMemo allows `MAX_REST_GAP = 1` (one rest day doesn't break the streak). A user training on a Push/Pull/Legs/rest rotation sees a home-screen streak consistently higher than what the achievements page credits for `streak_*` — two different numbers for what looks like the same metric.

Note: `computeStreak` is also reused for `foodStreaks`/`sleepStreaks`/`calorieGoalStreaks` (lines 187-193), which feed achievements explicitly named "N days **in a row**" (`food_streak_7`, `sleep_streak_7`, `calorie_goal_7`, etc., lines 256-263) — these must **keep** strict zero-rest-day semantics. Only the workout streak should gain the 1-day tolerance.

**Fix:**
1. Add `getRecentTrainedDays(userId, days)` to the repository — a rolling-window (not month-bound) version of `getCalendarData`'s `trainedDays` query — and a new `/api/streak-data` route returning the last 90 days.
2. In `session-select-content.tsx`, fetch `/api/streak-data` alongside the existing month-bound `/api/calendar-data` (which `CalendarWidget` uses independently for its own month view via `components/calendar-widget.tsx:43`) and **merge** both results into `calendarDays` so `weekStrip`, `streak`, and the bar strip always have data regardless of month boundaries.
3. Give `computeStreak()` a `maxRestGap` parameter (default `0`, preserving existing strict semantics for food/sleep/calorie achievements) and call it with `maxRestGap = 1` for `workoutStreaks` only, matching the home screen's definition.

**Files:** `lib/data/repository.ts` (Queries section, after `getCalendarData`), `lib/data/postgres/adapter.ts` (after `getCalendarData`, ~line 1171), new `app/api/streak-data/route.ts`, `app/session-select/session-select-content.tsx`, `app/api/achievements/route.ts:29-64,186-193`.

- [ ] **Step 1: Add `getRecentTrainedDays` to the repository interface**

In `lib/data/repository.ts`, current:
```ts
  // ── Queries ────────────────────────────────────────────────────────────────
  getFirstWorkoutDateForProgram(userId: string, programSessionIds: string[]): Promise<Date | null>
  getCalendarData(userId: string, year: number, month: number): Promise<{ trainedDays: Record<string, string[]>; activityDays: Record<string, string[]> }>
```

Add after `getCalendarData`:
```ts
  // ── Queries ────────────────────────────────────────────────────────────────
  getFirstWorkoutDateForProgram(userId: string, programSessionIds: string[]): Promise<Date | null>
  getCalendarData(userId: string, year: number, month: number): Promise<{ trainedDays: Record<string, string[]>; activityDays: Record<string, string[]> }>
  // Rolling-window trained-day map (not month-aligned) for streak/week-strip
  // widgets that must not lose data at calendar-month boundaries.
  getRecentTrainedDays(userId: string, days: number): Promise<Record<string, string[]>>
```

- [ ] **Step 2: Implement it in the Postgres adapter**

In `lib/data/postgres/adapter.ts`, `getCalendarData` ends at line 1171 (`return { trainedDays, activityDays }` then closing brace). Add immediately after:
```ts
  async getRecentTrainedDays(userId: string, days: number): Promise<Record<string, string[]>> {
    const todayAest = todayInTz(DEFAULT_TZ)
    const [y, m, d] = todayAest.split('-').map(Number)
    const from = aestMidnight(y, m, d - days)
    const to   = aestMidnight(y, m, d + 1)

    const rows = await this.db.select({
      dateKey: sql<string>`to_char(${s.workoutSessions.startedAt} AT TIME ZONE 'Australia/Brisbane', 'YYYY/MM/DD')`,
      sessionName: sql<string>`COALESCE(${s.programSessions.name}, ${s.workoutSessions.sessionName})`,
    })
      .from(s.workoutSessions)
      .leftJoin(s.programSessions, eq(s.workoutSessions.sessionId, s.programSessions.id))
      .innerJoin(s.exerciseLogs, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
      ))

    const trainedDays: Record<string, string[]> = {}
    for (const r of rows) {
      if (!trainedDays[r.dateKey]) trainedDays[r.dateKey] = []
      if (!trainedDays[r.dateKey].includes(r.sessionName)) trainedDays[r.dateKey].push(r.sessionName)
    }
    return trainedDays
  }
```
`aestMidnight`, `todayInTz`, `DEFAULT_TZ`, `eq`, `and`, `gte`, `lt`, `sql` are all already imported at the top of `adapter.ts` (lines 2, 19).

- [ ] **Step 3: Add the `/api/streak-data` route**

Create `app/api/streak-data/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

const WINDOW_DAYS = 90

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const trainedDays = await (await getRepository()).getRecentTrainedDays(userId, WINDOW_DAYS)
  return NextResponse.json(
    { trainedDays },
    { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
  )
}
```
This mirrors `app/api/calendar-data/route.ts`'s structure.

- [ ] **Step 4: Fetch `/api/streak-data` and merge into `calendarDays` in `session-select-content.tsx`**

Current (lines 517-525, inside `fetchWorkoutData`'s `Promise.all`):
```ts
        fetch(`/api/calendar-data?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d) {
              sessionStorage.setItem(`ta_calendar_v2_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`, JSON.stringify(d));
              setCalendarDays(d.trainedDays ?? {});
            }
          })
          .catch(() => {}),
```

Change to:
```ts
        fetch(`/api/calendar-data?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d) {
              sessionStorage.setItem(`ta_calendar_v2_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`, JSON.stringify(d));
              setCalendarDays(prev => ({ ...prev, ...(d.trainedDays ?? {}) }));
            }
          })
          .catch(() => {}),
        fetch('/api/streak-data')
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d?.trainedDays) {
              sessionStorage.setItem('ta_streak_v1', JSON.stringify(d));
              setCalendarDays(prev => ({ ...prev, ...d.trainedDays }));
            }
          })
          .catch(() => {}),
```

Now seed `calendarDays` from `ta_streak_v1` on mount alongside the existing month seed. Current (lines 429-438):
```ts
    // Seed calendar and recommendation from sessionStorage so the banner renders immediately
    try {
      const now = new Date();
      const calKey = `ta_calendar_v2_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
      const calRaw = sessionStorage.getItem(calKey);
      if (calRaw) {
        const d = JSON.parse(calRaw);
        if (d.trainedDays) setCalendarDays(d.trainedDays);
      }
    } catch { /* ignore */ }
```

Change to:
```ts
    // Seed calendar and recommendation from sessionStorage so the banner renders immediately
    try {
      const now = new Date();
      const calKey = `ta_calendar_v2_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
      const calRaw = sessionStorage.getItem(calKey);
      const streakRaw = sessionStorage.getItem('ta_streak_v1');
      const merged: Record<string, string[]> = {};
      if (calRaw) {
        const d = JSON.parse(calRaw);
        if (d.trainedDays) Object.assign(merged, d.trainedDays);
      }
      if (streakRaw) {
        const d = JSON.parse(streakRaw);
        if (d.trainedDays) Object.assign(merged, d.trainedDays);
      }
      if (Object.keys(merged).length > 0) setCalendarDays(merged);
    } catch { /* ignore */ }
```

- [ ] **Step 5: Add `maxRestGap` tolerance to `computeStreak` in `app/api/achievements/route.ts`**

Current (lines 29-64):
```ts
function computeStreak(dates: string[], tz: string): { best: number; current: number } {
  if (dates.length === 0) return { best: 0, current: 0 }

  const sorted = [...dates].sort()

  let best = 1, streak = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000)
    if (diffDays === 1) {
      streak++
      if (streak > best) best = streak
    } else {
      streak = 1
    }
  }

  // current streak: compare date strings in the user's timezone to avoid UTC-midnight drift
  const todayStr     = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  const yesterdayStr = formatInTimeZone(new Date(Date.now() - 86_400_000), tz, 'yyyy-MM-dd')
  const mostRecentStr = sorted[sorted.length - 1]

  if (mostRecentStr !== todayStr && mostRecentStr !== yesterdayStr) return { best, current: 0 }

  let current = 1
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = new Date(sorted[i])
    const b = new Date(sorted[i + 1])
    const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000)
    if (diff === 1) current++
    else break
  }

  return { best, current }
}
```

Change to:
```ts
function computeStreak(dates: string[], tz: string, maxRestGap = 0): { best: number; current: number } {
  if (dates.length === 0) return { best: 0, current: 0 }

  const sorted = [...dates].sort()

  let best = 1, streak = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000)
    if (diffDays - 1 <= maxRestGap) {
      streak++
      if (streak > best) best = streak
    } else {
      streak = 1
    }
  }

  // current streak: compare date strings in the user's timezone to avoid UTC-midnight drift
  const todayStr     = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  const yesterdayStr = formatInTimeZone(new Date(Date.now() - 86_400_000), tz, 'yyyy-MM-dd')
  const mostRecentStr = sorted[sorted.length - 1]

  if (mostRecentStr !== todayStr && mostRecentStr !== yesterdayStr) return { best, current: 0 }

  let current = 1
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = new Date(sorted[i])
    const b = new Date(sorted[i + 1])
    const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000)
    if (diff - 1 <= maxRestGap) current++
    else break
  }

  return { best, current }
}
```

When `maxRestGap = 0`, `diffDays - 1 <= 0` ⟺ `diffDays === 1` (dates are distinct, so `diffDays >= 1`) — identical to the original behaviour, so `foodStreaks`/`sleepStreaks`/`calorieGoalStreaks` (called with no third argument) are unaffected.

Then update the workout-streak call site only. Current (line 186):
```ts
  const workoutStreaks = computeStreak(workoutDates, tz)
```
Change to:
```ts
  // 1 rest day allowed without breaking the streak — matches the home
  // screen's streak definition (session-select-content.tsx).
  const workoutStreaks = computeStreak(workoutDates, tz, 1)
```

- [ ] **Step 6: Type-check and lint**
```bash
npx tsc --noEmit
pnpm lint
```

- [ ] **Step 7: Verify locally**
`pnpm dev`, log in as `test@local.dev` (seeded with ~9 logged sessions over 1-2 weeks). Open `/session-select` near the start of a month (or temporarily adjust the seed data's dates to straddle a month boundary) and confirm the Streak card and 10-day bar strip reflect training days from the previous month, not just the current month. Open `/achievements` (or wherever achievements render) and compare the workout streak achievement progress against the home-screen Streak card — they should now agree (both apply 1-rest-day tolerance). Confirm `food_streak_7`/`sleep_streak_7`/`calorie_goal_7` progress is unchanged from before this task (still strict back-to-back days).

- [ ] **Step 8: Commit**
```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts app/api/streak-data/route.ts app/session-select/session-select-content.tsx app/api/achievements/route.ts
git commit -m "Fix cross-month streak data gap and align workout streak definition with achievements"
```

---

## Self-Review Notes

- **Spec coverage:** All 15 tasks from the three pending 2026-06-12 uplift plans are accounted for (Design/Accessibility 1-6, Performance 1-6, Security 1-3), plus all 7 new findings from the follow-up review (Logic Failures A/B combined into New Task AB, Logic Failure C, the chat safe-area gap as New Task D, the activity-screen nav gap as New Task E, the health-content caching gap as New Task 6, and the `ta_wc_*` cache-busting gap as New Task 7).
- **Independence:** Within each batch, no two tasks touch the same file — verified by an explicit file-overlap pass across all 21 tasks. Cross-batch file overlaps (Batch 2↔3: `lib/utils.ts`, `app/health/health-content.tsx`, `lib/stores/activity-store.ts`, repo/adapter; Batch 3↔4: repo/adapter, `lib/utils.ts`, `app/session-select/session-select-content.tsx`) are called out in each affected task's notes, and batches are ordered so the earlier-landing task's anchors are valid for the later one.
- **Type consistency:** New Task 6's `cachedFetch` generics reuse the exact existing response types (`TrainingLoadResponse`, `SleepCorrelationResponse`, `WeeklyStatsResponse`, `ProgramSession`). New Task AB's `getRecentTrainedDays` return type matches `getCalendarData`'s `trainedDays` shape exactly, so merging into `calendarDays` (`Record<string, string[]>`) requires no transformation. `computeStreak`'s new `maxRestGap` parameter defaults to `0`, preserving the exact original behaviour for all call sites except the one explicitly updated.
- **No placeholders:** every new task shows exact before/after code, exact file paths/line numbers, and concrete verification steps; existing-plan tasks point to the already-detailed steps in their source files rather than duplicating them.
