## 2026-07-28 — Q-5: the earned record and the typed estimate were the same column

**Branch:** `fix/personal-records-log-derived` · v1.231.0 · Q-5 structural half; §2.5 deferred as Q-5b

### The conflation

`personal_records` served two different facts: an **earned all-time best**, and a **starting 1RM the
user typed into the builder**. Every symptom followed from that.

- The builder's own copy — *"Enter your 1RM for each main lift to pre-seed working weights"* — has
  never been true. The seeded value went into `personal_records`, but `session-data.ts` sets
  `estimated1rm` from the last log alone and never consults `prMap` (which it reads two lines later
  for the PR badge). With no prior log, `computeInitialWeights` fell through every branch to a
  hardcoded `return 60`.
- Reviewing a program rewrote real records, through `upsertPersonalRecord` — the unconditional
  variant, no `IfBetter` gate, no validation, `achievedAt = now`.
- Three weight paths had each invented their own basis: the last log (`session-data`),
  `max(lastLog, PR)` (`next-session/prescription`), and a third for the bodyweight rep basis. So the
  done-screen "next workout" card and the session it previewed could show **different weights for
  the same exercise** — a One-Formula violation in the most visible place in the app.

### What shipped

- **`exercise_estimates`** (migration 159) holds what the user typed. `personal_records` is
  log-derived only, per the owner's decision. Additive — nothing rewritten.
- **`resolveWorkingBasis`** in `lib/1rm.ts`, called by all three sites. Takes the last log, the typed
  estimate and the PR, returns the max — or **null**, never a constant.
- **`POST /api/exercise-estimates`** replaces `POST /api/personal-records/seed`, with a Zod schema
  (the body was previously unvalidated — only `Number.isFinite`-checked inline).
- **`upsertPersonalRecord` removed from the repository interface** so no route can reach the
  unguarded path again. It survives as an adapter internal because `reconcilePersonalRecord` calls
  it *after* deriving the value from logs — the grep the plan asked for found that caller, so
  deleting it outright would have broken the correct path.
- **`baseline/complete`** reads both stores, tagging `source: 'estimate' | 'existing'`. Without this
  the skip-baseline flow was unreachable for exactly the new users it exists for.
- **Migration 160** regenerates the `claude_ro` views for the new table (the schema is default-deny).

### Verification

Full suite **2,517 passing** — the 20 remaining failures are the pre-existing `claude_readonly`
connection tests. `tsc`, lint, `check-reconcile`, `check-push-mutations` all clean.

**Live `pnpm dev`**, authenticated, against local Postgres — the assertion the plan said must not be
skipped:

| | Barbell Overhead Press (no log, no PR) |
|---|---|
| before | `estimated1rm: null` → screen falls through to 60 kg |
| POST a 100 kg starting 1RM | `{ok: true}` |
| after | **`estimated1rm: 100`**, `allTimePr1rm` still **null** |

`personal_records` was confirmed untouched by SQL (no row created), and the estimate landed in
`exercise_estimates` with `exercise_id` resolved. The prescription preview then prescribed 75 kg for
that exercise, and returned `weightKg: null` for one with no basis at all — the honest shape.

Two mistakes worth recording. The `next-session/prescription` tests failed because their mock repo
had no `getExerciseEstimates`; calling an undefined method throws synchronously, so the `.catch(() =>
[])` never applied. And the `claude_ro` coverage test pins the views migration **by filename** — it
rebuilt the schema from 158 and then asserted a count that only 160 satisfies. Both were my
oversights, not flaky tests; the pinned filename now carries a comment saying to repoint it.

### Deferred, deliberately — Q-5b

Plan §2.5 **rewrites existing `personal_records` rows** (5 drifted values, 5 name-duplicate merges,
`exercise_id` backfill). That is the confirm-first carve-out, so it is queued as **Q-5b** rather than
merged unilaterally. The structural half stands alone: new drift is prevented from today, and the
new table now exists to receive the old typed values when the reconcile runs.

Also deferred: removing `return 60` from `computeInitialWeights`. The resolver makes it unreachable
for any exercise with a log, PR or estimate; what remains is the genuinely-nothing case, where the
change is to what the weight input renders with no value — worth a look on-device first.

### Not exercised

The builder UI flow end-to-end (I posted to the route directly rather than driving the form), and
anything on-device. No local-store mirror for `exercise_estimates` yet — offline, an exercise with
only a typed estimate and no log still resolves to null until the app has been online once. Noted in
Known Issues.
