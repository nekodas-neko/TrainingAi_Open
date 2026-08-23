# 2026-08-23 — Undo wrote over whatever was there (Q-468)

**Branch:** `fix/coach-undo-drift-check` · **Lane A**

`applyCoachPatch` refuses to write over a moved target: every domain runs `driftAgainst` and returns
`stale` → 409 with a per-field report. `undoCoachChange` had no equivalent — it read the
`beforeState` captured at apply time and wrote it back. The route's only guard asked *"have you
trained since?"*, never *"has this row changed since?"*

Measured entirely inside the Coach's own flow, no external edit needed:

| Step | Action | `exercise_name` |
|---|---|---|
| 0 | initial | `Barbell Bench Press` |
| 1 | change **A**: Barbell → Dumbbell | `Dumbbell Bench Press` |
| 2 | change **B**: Dumbbell → Incline | `Incline Bench Press` |
| 3 | **Undo A** → `200` | **`Barbell Bench Press`** |
| 4 | **Undo B** → `200` | **`Dumbbell Bench Press`** |

Two things wrong. After step 3 the history showed A struck through and B as still in effect while
the row said `Barbell` — the screen that exists to report what the Coach did was wrong. And after
undoing *everything*, the exercise sat on a value the user never chose.

## The fix

`driftAgainst` gains a `side` — `'from'` for apply ("is the target still where this suggestion was
written against?"), `'to'` for undo ("does the target still hold what this change set?"). One
formula, both directions.

`DomainHandler` gains `currentState(db, userId, targetId)`, and `undoCoachChange` runs the check
once, centrally, before dispatching — rather than five bespoke copies. **The map's keys are the
check's scope**: a change whose field the handler does not report is not scalar state (`removed`
and the create-on-swap fields describe an action, not a value that can have moved). That is the
distinction apply draws with its five per-domain `skip` predicates, expressed once.

`stale` maps to 409 on the undo route, the same as apply.

## Why this subsumes the entry's simpler alternative

The entry offered "allow undo only on the most recent un-undone change per `target_id`" as a weaker
fallback. It is not needed: comparing against `to` **enforces reverse order as a consequence**
wherever two changes touch the same field — the older one stops matching what the target holds until
the newer one is undone. And it also catches an edit made outside the Coach entirely, which ordering
cannot. Both are covered by tests.

## Verification

Full suite **545 files / 4,506 tests** green · `pnpm check:rules` → **51 of 51** · typecheck and
lint 0 errors. All 45 pre-existing Coach tests pass unchanged — four of them failed on the first
draft, which is what surfaced the scope rule above.

Four new tests reproduce the entry's table against a real Postgres, and **both mutations bite**:
dropping the refusal fails 2, comparing against `from` instead of `to` fails 4.

**Not exercised:** in the app — the undo route has no caller yet, which is Q-467 and is why this was
filed as latent. Production's `coach_changes` is empty, so no live instance exists. Nothing here is
device-dependent.

## Also in this PR

Two queue-hygiene fields. **Q-472** is `Gate: owner` — its own text says *"Keep and drive adoption,
or narrow? Owner's call, not Lane A's."* **Q-476** is `Gate: device` — its route half shipped this
morning and the remaining write-time companion sits on the local store.
