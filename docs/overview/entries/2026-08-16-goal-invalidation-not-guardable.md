# 2026-08-16 — the guard that cannot exist

Q-259 asked for the Q-240 regression guard that `goal-round-trip.spec.ts` failed to be. It was built.
It does not guard Q-240 either — and the reason is structural rather than a third mistake, which
makes the measurement more useful than the test would have been.

## What Q-259 got right, and what it got wrong

Right: **the steps goal is the correct probe.** The water-goal version failed because Health falls
back to a `localStorage` device copy for water, target weight and target body fat, and the goals UI
writes that copy synchronously — masking exactly the server-cache staleness Q-240 is about.
`STEPS_GOAL_KEY` is written too, but it is read by *Home*, never by Health: `useGoalSeeds` seeds only
the other three. So Health's steps number comes from `userGoals` alone, with nothing to hide a stale
cache.

Wrong: **the seed work it specified was unnecessary.** The entry said
`scripts/local-db/seed.sql` "does not guarantee a steps or calorie value for today". It does —
`body_metrics` is inserted for `current_date - d`, d in 0..13, so today carries steps 8000 and
calories 2400, which is what makes the `goalsProgress` rows render at all (`visibleRows` filters on
`value != null`). Half the queued work did not exist.

## Why no guard is possible here

Deleting Q-240's fix — `.then(res => invalidateGoalRecommendations())` in `goals-section.tsx` — left
the new spec **passing**. Two measurements explain it, and neither is about the goal chosen:

**The settled value is correct either way.** `cachedFetchCore` paints the cached value through
`onData(cached)` and then *always* proceeds to the network fetch, unless the call site passes
`freshWithinTtl`. `user-goals` does not pass it. So the cache is a first-paint accelerator here, not
a short-circuit — invalidating it cannot change where the screen ends up.

**The stale flash is identical too.** Sampling the DOM every 100 ms across the return trip, with and
without the invalidation:

```
without:  ["8,000 / 7,000 ✓", "8,000 / 9,000"]
with:     ["8,000 / 7,000 ✓", "8,000 / 9,000"]
```

The old value paints briefly in both cases, because the first paint on a **tab re-entry** comes from
Health's retained React state — the tabs stay mounted — not from the cache. Clearing a cache cannot
change what component state already holds.

So on this screen `invalidateGoalRecommendations()` has **no observable effect on the goal at all**.

## What that says about Q-240

Q-240's entry described the impact as *"change a goal, open Health, and it renders the old one for 30
minutes."* That framing assumed the cache short-circuits the fetch. It does not, so the 30-minute
claim was never right for this path.

The genuinely persistent staleness — the one an owner could actually hit — was **Q-260**: `user-goals`
fetched only by the Progress tab's group while the water goal rendered on Body, so nothing re-read it
at all. Different mechanism, fixed yesterday. The two were easy to conflate because the symptom is
identical, and conflating them is what produced two false guards in a row.

## What shipped

`e2e/goal-invalidation.spec.ts`, relabelled to what it actually proves: a steps-goal edit reaching
Health's Progress panel **client-side**, with no reload. That is the Q-260 shape on a panel no other
spec exercises, using a goal with no device copy. Mutation-verified both ways —

| Mutation | Result |
|---|---|
| baseline | 2 passed |
| steps PATCH suppressed | **1 failed** |
| Health drops the `user-goals` payload | **1 failed** |
| restored | 2 passed |

— and its header carries the Q-240 measurement, so the next person does not start from the premise
that burned two attempts.

The return trip is deliberately client-side. `page.goto('/health?tab=progress')` is a full document
load that remounts and refetches unconditionally, which would have passed regardless — the trap the
first version fell into.

## Filed

**Q-262** — is `invalidateGoalRecommendations()` doing anything, for any of its six keys? One key is
now measured inert, and the reason is general: invalidation only matters where a call site passes
`freshWithinTtl` or a read path never revalidates. CLAUDE.md treats missed invalidation as the most
repeated bug class here, so these calls are added defensively and never audited for effect. Worth
knowing which are load-bearing rather than assuming all of them are.

## Verification

`npx tsc --noEmit` · `pnpm lint` 0 errors · `pnpm build` · `pnpm check:rules` **Ran 36 of 36** ·
unit suite · full E2E cold on a fresh database with `--retries=0`. No version bump — test and docs
only, nothing user-visible.

Not device-verified and does not need to be: this adds one browser spec and documentation, and
touches no runtime code.
