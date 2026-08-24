# 2026-08-24 — session effort derived from the set ratings, with no column to drift (Q-420)

**Branch:** `feat/derive-session-rpe-from-set-rpe` · **Lane A** · shared math + one route.
**No migration, no schema change, no APK.**

## The entry prescribed a stored column. It did not need one.

Q-420 asks for a derived session RPE, and specifies three pieces of machinery around it: a stored
column, a source flag so derived can be told from self-reported, and a re-derive rule stating when a
recomputation may overwrite. The entry is explicit that the flag *"is a schema change"* and that the
rule must be *"decided explicitly"*.

**All three dissolve if the value is derived on read.** `session_rpe` stays purely self-reported, so
"overridden" is just *that column is non-null*. A derived value cannot drift from the sets it came
from, because it is recomputed from them every time. And a later set edit is reflected for free —
which is the whole of the owner's *"can be overwritten if needed"*.

CLAUDE.md's **Stored Counters** rule says exactly this: *every stored counter in this project has
drifted… derive counts from source-of-truth queries at read time.* The entry's own worry — that a
re-derive could silently eat a manual correction — is that drift, predicted in advance.

**And it costs nothing.** `getWorkoutSessionsFrom` already hydrates every session's exercise and set
logs, so the derivation is arithmetic over data the route is holding. No extra query, no join.

## What shipped

`packages/shared/src/workout/derive-session-rpe.ts`:

- **`deriveSessionRpe(setRpes)`** — the plain mean, rounded. A sentence the owner can check against
  their memory: *"your sets averaged 7.5, so the session is an 8."* Unrated sets are **ignored, not
  counted as zero** — 422 of 1,047 sets carry no rating in production, so a zero would drag every
  session toward the floor.
- **`sessionEffort(selfReported, setRpes)`** → `{ rpe, source: 'self' | 'derived' } | null`, with a
  self-reported rating always winning.

`app/api/health-trends` consumes it, and each series point carries its `source` — the two are
different instruments on different scales, and a chart drawing them as one line should be able to say
which is which.

**Two things the entry decided and this follows:** the value stays in **set-RPE units (6–10)** and is
*not* mapped onto the 1–10 session scale — mapping between two instruments that measure different
things would be inventing precision — and the weighting that counts hand-changed sets above
prefill-agreeing ones is rejected, because it moves the answer by ~0.2 of a point and cannot be
explained in one sentence.

## Verified

- 9 unit tests. **Two mutations, each applied and reverted:** letting a derived value overwrite a
  self-reported one fails 3 tests; counting an unrated set as zero fails 3 others.
- One test exists for a bug the natural implementation has: a self-reported **0** must be a rating,
  not absent. A `??` or a falsy check gets that wrong.
- **Through the real route on `pnpm dev`**, before and after on the same database: the `session-rpe`
  series went from **0 points to 10** — 9 derived, 1 self-reported — and the insight line reads
  *"10 sessions rated so far (9 from set ratings) — average effort 8.2/10."*
- Full suite and `pnpm check:rules` 55 of 55.

## A finding this surfaced: LA-21

The dev data held a session spanning **1,176 minutes**, which produced `sessionLoad 10585` against a
normal 440 — **24×**. There is **no upper bound on session duration anywhere**: not in
`health-trends`' `rpe × durationMin`, not in `estWorkoutKcal`, not in `estSessionKcal`. ACWR is a
ratio of recent to chronic load, so one such point distorts both windows for weeks, in the direction
that reads as *"you are training far too hard."*

Not a live corruption — it needs a session started and never ended, and production shows none — but
it is silent, and the derivation made it visible on nine points where it had been visible on one.
Filed as **LA-21** with the real decision named: clamping keeps a partly-fictional point, excluding
loses a session that did happen, and the right answer is probably different for the load series than
for the calorie estimate.

## What is left on Q-420

- **The prompt removal** (`done-screen.tsx`) is Lane B's, and it is item 1 of the owner's decision.
  The derivation exists now, so removing the prompt no longer loses anything.
- **`intensityFromRpe` still applies Foster's ≤4/≥8 thresholds to a set-scale number.** Giving a
  derived value its own thresholds is a **scoring change** — Tuning proposes, the owner signs off — so
  it is deliberately not done here, and that is why the derived value is not yet wired into the
  energy path.
- **The HR + derived-intensity combination is Q-422's**, and it is `Gate: owner`.

Also removed **Q-542**, whose own text said *"keep for the audit trail, then remove"*: Q-541 is
complete and Q-540's remaining half is owner-gated, so the trail has served its purpose.

**Failure surfaces NOT exercised:** production — the before/after was measured on the dev database
against seeded sessions I rated by hand, so the *shape* is verified and the owner's real numbers are
not. Nothing device, native, safe-area or offline is touched, and no consumer of the energy path
changed behaviour.
