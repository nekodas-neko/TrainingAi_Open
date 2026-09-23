# 2026-09-23 — RV-106 / RV-107 / RV-109: three surfaces that never asked again (`fix/rv106-rv107-rv109-stale-surfaces`)

Batch `stale-surface-subscribe`, all three from Review sweep 53, all three the Q-402 shape: the
write group cleared the key and nothing re-rendered. **No fix here adds an invalidation** — every
key involved was already being cleared, and was verified to be, in the same PR.

Each card is a `cachedFetch` inside an effect with stable deps, mounted inside the persistent tab
shell. That shape never re-runs, so the value it painted at launch is the value it keeps.

## What changed

| Entry | Surface | Keys now subscribed | Cleared by |
|---|---|---|---|
| RV-106 | `components/health/hr-day-card.tsx` | `oura-hr-day:`, `workout-sessions-day:` | `invalidateOuraSync`, `invalidateWorkoutSummaries`/`invalidateExerciseLogged` |
| RV-107 | `app/nutrition/use-nutrition-targets-refresh.ts` (new) | `nutrition-targets` | `invalidateGoalRecommendations` |
| RV-109 | `components/health/activity-history-card.tsx` | `activity-logs`, `activity-types` | `invalidateActivityWrites`, `invalidateActivityTypes` |

All five keys were checked against `lib/cache-groups.ts` rather than assumed, and the test asserts
both halves — the surface subscribes it **and** a group clears it. Either alone is a subscription to
something that never fires, or an eviction nobody listens for.

## Three things worth keeping

**RV-106's open question is answered.** The entry left it untraced whether `useStressDay(today)` in
the same card shared the gap. It does not: it goes through `useCachedValue`, which already
subscribes. That makes it the reference for why the other two reads in that file were the broken
ones, and it is asserted so it stays that way.

**RV-107 had two identical fetch expressions for one key.** `TdeeAdaptationCard`'s `onApplied`
refetched `nutrition-targets` by hand — one write path fixed site-by-site while its siblings were
not, the same pattern BF-177 was patched with three times. Both now go through the hook, so the key
has one expression (the TTL-divergence rule) and future write paths are covered without being
remembered.

**RV-109's `activity-types` passes `freshWithinTtl: true`,** which makes its invalidation
load-bearing in the strict Q-262 sense: the cached entry is a *settled* value that survives until
something clears it, not a first-paint accelerator the next revalidation would correct anyway.

The hook kept for targets is deliberately separate from RV-104's `useNutritionDerivedRefresh`:
that one belongs to `invalidateNutritionWrite`, this one to `invalidateGoalRecommendations`.
Bundling them would make a food log refetch the targets and a target edit refetch the weekly chart,
and would hide which write each subscription protects against.

Two dead `.catch(() => {})` chains on `cachedFetch` went with the restructuring (RV-84 — it never
rejects). The local-store `.catch` in the activity card stays: `store.getActivityLogs` genuinely can
reject, and the test asserts the `cachedFetch`-specific shape rather than "no empty catch anywhere",
which is what a first, too-broad assertion got wrong.

## Why there is no e2e spec here

Driving a real targets write means navigating to Profile — and **whether that navigation unmounts
the tab shell is itself an open finding (RV-110: 37 cross-tab `router.push` sites tear it down).**
A green spec could pass for the wrong reason (the shell remounted, which is exactly how RV-109
describes `/activity` self-healing) and a red one would not say which defect it had found. So the
pins here are unit-level, and **RV-124 — #1418's device probe — is the thing that settles this
class by measurement**, RV-106, RV-107 and RV-109 among them.

What was exercised: `Ran 75 of 75`, tsc clean, 652 tests across the touched areas, and both Health
and Nutrition rendered authenticated under the e2e harness with `/api/activity-logs`,
`/api/activity-types` and `/api/nutrition/targets` all answering 200 from the restructured reads.
RV-104's spec still passes against RV-107's edits to the same file.

## Not exercised

Native SQLite / Capacitor (the web path takes the API fallback), safe-area, Samsung WebView,
drifted production data, real ring sync. **No device sitting** — and per #1417 those are the Device
Verification agent's to run; this PR's job is to record them so `next-item.js --sittings` finds them.
