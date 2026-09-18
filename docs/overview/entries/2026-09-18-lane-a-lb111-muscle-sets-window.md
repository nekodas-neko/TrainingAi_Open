# 2026-09-18 — LB-111: sets per muscle over a window, and the premise that had to be checked first

**Branch:** `lane-a/lb111-muscle-sets-window` · **Lane A** · no migration · unversioned (nothing calls it yet)

## What shipped

`GET /api/muscle-sets?from=&to=` → `{ from, to, muscles: [{ muscle, sets }] }`, backed by a new
repository method `getSetsByMuscleInWindow(userId, from, to, tz)`. Both params optional (default: the
trailing 90 days ending today in the user's timezone), both accept slashes or dashes, `to` is
inclusive, 400-day cap, `private, no-store`. Canonical muscle keys, secondary muscles at 0.5.

This is the engine half of OR-118's movement-balance card. Nothing served the number before: every
existing muscle-set route computes the current week server-side and takes no parameters, and
`muscle-tonnage-trend` is windowed but returns tonnage, which is not a substitute — legs move far
heavier loads, so a tonnage share overstates them and hides the pull-set deficit the card exists to
show.

## The entry's premise was wrong in the one place that decides the shape

LB-111 said the work was *"an exposure, not a derivation"*: widen `getWeeklySetsByMuscleGroup`, which
already takes arbitrary dates, and note that *"every route that calls it throws that away —
`weekly-muscle-sets`, `ai-periodization/weekly-volume`, and nothing else reaches it."*

`weekly-muscle-sets` **does not call it.** It carries its own inline SQL and only names the method in
a comment. The method's real callers are `ai-periodization/weekly-volume` and
`packages/shared/src/ai-periodization/signals.ts` — the second of which the entry does not mention.

That matters because of what else the method does: it scopes to **one `programId`**. LB-111 flagged
the `programId` decision as *"the reason this is not a one-liner"* and recommended counting across
programme changes. Widening the method to do that would have changed what its two existing callers
mean — both grade a week against *that* programme's targets, where scoping is correct. So the
honest answer is a second method, not a widened one.

## Measured rather than argued

The decision is pinned by a test that runs **one fixture through both reads**: two programmes, sets
logged under each, one 60-day window.

| | lats |
|---|---|
| `getWeeklySetsByMuscleGroup(…, newProgramId, …)` | **3** — the previous programme's sets are gone |
| `getSetsByMuscleInWindow(…)` | **7** |

It asserts the old method's behaviour rather than treating it as a defect, because it is correct for
its callers. It is in the file because the next session to read LB-111 will have the same idea.

## The finding underneath it: four copies

Checking the premise turned up the real state of this query. The same "weighted sets per muscle,
library rows by role and non-library rows by tag" SQL is written out **four** times and the copies
disagree:

| | date column | upper bound | programme scope |
|---|---|---|---|
| `getWeeklySetsByMuscleGroup` | `ws.started_at` | yes | **one `programId`** |
| `weekly-muscle-sets` (inline) | `el.logged_at` | **none** | none |
| `muscle-tonnage-trend` (inline) | `el.logged_at` | yes | none |
| `getSetsByMuscleInWindow` (new) | `el.logged_at` | yes | none |

The divergence is invisible from any one file, which is how it lasted: each copy carries a comment
saying it uses the *same main/secondary role weighting as* one of the others, and that part is true —
the 1.0/0.5 is identical everywhere. What differs is which timestamp a set is attributed to and
whether a previous programme counts, and no comment mentions either.

**Filed as LA-118 rather than fixed here**, deliberately, the same call as LA-117 during BF-176: the
extraction touches three live routes and one of them feeds a card, so folding it in would have put
this PR's verification surface across three screens to save one queue entry. LA-118 carries the table
above, the recommendation (extract parameterised on window + optional `programId`, keep
`ws.started_at` only for the programme-scoped caller) and the one thing not to do on the first pass.

`weekly-muscle-sets` having **no upper bound** is the copy that could bite: a log dated in the future
counts toward this week forever. Nothing writes future logs today, and the sync path accepts a
client-supplied `logged_at`, so nothing structurally prevents one. Recorded in LA-118 with a test to
add, not fixed here.

## Verification

`lib/data/postgres/__tests__/muscle-sets-window-route.test.ts`, **12 passing**, against real
Postgres. Mutation pass on the new helper — three mutations applied at once, and exactly the four
predicted cases went red:

| Mutation | Caught by |
|---|---|
| `to` made exclusive | *includes both named days…*, *accepts the slash form…* |
| secondary weight 0.5 → 1.0 | *weights a secondary muscle at half a set* |
| `normalizeMuscle` dropped | *folds synonyms to one canonical muscle* |

The suite also pins 400 on a date-shaped non-day (`2026-02-31`, which reaches the driver as
`[pg 22008]` and is otherwise recorded as a server fault), on a reversed window, and on a span over
the cap; and it accepts the slash form the client's `localDateString()` actually emits, which a
dash-only Zod regex would have rejected before the handler ran.

The **deliberately equivalent control** is *defaults to the same 90-day window an explicit request
would name*: it passes either way by design, and without it a change that broke the defaulting would
still pass every other case, since they all pass dates.

## Not exercised

- **No client calls this route**, so nothing user-visible changed and no version was bumped. The
  render is OR-118's, Lane B's, now unblocked.
- **The S25 device.** Server-only; it reaches the phone through a Railway deploy with no APK.
- **Drifted production data.** The fixtures are locally seeded. The one case worth naming: an
  exercise whose name is absent from `exercise_library` falls to the `muscle_groups` branch, where
  every tagged muscle counts at whole weight because there is no role to weight by. That is the
  existing behaviour of all three sibling queries, copied deliberately, but the local catalogue is
  smaller than production's.
