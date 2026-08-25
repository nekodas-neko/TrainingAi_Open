# 2026-08-25 — the Coach's undo has a button (Q-467)

**Branch:** `feat/coach-undo-control` · **Lane B** · no schema, no route, no APK.

A complete undo subsystem for AI-Coach changes has been in the repository with **no caller**:
`POST /api/coach/apply/[id]/undo` (auth-gated, rate-limited, ownership-scoped), `undoCoachChange()`
with a double-undo guard, an `undo()` handler in all five domains, a `captureBefore()` in each that
exists only for it, the `coach_changes.undone_at` column — and `coach-history.tsx` already styling a
row struck-through, muted and "· undone" for a state the user had no way to reach.

Re-verified against `main` before writing anything: the route is there, `/undo` appears in **no**
client file, and the history list renders read-only. All three still true.

The only way back was to ask the Coach to change it again — a *new* change against current state
rather than a restore, and for `early_deload` or `program_phase` possibly not expressible at all.

## What shipped

An Undo control on each change that is not already undone, in `coach-history.tsx`. In-flight guard,
`disabled` while the request is out, and the row re-styles itself struck-through the moment the undo
lands — that restyle is the feedback, so there is no toast.

**No confirmation dialog, deliberately.** Undo *is* the safety net; putting friction in front of it
is the wrong side of the trade. The route holds the real guard.

**The 409 is a state, not an error.** The window is "until the next workout started after the
change", because once a session has been shaped by it, reversing would silently disagree with
training already done. A refusal replaces the button with its own sentence on the row: the user has
not done anything wrong and there is nothing to retry.

## The bug this would have shipped with, if the route were taken at its word

`app/api/coach/apply/[id]/undo/route.ts` calls `invalidateProgramStructure()` **on the server**, and
`lib/cache-groups.ts` is a *client* module — it reaches `localStorage`, `sessionStorage` and the
on-device SQLite cache. On the server that call clears nothing. Wiring the button without noticing
would have restored the programme in Postgres while every screen kept painting the changed one from
cache for a full TTL: this repo's most-repeated bug class, arriving through a line that looks like it
already handles it.

The client now clears the superset — `invalidateProgramStructure()`, `invalidateGoalRecommendations()`
and `invalidateCoachHistory()` — after any successful undo. It has to be the superset: the history
payload carries only `id`, `summary`, `appliedAt` and `undoneAt`, so the client cannot tell which of
the five domains it just reversed, and adding a domain field would mean editing `lib/coach/threads.ts`,
which is Lane A's. The cost is one refetch on a rare action.

## Verified

Against local `pnpm dev` + Postgres, with a real `coach_changes` row (`user_goals`, steps
8,000 → 12,000):

**Undo inside the window.** Row shows an `Undo: Daily steps 8,000 → 12,000` button →
`POST /undo` **200** → row struck-through, "· undone" appended, the button gone. **In the database:
`users.steps_goal` 12,000 → 8,000 and `coach_changes.undone_at` set** — the restore actually
happened, not just the styling.

**Undo after training.** Same change re-seeded two hours back with a workout session started one hour
back → `POST /undo` **409**, the row renders *"You've trained since this change — undoing it now
would disagree with a session you've already done."*, the button is gone, and **the row is NOT struck
through** — nothing was undone and nothing claims it was.

`tsc --noEmit` clean · eslint clean · `check-memo-prop-stability` **78 memoised components, 0
defeated call sites** (the row is its own memoised component taking scalars, since it renders inside
`.map()` where a hook cannot live) · `pnpm check:rules` **Ran 56 of 56**.

## Not exercised

- **The other four domains.** Only `user_goals` was driven end to end. The remaining handlers
  (`nutrition_targets`, `session_exercise`, `early_deload`, `program_phase`) share the same route,
  the same `undoCoachChange()` and the same client call, and are covered by
  `lib/data/postgres/__tests__/coach-domains.test.ts` at the handler level — but no UI pass touched
  them, and `early_deload` / `program_phase` are the two whose restore is hardest to express.
- **The `stale` 409** (a later Coach change still in effect over this one) renders through the same
  path as the trained-since 409 and was not driven separately.
- **The S25 APK.** The control is a plain button in an existing list, but its tap target and the
  refusal's wrap have not been seen at that width. `Gate: device`.
- **Production has never had a row to undo** — `claude_ro.coach_changes` is empty for the owner, so
  this is the first real exercise of a path that has existed unused. That is also why the owner's
  Q-472 decision made it a prerequisite: the exposure appears the moment anything drives Coach writes.
