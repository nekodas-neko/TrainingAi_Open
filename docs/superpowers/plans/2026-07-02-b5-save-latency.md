# B5 — Save-latency fixes (plan 1 of 3)

> Source: `docs/planned_upgrades.md` § B5 "Save latency" (audit 2026-07-02, verified post-#91). One PR. Line refs verified against `main` @ post-#98; re-grep anchors before editing if `main` has moved.
>
> Goal: saves *feel* instant everywhere — UI feedback fires synchronously after the local write, never after `await fetch`. Kills the reported "finished workout doesn't show as complete" lag.

## Task 1 — Completing a workout updates the home screen instantly

**Root cause:** the done-mode flip is already optimistic; the lag is the *home screen after*. `invalidateWorkoutSummaries()` (`lib/cache-groups.ts:4`) clears `ta_sscache:`/`ta_cache:` keys but not the legacy sessionStorage seeds home paints first: `ta_recommendation_v1`, `ta_meta_v1`, `ta_streak_v1`, `ta_calendar_v2_*` (read in `session-select-content.tsx`'s `useLayoutEffect` seed block and in `fetchWorkoutData`). Home re-paints the pre-workout recommendation/week-strip until `/api/next-session` + `/api/calendar-data` round-trip.

1. In `invalidateWorkoutSummaries()`, after the existing group calls, remove the legacy seeds: `sessionStorage.removeItem('ta_recommendation_v1' | 'ta_meta_v1' | 'ta_streak_v1')` and prefix-scan `ta_calendar_v2_` (guard `typeof sessionStorage !== 'undefined'`, wrap in try/catch like the cache helpers).
2. Delete the dead write `localStorage.setItem('ta_complete_…')` (`components/workout-screen.tsx:872`) — no reader exists.
3. **Optimistic completion paint (small, contained):** in `completeWorkout()` (workout-screen), *before* the fire-and-forget POST, write today's completion into the seeds home reads: bump the streak count for today in the `streak-data` cache payload and add today's `{date, sessionName}` to the current month's `calendar-data:` payload via `readCacheSync` → mutate → re-`setCache` (add a tiny `updateCache(key, fn)` helper in `lib/sqlite/cache.ts` if cleaner). If the cached payload is absent, skip — the cleared keys already prevent a *wrong* paint; this step only upgrades "brief skeleton" to "instant correct".

**Verify:** `pnpm dev` → complete a workout against the local DB → navigate home with DevTools offline → week strip shows today completed, no stale recommendation. Grep confirms zero remaining readers/writers of the four legacy keys outside this diff (delete their read sites in `session-select-content.tsx` only if step 3 replaces them — otherwise leave the reads; they now just miss).

## Task 2 — Done screen stops awaiting a live Oura round-trip

`components/workout/done-screen.tsx:59-80`: `loadHr` awaits `POST /api/oura/hr-sync` (live Oura Cloud, seconds) then `GET /api/oura/hr-data`, auto-fired by the `useEffect` at `:80`. The manual retry button already exists at `:249`.

1. Delete the auto-fire `useEffect` (`:80`). The HR card renders its idle state with the existing "Load" button; `loadHr` is unchanged.
2. Keep everything else (calendar save line etc.) as-is — it's non-blocking today.

**Verify:** complete a workout → done screen paints immediately with no "Fetching HR data…" spinner; tapping the button still loads the chart (sandbox: route returns without Oura token — check the error state renders, not a hang).

## Task 3 — Food logging: no serial POSTs before feedback

`lib/nutrition/log-food.ts:161-162`: `for (const entry of entries) { … await createFoodItem(entry) }` — one blocking round-trip per new item *before* any local write or toast, and `food_items` creation has no outbox path (fails entirely offline).

1. **Ship now:** replace the serial loop with a single `Promise.all(entries.map(...))` resolving all missing `foodItemId`s concurrently (keep the existing rollback via the `createdIds` collection at `:226`). One round-trip-time instead of N.
2. **Full offline fix (same PR if it stays small, else its own):** generate client UUIDs for new food items in `log-food.ts`, write them to the local `food_items` table immediately, queue a `food_items` mutation in the outbox, and add the matching `pushMutations` branch (server upsert by id, scoped to `user_id`) + `/api/nutrition/food-items` accepting a client-supplied id. Per the offline-sync rule: update the sync-push branch and the web route **in the same PR**, and register nothing new locally without `RECONCILE_*` entries (table already exists — columns unchanged). Check the current local SQLite version in `lib/sqlite/migrations.ts` before assuming a bump is needed (no schema change expected).

**Verify:** log a 4-ingredient scanned meal on `pnpm dev` → toast appears after one network beat, all items render; with step 2, repeat with DevTools offline → items + logs render locally and sync on reconnect (server half testable locally; native SQLite path is device-only — state this in the PR).

## Task 4 — Web-fallback saves show feedback first

The local-first branches are correct; only the web fallbacks block the toast on the POST:

1. Body metrics — `app/session-select/session-select-content.tsx:942` and `app/health/health-content.tsx:714`: close the sheet / show the toast / apply the optimistic UI value *before* the `await fetch`; on rejection, show an error toast and refetch to reconcile. Keep invalidate-before-refetch ordering.
2. Mood — `components/mood-checkin-sheet.tsx:151`: same feedback-first shape as its local-first branch above it.
3. Workout delete — `app/health/health-content.tsx:609`: stop blocking the "deleting" UI on `await invalidateWorkoutSummaries()`; sequence stays invalidate → refetch, but the sheet closes and the row disappears optimistically first.

**Verify:** with DevTools network throttled to Slow 3G on `pnpm dev` (web fallback active in sandbox since native SQLite is absent): body-metric save, mood save, workout delete each give instant UI feedback; server state confirmed after the round-trip.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`, exercise every touched flow on `pnpm dev` against the local DB before asking to merge.
- Not exercisable in sandbox (declare in the PR): native SQLite outbox path (Task 3 step 2), real Oura `hr-sync` latency (Task 2), on-device WebView timing.
- Version: patch bump (bug fixes for shipped features) + `lib/changelog.ts` entry.
- On ship: tick the four B5 save-latency bullets in `docs/planned_upgrades.md`.
