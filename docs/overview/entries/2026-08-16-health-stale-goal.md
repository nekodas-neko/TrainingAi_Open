# 2026-08-16 — the goal Health could not see

Q-260, found by the E2E harness two days after the harness itself landed, and fixed here. v1.317.2.

## The bug

Change your water goal on More, tap Health, and Health shows the old goal — indefinitely. Measured
at the moment of the stale render: `GET /api/user/goals` returned the new value, the
`ta_cache:user-goals` entry held the new value, and the `ta_water_goal_ml` device copy held the new
value. Every source of truth correct, the screen wrong, for 120 seconds across repeated tab
re-entries.

## The cause, which is narrower than it first looked

Two facts that are individually reasonable and jointly a bug:

1. **`user-goals` was fetched by `fetchProgressHealthData`** — the Progress tab's group.
2. **The water goal renders in `waterIntake`, which is a `BODY_GROUPS` card** — the Body tab.

So a value displayed on one tab was fetched only by another tab's group. On its own that would still
self-heal on the next mount; what makes it permanent is the third fact, documented in
`useTabVisibility`'s own header: **all five tabs stay mounted for the life of the app.** A
`useEffect(…, [])` therefore runs once per app launch. Health had no reason to re-read the goal, ever.

That is why this survived Q-240. Q-240 was *"the cache is stale"* and was fixed by adding an
invalidation. This is *"the screen never re-reads a cache that is already correct"*. Fixing one could
not have fixed the other, and the shared symptom is exactly what made it look like a regression of
the same bug.

## The fix

- `user-goals` moved from `fetchProgressHealthData` to `fetchSharedHealthData`, which already
  re-runs on `tabEpoch`. It feeds `waterIntake` on Body **and** `goalsProgress` on Progress, so
  shared is where it belonged for both.
- The localStorage first-paint seed moved into `app/health/use-goal-seeds.ts`, which re-reads on
  `tabEpoch` rather than on mount alone. That is the path that matters before `userGoals` loads, and
  the goals UI writes those keys synchronously on every keystroke.
- `fetchProgressHealthData` is down to one fetch, so its `runWithConcurrency` wrapper went with it.

## Verification — the part that matters

`e2e/goal-round-trip.spec.ts` **lost its `page.reload()` workaround**, as the Q-260 entry required.
Without that removal the spec would have gone on passing whether or not the bug was fixed, which is
the whole reason the entry insisted on it.

| State | Result |
|---|---|
| Fix applied | **2 passed** |
| `health-content.tsx` reverted to `main` | **1 failed** |
| Restored | **2 passed** |

The extraction into `useGoalSeeds` happened *after* that first proof, so the full
fix/revert/restore cycle was re-run against the final code and gave the same answer. Full E2E suite
green cold on a fresh database with `--retries=0`: **7 passed**.

Also `npx tsc --noEmit` · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 36 of 36** · unit suite
**478 files / 3,939 tests**.

## A note on the size gate, because it shaped the diff

The first version of this fix pushed `health-content.tsx` from 929 to 941 lines and
`check-component-size.js` failed it. The baseline is shrink-only, so raising it was not an option —
correctly, since this file is a known hotspot. The gate is what turned "add a comment and move a
fetch" into extracting `useGoalSeeds`, which is the better shape anyway. The file is now **911
lines** and the baseline was lowered to match.

## What this does NOT cover

Not device-verified: no device in session. The fix is pure client-side data flow with no native
surface, so the sandbox browser is a fair test of it — but the S25 is still where tab-mount
behaviour under the real shell is authoritative, and this was exercised in Chromium.

**The sibling surfaces are not audited.** `targetWeightKg` and `targetBfPct` come through the same
seed/`userGoals` pair and are fixed by the same change, but any *other* screen that reads a value it
does not re-subscribe to has this exact shape and was not swept. That is a real gap, and the class —
mount-scoped state on a screen that never unmounts — is worth a broader look than this fix gave it.
