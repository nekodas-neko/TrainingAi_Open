# 2026-08-20 — two routes that answered a correct refusal with an empty 500 (RV-33)

**Branch:** `fix/ownership-refusal-status-two-routes` · **Lane A** · closes **RV-33**, files **LA-14**
· Review sweep 40's write-up:
[`docs/reviews/2026-08-20-non-workout-write-surface-ownership.md`](../../reviews/2026-08-20-non-workout-write-surface-ownership.md)

## What was wrong

Q-462/Q-463 settled the posture — an id that is not yours is a **404**, not a server fault — and
fixed it on five routes. Two were missed, and both fail the same way: the repository throws the
*correct* `NotFoundError` and the handler has no `try`, so it escapes as an **empty-bodied 500** and
files an `error_events` row as `source: server`.

| route | before | after |
|---|---|---|
| `POST /api/progression-styles` (another user's style id) | **500**, no body, 1 fault row | **404** `Progression style not found` |
| `PATCH /api/nutrition/food-logs/[id]` (not your log) | **500**, no body, 1 fault row | **404** `Food log not found` |

Neither leaks and neither is on a `pushMutations` path — the refusals were already correct. The cost
was a UI with nothing to render and correctly-refused requests filling the one channel `CLAUDE.md`
says nobody is watching. Both now use `withRouteErrors`, the same helper the five fixed routes use.

## The hardening bullet, folded in

`updateMealType` was the only repository writer that passed its argument into Drizzle's `.set()`
wholesale. It was safe **only** because its single caller validates with a `.strict()` Zod schema —
the guarantee lived at the route, so a second caller would inherit nothing, and `userId`/`createdAt`
are settable column keys whatever the compile-time `Omit<>` says. Now whitelisted column by column
like its ~20 siblings, with a test that passes `userId` and `createdAt` in and asserts neither moves.

A body of *only* unknown keys now reaches the same `No fields to update` refusal as `{}`, rather than
Drizzle's "No values to set" surfacing as a 500.

## Measured against the running app

`pnpm dev`, real login as A, C's rows genuinely C's:

| probe | result |
|---|---|
| `POST /api/progression-styles` with C's style id | **404** `{"error":"Progression style not found"}` |
| `PATCH /api/nutrition/food-logs/<C's log>` | **404** `{"error":"Food log not found"}` |
| `error_events` rows written by the two refusals | **0** |
| C's style name · C's log multiplier | unchanged |

5 new tests, **all three changes mutation-verified** — removing each guard turns exactly its own case
red.

## The finding one method over, filed rather than fixed

`deleteFoodLog` does **not** throw when its scoped UPDATE matches nothing, so
`DELETE /api/nutrition/food-logs/[id]` answers `{"success":true}` for another user's log. Nothing
cross-user is written — the scope holds — so this is a truthfulness problem, not a security one: two
methods on the same resource answer the same refusal differently.

Deliberately **not** changed here, because idempotent-DELETE is a real argument and this app replays
deletes through the outbox, where a 404 would be a poison pill — the same trap RV-32 hit. Filed as
**LA-14** with the outbox question named as the thing to check first, rather than fixed on a guess.

## The gate

`tsc` clean · `pnpm lint` **0 errors** · **Ran 50 of 50** Custom Rules steps · `pnpm build` clean ·
full suite **4,449 tests, 0 failed**.

## Not exercised

The S25 APK. Server routes and the repository layer — no Capacitor, safe-area or gesture surface. No
version bump: every id a legitimate client sends is its own, so none of these paths is reachable in
normal use.
