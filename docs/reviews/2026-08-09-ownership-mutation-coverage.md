# Ownership scoping: how much of it is actually tested? (2026-08-09)

**Method:** mutation testing, not reading. Every `eq(x.userId, userId)` was rewritten to
`eq(x.userId, x.userId)` — always true, same shape, type-safe — and every raw
`user_id = ${userId}` to `user_id = user_id`. Then the DB suite was run and the survivors counted.

**Scope:** `lib/data/postgres/adapter.ts` + its seven slices. **246 scoping predicates.** Baseline
before any mutation: 71 files, **317 tests, all green, 80 s**.

> The scoping is **correct today** — this is not a report of a live leak. The finding is that almost
> none of it is *held in place* by anything, in the highest-severity bug class this project has.

---

## 1. The headline

Neutralise **all 246** predicates at once — every ownership check in the data layer gone — and:

**286 of 317 tests still pass.** 31 fail, across ~14 files.

So **90% of the DB suite is blind to a total loss of user scoping.**

And the 31 that fail are not all doing what they look like. Re-running produced a *different* failing
set each time (14–17 files): with scoping gone, tests contaminate each other's rows depending on
execution order. Much of that 31 is **incidental interference, not a deliberate ownership
assertion**. Only two files are named for the property at all — `phase-set-ownership.test.ts` and
`oura-clock-anchor-scoping.test.ts`.

Supporting count: of 71 DB test files, **7 set up two users at all**.

## 2. Per-file: three slices are completely unguarded

One file mutated at a time:

| file | predicates | tests failed |
|---|---:|---:|
| `adapter.ts` | 139 | 23 |
| `slices/oura.ts` | 33 | 10 |
| `slices/programs.ts` | 29 | 5 |
| **`slices/nutrition.ts`** | **22** | **0** |
| `slices/periodization.ts` | 18 | 2 |
| `slices/user-stats.ts` | 3 | 3 |
| **`slices/body-battery.ts`** | **1** | **0** |
| **`slices/social.ts`** | **1** | **0** |

**Every ownership check in `nutrition.ts`, `body-battery.ts` and `social.ts` can be deleted and the
suite stays green.**

## 3. Two whole quartiles of `adapter.ts` are the same

Splitting `adapter.ts`'s 139 predicates into quarters by occurrence order:

| range | predicates | tests failed |
|---|---:|---:|
| [0, 35) | 35 | 5 |
| **[35, 70)** | **35** | **0** |
| [70, 105) | 35 | 14 |
| **[105, 139)** | **34** | **0** |

**Lower bound: 93 of 246 predicates (38%) are provably unguarded** — 69 here plus the 24 in §2. It
is only a lower bound: the quartiles that *did* fail contain mostly-unguarded predicates too (35
predicates producing 5 failures is not 35 covered predicates).

## 4. What is in the uncovered set

53 methods hold those 69 `adapter.ts` predicates. The ones that matter most:

**Destructive writes with no ownership test at all** — `deleteActivityLog`, `deleteFitnessTest`,
`deleteInjury`, `deleteSupplement`, `unlogSupplement`, `updateActivityLogMetrics`, `updateInjury`,
`updatePrescribedRun`, `updateSupplement`, `updateGoalRecommendationStatus`.

**Bulk mutations**, where a scoping slip is silent and irreversible — `applyLbsToKgFix`,
`previewLbsToKgFix`, `reconcilePersonalRecord`.

**`updateInjury` is the one to notice.** CLAUDE.md names it *"the reference"* for the write-path
ownership rule (Zod-whitelist every PATCH body). The reference implementation for an ownership rule
had no test of its ownership scoping.

And in `nutrition.ts` (§2), the uncovered 22 include `updateFoodLog`, `deleteFoodLog`,
`writeSavedMeal`, `deleteSavedMeal`, `updateMealType`, `deleteMealType`, `reorderMealTypes` —
`updateSavedMeal` being the exact method CLAUDE.md cites for the cross-user-wipe class
(a 0-row user-scoped UPDATE followed by an unscoped child `DELETE … WHERE parent_id = id`).

