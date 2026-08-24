# Plan — Meal Plan phase 2: prefill the day, and ask whether you ate it (Q-187)

**Date:** 2026-08-13 · **Domain:** `nutrition` (secondary: `platform` — offline-first write path)
**Backlog:** Q-187 · **Branch:** `feat/meal-plan-prefill`
**Status:** plan only. Nothing implemented.

Phase 1 shipped 2026-08-12 (v1.299.0): a one-tap "I ate this" on the plan card, deliberately the half
that needs none of the machinery below. This plans the other half.

---

## The owner's goal, verbatim

> "ideally the end gsme goal is the meal plan will auto fill and require a yes/no if you had the food;
> then as you input your actuall food it can recalculate food based on the macros left. I.e if you eat
> too much during lunch it will cut some portions for other meals or vice versa."

**This plan covers the first sentence only.** The recalculation half has no design beyond that
sentence and must not be folded in — it is noted at the end as a separate item.

## The one hard problem

A prefilled meal is *suggested*, not eaten. If a prefilled row reaches `food_logs`, the day's totals
count food nobody ate — the energy-balance bar, the macro rings, the adherence score and the AI's
view of the day all become wrong, silently.

**`food_logs` is read in 24 files.** The obvious design — add a `confirmed_at`/`status` column and
filter it — means every one of those readers must learn the filter, in the domain with this project's
worst data-loss history. One missed reader is a wrong number the owner acts on. That is a
sibling-surface sweep with 24 chances to be half-done, and the repo has shipped exactly that failure
before (the soft-delete filter burn-down, Q-182, took 35 sites and its own session).

### Recommended: unconfirmed rows never enter `food_logs` at all

Keep prefills in their own small table until answered. Confirming writes a real `food_logs` row
through the **existing** `logPlanMeal` path; denying writes nothing.

Then no reader can miscount, because there is nothing in `food_logs` to miscount — the illegal state
is unrepresentable rather than filtered. It also needs **zero** changes to the 24 readers, which is
the difference between a contained feature and a sweep.

The cost is one new table plus its sync path. That is real, and it is smaller than 24 audited readers.

## What must actually be stored

Phase 1 established a principle worth preserving:

> "Which meals are already logged is derived, not stored. A plan meal has no per-day row, and
> inventing one just to remember a button press is the start of exactly the unconfirmed-row design
> phase 2 must do properly."

Phase 2 is where that changes, and only just. **"Ate it" stays derivable** — the food is in the day,
exactly as phase 1 matches it today. **"Did not eat it" is not derivable**: an absent food log is
indistinguishable from "hasn't answered yet", and a prefill that keeps re-asking after being declined
is worse than no prefill.

So the minimum durable state is one row per *declined* plan meal per day:

```
plan_meal_answers (user_id, date, plan_meal_id, answer, answered_at)
```

Everything else derives. Deliberately **not** stored: the prefilled macros (they come from the plan's
ingredient snapshot, Q-192), and "confirmed" (that is the food log itself). Storing a confirmed row
*and* the food log is two sources of truth for one fact, which is how counters in this project drift.

## Offline-first checklist

`plan_meal_answers` is a user-initiated write, so it takes the full path — not the abbreviated one:

1. Local table in the SQLite store, registered in **`RECONCILE_TABLES`/`RECONCILE_COLUMNS` in the same
   commit** (`reconcileSchema()` is the real authority after a partial upgrade).
2. `store.upsert…` + `queueMutation`, never the API alone.
3. A `pushMutations` branch that **calls the same shared function as the web route** — CI's
   `check-push-mutations.js` fails the build if it touches `this.db` directly.
4. `getSyncDelta` → `pullDelta` → `applyDelta`, with the domain flag added, and `applyDelta` gating on
   `sync_status === 'synced'` so a pull cannot revert a pending local answer.
5. A `deleted_at` tombstone if an answer can be undone — and it should be undoable, because "no" is
   one mis-tap away from losing the meal for the day.
6. The UI reads **local-first**. A denied meal must stay denied offline, or it reappears on the next
   app open.

## Verification bar

- **The number the whole design protects:** a day with prefills showing and none answered must report
  *identical* totals to the same day with the plan switched off. Assert on `/api/nutrition/energy-balance`
  and the macro rings, not just on row counts.
- Answering "no" survives an app restart and a sync round-trip.
- Answering "yes" produces exactly the rows phase 1's button produces — same path, same shape. Assert
  against `logPlanMeal`'s output rather than re-deriving expectations.
- Double-answer and rapid-tap guarded (this project has shipped 4 POSTs from 5 taps before).
- **Device-gated.** Local SQLite and the outbox do not run in the sandbox, so `pnpm dev` green is
  necessary and not sufficient. Note also that **local SQLite v25 has never run on a phone** — if
  Saved Meals comes up blank after this ships, revert rather than debug forward.

## Sequencing

1. The table + sync path, with nothing reading it — provable in isolation.
2. The prefill UI, read-only, showing suggestions that write nothing.
3. Answers wired to `logPlanMeal` (yes) and `plan_meal_answers` (no).
4. Only then consider whether prefill should be automatic on day open, or an explicit "fill my day"
   action. **Recommend explicit first** — an automatic prefill that guesses wrong trains the owner to
   ignore it, and the button is one tap.

## Explicitly out of scope

- **Recalculating remaining meals against what was actually eaten** — the owner's second sentence. It
  needs its own design: what gets re-scaled, whether an already-eaten meal can push another below a
  sensible floor, and what happens when the remaining macros are unreachable. File separately once
  this lands and is in real use.
- ~~**Q-201**~~ (a plan meal's suggested time schedules nothing) — ~~a three-way fork only the owner
  can settle~~. **SETTLED 2026-08-24: the time stays a label and schedules nothing**, and the entry
  is out of the queue (reasoning in
  [`docs/domains/nutrition/README.md`](../../domains/nutrition/README.md) → *Decided, and
  deliberately not built*). **This raises the stakes on the prefill below rather than lowering
  them:** the owner's answer leans on prefill to make an active plan present in the day, since
  nothing will now interrupt to announce it. Prefill is the whole mechanism, not one of two.
