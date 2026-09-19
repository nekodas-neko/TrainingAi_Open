# 2026-09-19 — BF-177: "kcal left" stood still while the ring moved

**Lane B.** Branch `fix/bf177-kcal-left-stale-after-log`, v1.459.1.

## The report, and why the obvious fix was already in place

Owner: *"The kcal left in the top right; doesnt load on the same page: it requires page switching to
show. Probs needs some sort of cache bust after logging food so it updates."*

**That cache bust already existed.** `logFoodEntries` calls `invalidateNutritionWrite()`, which
clears `energy-balance:`. The key was evicted correctly on every single food log. This is the Q-402
shape CLAUDE.md already names — *invalidating a key and re-rendering the component that reads it are
two different things* — so a second invalidation would have changed nothing.

What actually happened: `handleFoodLogged`'s optimistic branch appended to `logs` and returned.
`energyBalance` still held the object fetched before the meal, so the card rendered a live ring
against a pre-log payload. Switching tabs re-ran `fetchData`, which refetched the now-evicted key.

## Three sites, not two

BugFix named `handleFoodLogged` and flagged `handleQuickEditSaved` as "the obvious twin". The sweep
found a **third**: the delete path's `refreshAffected` refreshes the log list and the weekly summary
and *not* the balance, so deleting a food entry left the same number stale. All three refetch now.

## The trap, avoided

Deriving `remaining` client-side looks like the one-line fix. `remainingKcal` is `-deviationKcal`,
and `zoneLabel`, `zoneColor` and the bar all come off that same number. Making only the figure live
would print "871 kcal left" beside a band and a bar that had not moved — one visible disagreement
traded for a subtler one. The refetch moves all four together.

Equally, the refetch is **balance-only, not `fetchData`**: that would re-fetch the list just appended
to optimistically and can clobber or flicker the row being looked at.

**Accepted and stated rather than designed around:** the ring updates instantly and "kcal left" lands
a round trip later. The budget half genuinely comes from the server, and that gap is far smaller than
waiting for a tab change.

## Extracted, because the file was at its ceiling

Inlining the reasoning took `nutrition-content.tsx` to **811 lines against the hard 800 limit** and
failed `check-component-size`. The refetch and its rationale now live in
`app/nutrition/use-energy-balance-refetch.ts`; the screen is 789. That is the house rule working —
*extract into a child instead of appending* — enforced by the gate rather than remembered.

## The control

`e2e/bf177-kcal-left-updates-after-log.spec.ts` logs a known 250 kcal item and reads the card
**without navigating** — anything that leaves the screen re-runs `fetchData` and passes against the
unfixed component, which is the vacuous shape this repo has paid for before.

With the refetch removed, the spec reports **`kcal left went 1810 → 1810`**. That is the owner's
report reproduced exactly, in one line of test output.

## Not exercised

**The device.** BugFix's reason stands and is better than a generic one: the optimistic-append timing
is what decides whether the round trip *feels* instant, and a browser can only show the arithmetic.

**Two further `energy-balance:` readers were seen and deliberately not swept** —
`app/health/day/day-detail-content.tsx:122` and
`components/nutrition/end-of-day/day-read-through-section.tsx:37`, both hand-rolled `cachedFetch`.
Neither is mounted during a Nutrition-tab log, so neither is this report. Recorded in the entry
rather than left as an implied clean sweep. Home *is* clean: `useEnergyBalanceToday` uses
`useCachedValue`, which subscribes to invalidation — Q-402's fix, doing its job.