## 5. What shipped first

`lib/data/postgres/__tests__/repository-ownership-scoping.test.ts` — initially 9 tests over injuries,
supplements, activity logs, mood logs and body battery, covering both reads and destructive writes.
Verified **both directions**: 9/9 pass on clean code, **9/9 fail** when the predicates are
neutralised. Extending it is a one-line row in `READERS` or one `it(...)` block.

**Two of those nine could not fail when first written**, and the mutation run is the only reason
that is known:

- `getBodyBatteryHistory` maps rows to a shape with **no `userId` field**, so
  `expect(...).not.toContain(USER_B)` was unfalsifiable. It survived the run that killed the other
  eight. Now asserts emptiness — `USER_A` is created fresh and owns nothing, so any row is a leak.
- The body-battery assertion had **no seeded B row** to leak in the first place.

That is the same lesson as the rest of this session, and it applies to the tests being written to
fix the problem just as much as to the code: **a test that has never been observed failing is not
evidence of anything.** Any addition here should be checked by mutation before being counted.

## 6. Burn-down, same day

The uncovered slices were then covered and re-measured with the same harness. `repository-ownership-scoping.test.ts` grew from 9 tests to **30**, each verified to fail under mutation.

| target | tests detecting, before | after |
|---|---:|---:|
| **all 246 predicates at once** | **31** of 317 | **70** of 357 |
| detecting test *files* | 14 of 71 | **20 of 72** |
| `adapter.ts` alone | 23 | **42** |
| `slices/nutrition.ts` | **0** | **12** |
| `slices/body-battery.ts` | **0** | **1** |
| `slices/social.ts` | **0** | **2** |

**No slice is at zero any more.** Of the +39 detecting tests, 30 are the new file directly; the rest
sits inside the run-to-run variance of the interference failures described in §1, so it should not be
read as newly-covered behaviour.

Two cases needed a specific shape to be falsifiable at all, and are worth copying:

- **`deleteMealType`** throws `MEAL_TYPE_HAS_LOGS` *before* reaching the ownership check, so testing
  it against a meal type that has logs passes whether or not the scoping exists. It needs a
  second, log-free meal type.
- **`listSeasonsWithResults`** reads a **global** `seasons` table and scopes only the nested
  `season_results`. A leak does not add a row — it attaches B's rank and badge to a season A can
  legitimately see. The assertion has to be on the nested `result`, never on the row count.

## 7. Third pass: the bulk mutations, and no range left undetected

The bulk mutations and the remaining named write methods were covered too — `previewLbsToKgFix`,
`applyLbsToKgFix`, `reconcilePersonalRecord`, `updateActivityLogMetrics`, `updatePrescribedRun`,
`updateGoalRecommendationStatus`. The file is now **36 tests**, all verified failing under mutation.

| target | original | after §6 | now |
|---|---:|---:|---:|
| all 246 predicates at once | 31 of 317 | 70 of 357 | **75 of 363** |
| detecting test *files* | 14 of 71 | 20 of 72 | **21 of 72** |
| `adapter.ts` alone | 23 | 42 | **44** |
| `adapter.ts` quartile [0,35) | 5 | — | **8** |
| **`adapter.ts` quartile [35,70)** | **0** | — | **13** |
| `adapter.ts` quartile [70,105) | 14 | — | **17** |
| **`adapter.ts` quartile [105,139)** | **0** | — | **7** |

**Every quartile and every slice now detects a mutation.** The "93 of 246 provably unguarded" figure
from §3 is measured by exactly this method, and by that measure the provably-unguarded set is now
**empty**. That is emphatically *not* "all 246 are covered" — the bisect bounds, it does not
attribute, and a range producing 7 failures is not 34 covered predicates. It means the method that
found the gap can no longer find a hole in it, which is a weaker and more honest claim.

