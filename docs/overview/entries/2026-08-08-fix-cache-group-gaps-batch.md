## 2026-08-08 — five cache-invalidation gaps where a write's own screen kept painting pre-write values (Q-126, v1.270.13)

**Branch:** `fix/cache-group-gaps-batch` · **Domain:** `cardio` / `activity` / `workouts` / `body`

Five independent gaps from the 2026-08-07 full-app review (§3.10–3.12, §4), grouped because four of
them are one- to three-line additions to `lib/cache-groups.ts`.

### (a) Finishing a run or walk left four stat caches stale

`invalidateActivityWrites()` omitted `running-bests`, `run-type-stats`, `walk-segment-stats` and
`cardio-trends` — all four read `activity_logs`, and all four hold for 6 h. Set a 5K PB and the
All-Time Bests card kept showing the old number for the rest of the morning. Added all four.

### (b) Confirming a flagged scale weigh-in invalidated nothing

`components/settings/scale-pairing.tsx`'s `confirmReading` POSTed to a route that performs a real
`body_metrics` weight/composition write (`confirm/route.ts` → `applyScaleReadingToBodyMetrics`), and
the file had no `cache-groups` import at all. The weight card, Progress card and nutrition TDEE
header all kept the previous weight. Now fires the same
`invalidateBodyMetricWrite()` + `invalidateReadinessInputs()` pair a manual metric log uses
(`health-content.tsx:918-926`), **awaited before** the `loadToday()` refetch, per the
invalidate-before-refetch rule.

### (c) Sleep achievements never refreshed

`lib/achievements.ts` computes a sleep streak from `sleep_sessions`, but neither
`invalidateBiometrics()` nor `invalidateOuraSync()` cleared `achievements:`. This is the same gap the
two *"feeds computeAchievements"* comments already close for body-metrics and nutrition — sleep was
missed in that sweep. Added to both.

### (d) Two workout-HR-derived caches were in no group at all

`hr-recovery-profile` and `exercise-hr-trend:<name>` both derive from `set_hr_stats`, which
completing a workout writes, and neither key appeared anywhere in `cache-groups.ts`. Added to
`invalidateWorkoutSummaries()`; the per-exercise one drops by prefix.

### (e) The done screen's "+XP earned" could report the user's entire lifetime XP

`workout-screen.tsx` seeded `xpBeforeWorkout` from `readCacheSync('achievements:<userId>')` and then
computed `xp - (xpBeforeWorkout.current ?? 0)`. That key is **written by exactly one screen**
(More → Profile) but **cleared by five invalidation groups** — logging a meal before finishing a
workout was enough to empty it. The `?? 0` then turned a missing baseline into "you earned all the
XP you have ever earned", celebrating +3,240 instead of +45.

Both call sites now go through one `recordXpEarned()` helper that does both halves the backlog
offered rather than picking one:
- **no baseline → no badge.** The done screen already hides the badge when `xpEarned` is null
  (`done-screen.tsx:363` gates on `!= null && > 0`), so skipping is a clean outcome, not a blank.
- **writes the response back** into `achievements:<userId>` at `TTL_SHORT`, so the *next* session has
  a baseline even if the user never opens More → Profile. That is what stops the gap recurring.

### Verification

- `tsc --noEmit` clean · `pnpm lint` 0 errors · `vitest run` **3236/3237** — the single failure is the
  known seeded-local-DB harness problem in `scale-ble-multi-reading.test.ts` (filed by me as Q-141 — a number already claimed by open PR #1143; correctly refiled as **Q-146**, and since fixed by #1160),
  which reproduces on a clean `origin/main` and does not occur on CI's unseeded database.

### Not exercised

No device run, and — importantly — **none of these five were reproduced end-to-end in a browser.**
Each is an invalidation-list edit whose observable effect needs a real write followed by a
navigation: finishing a run with a new PB, confirming a scale reading (which needs a paired BLE
scale, unavailable in the sandbox), a sleep sync crossing a streak boundary, or completing a workout
with HR data. What was verified is that the keys added match the keys the reading components
actually use — each was grepped to its `cachedFetch`/`readCacheSync` call site — and that the whole
suite still passes. The XP change is the one with real behavioural risk: if `achievements:` is
absent the badge now does not render at all, which is intended but has not been seen on screen.
