# Cat collection rules v2: four classes, merge-3, a drain that movement counteracts

**Status:** planned, not built. Engine half is PS-49 (Lane A). Owner questions still open are PS-48
(Lane O). Art shipped with BF-126 (2026-09-26); the Android home-screen widget is PS-50.
**Source:** the owner's brief in the BF-126 art session, 2026-09-26, quoted where it decides
something.

## What changes, in one paragraph

Today there are three ladders of three tiers (`packages/shared/src/collection/ladder.ts`). Each
*recorded day* spawns one bottom-tier cat, merges cost 5 or 7 then 4, and decay fires only for gap
days past an allowance. v2 has **four classes, five tiers, three-to-one merges, and a bank of
activity units that drains every day**. Movement adds to the bank faster than the drain takes it
away. The replay architecture does not change: still no game-state table, still a pure fold over
immutable day series.

## The four classes

| Class | Faucet | MMO role | Art (`public/cats/`) |
|---|---|---|---|
| Tank | workouts | tank, "strong, getting bulkier" | `tank-1..5.svg` |
| Ranger | steps | ranged DPS, "fast" | `ranger-1..5.svg` |
| Rogue | cardio (runs/walks, Cardio hub) | melee DPS, "fast as well" | `rogue-1..5.svg` |
| **Health cat** (Cleric art) | health logging: sleep, nutrition, weight | healer, *"so you are more inclined to track/sleep well"* | `cleric-1..5.svg` |

Steps and cardio stay **separate** (owner, 2026-09-26). Steps are passive and all-day, while cardio
is a deliberate session. Combined, ~5,600 background steps a day would drown out the runs.

## The mechanic

**Units and the bank.** Each class has a unit: steps for the Ranger, sessions for the Tank. The bank
is a running balance in that unit, and the number of T1 cats held is `floor(bank / unitsPerT1)`.

**Drain is constant, every day, and movement counteracts it** (owner: *"it should always drain; and
it just gets counteracted by movement … if I make 5000 steps in the day its an effective 4000
profit"*). This deliberately reverses v1's rule that only gap days decay. Each day:
`bank = max(0, bank + gained(day) − drainPerDay)`.

**Merges are 3 → 1 at every tier** (owner: *"the next amount creates 2 mini sprites; and then at 3
they merge into a large sprite (t2), and this will repeat"*). Held cats are therefore the base-3
digits of the T1 count, so the stock is **derived from the bank rather than stored**. That makes
decay automatic and matches the owner's description: *"it takes away a t1 worth, until its low
enough that the t3 splits back into t2's"*. A T3 splits exactly when the bank crosses a multiple of
27 T1s. v1's `settle`/`decayOnce` pair is replaced by one base conversion, which cannot disagree
with itself.

**Starting numbers** (the owner calls them provisional: *"not sure the exact number we'd need to
test"*):

| Class | unitsPerT1 | drainPerDay | Source |
|---|---|---|---|
| Ranger | 5,000 steps | 1,000 steps | owner, 2026-09-26 |
| Tank | 1 workout | 1 / rest target (owner's is 3 days, so ⅓ of a workout a day) | owner: *"every 3 days = 1 t1 workout loss"* |
| Rogue | **open (PS-48)** | **open** | proposal: 1 session = 1 T1, drain ⅕/day |
| Health cat | 3 points | 1 point | owner set the faucet 2026-09-26; the numbers are this plan's proposal |

**The Health cat's points** (owner: *"it should give points for either sleep/nutrition/weight
logged etc."*). Each day scores one point per category that has data: sleep recorded, at least one
food log, and a weight entry. More categories can be added (mood, supplements), and every one
added makes a T1 cheaper, so add them deliberately. A fully logged day is 3 points = 1 T1, and the
drain is 1 point a day, so logging two of the three each day keeps it level. *"Sleep well"*, as
opposed to sleep recorded, would mean a bonus point for sleep inside the user's usual window.
That is left out until the owner asks: it scores sleep quality, which is Tuning's territory, not a
logging count. All three reads are one column wide, per RV-63.

The Tank's rest target comes from `maxCompliantRestGap(program)`, which the route already reads.
Fractional drain means the bank is fractional, so keep it in exact units (thirds of a workout,
whole steps) rather than floats. A float bank that reads 2.9999 floors a T1 away.

**Tier cap: T5** (recommended in PS-48). Five drawn tiers exist, T5 = 81 T1s, and T5s accumulate
beyond that (the card shows "×2"). Uncapped base-3 would need a T6 at 243 T1s with no art for it.

## What this rewrites, and why a replay makes that fine

`ladder.ts`'s own docblock warns that changing a threshold *"retroactively rewrites history — a
Tank earned last month silently un-merges"*. v2 is that rewrite, deliberately, at the owner's
request. Because nothing is stored, **there is nothing to migrate**: bump
`COLLECTION_RULES_VERSION` to 2 and every read replays full history under v2. No per-span
versioning (the "effective-from date" the docblock describes) is needed, unless the owner wants
v1-era cats preserved. PS-48 asks him, with the recommendation to re-score from scratch, because
v1 has been live for about two weeks.

## Build order (PS-49)

1. `ladder.ts`: new `replayBank({ days: Map<date, units>, unitsPerT1, drainPerDay, today, cap })`
   returning `{ t1Total, stock: number[5], drainedDays }`. Keep the v1 function until the route is
   switched, then delete it (one formula, one place).
2. Faucet reads: steps need **per-day totals** (`listStepDayKeys` returns dates only; add a
   `listStepTotals` that is still one column wide, per RV-63). Workouts reuse `listTrainedDayKeys`.
   Cardio and tracking wait on PS-48.
3. `app/api/collection/route.ts`: return all four classes (cardio and tracking as `null` until
   their faucets exist) plus `rulesVersion: 2`.
4. Surface (Lane B): `collection-summary.ts` sentence builders, the card, the collection screen and
   its Rules section. The copy must quote the engine's constants, as it does today. Use
   `CatSprite`, which already renders five tiers per class.
5. **Measure the owner's own result before merging** and put it in the PR. The owner asked for
   this: *"you will need to see how many I end up with after calculating breaks etc."* A rough
   figure from the 2026-09-07 numbers (130 step-days, mean 5,646) gives the Ranger about 120 T1s
   net, which is 1×T5 + 1×T4 + 1×T3 + 1×T2 in base 3. **That is an estimate from stale aggregates,
   not a measurement.** The PR carries the real replay over production day totals. The workout
   figure depends on the span of the owner's 110 training days and was not computed.

## Not in scope here

- The Android home-screen widget: PS-50, Kotlin, needs an APK.
- LA-76 (deload phase dating) is independent and stays Lane A's. Under a constant drain the
  deload question changes shape (is a deload week drain-free?), and that belongs in LA-76's own
  owner question, not here.