Two more assertions that could not fail, both caught the same way:

- **`updatePrescribedRun`** only ever writes `status` and `updated_at`. Asserting `run_type` was
  unchanged could never fail, and it survived the run that killed the other 35.
- **`previewLbsToKgFix`** returns one `exercises` summary per **requested** name, derived from the
  argument rather than from stored rows — so it is length 1 even for a user with no data, and
  asserting it empty **fails on clean code**. The real leak channels are `logs` and the
  `oldPersonalRecord` lookup (B holds a 999 kg PR for that exercise, so an unscoped read surfaces it).

That is **six** unfalsifiable assertions in one file, every one found by running each new test under
mutation as well as clean. The rate is the point: writing an ownership test that cannot fail is the
*expected* outcome, not an unlucky one.

## 8. Limits

- **DB suite only** (`lib/data/postgres/__tests__`, 317 tests), not the full ~3,270-test suite. Route
  and component tests could catch some of this; nothing here says they don't.
- Quartile bisect gives a **lower** bound on uncovered predicates, not an exact count. Exact
  attribution needs 246 individual runs (~5.5 h at 80 s each).
- The mutation only neutralises `user_id` predicates. Ownership enforced another way — a join to an
  owning table, a pre-check like `ensureWorkoutSession` — is untouched and unmeasured here.
- Local Postgres only. No device, no APK, no production data.

---

## 9. The blind spot: ownership by join or pre-check

The mutation method above neutralises `user_id` predicates, so it is **structurally blind** to
ownership enforced any other way — a join to an owning table, or a pre-check before the write. That
is CLAUDE.md rule (c): *"client-supplied row ids in upserts must be ownership-verified even when the
table has no `user_id` column."* Twenty-one tables have no `user_id` column, so this is not a corner.

That surface needs a **static audit**, not a mutation — a missing check is an absence, and there is
nothing to neutralise. All **50** writes (INSERT/UPDATE/DELETE) to `user_id`-less tables across
`adapter.ts` and its slices were enumerated and classified:

| ownership evidence in the statement | count |
|---|---:|
| `user_id` present in the statement | 12 |
| parent/own id only — needs a prior check | 14 |
| `inArray` over a pre-scoped id list | 1 |
| none in window (all INSERTs, safe if the parent id was checked) | 23 |

**The 14 parent-id-keyed writes were read individually, and 13 are correct.** `saveProgram`,
`saveProgressionStyle` and `updatePhaseSet` each do a user-scoped statement first and **guard on the
affected-row count** before touching children — `if (updated.length === 0) throw` — with comments
naming the hazard and citing Q-129. The `activity_types` methods look unscoped because the table is a
deliberately **global catalogue**, and every route reaching them is behind `requireAdmin`. This is
the rule working.

**The exception is the volume-target family** — filed as **Q-174**. `listVolumeTargets`,
`upsertVolumeTarget`, `deleteVolumeTarget` and `replaceVolumeTargets` all take a `programId` and **no
`userId`**, and `program_volume_targets` has no `user_id` column, so ownership lives entirely in the
caller with nothing in the signature to say so. `replaceVolumeTargets` is an unscoped
`DELETE … WHERE program_id = $1` plus re-insert — the same shape as the `saveProgressionStyle`
incident. It is **safe today**: the only caller passes an id from the user's own `saveProgram`, and
two of the four methods have **zero callers at all** — dead code with an unscoped signature, which is
what the next feature reaches for.

**Method note.** The first scanner written for this returned **zero** hits, which a raw
`grep -c` immediately contradicted: the regex had been built by string concatenation inside
`node -e` and the escaping was wrong. A scanner reporting a clean result is the easiest thing in this
whole exercise to believe and the hardest to notice — cross-check every "nothing found" against a
cruder tool before writing it down.
