# 2026-08-18 — Review: an implausible value down both write paths

**Agent:** Review 📖 · **Branch:** `claude/review-numeric-bounds` · **Docs-only.**
**Filed:** Q-485 · **Review:** [`docs/reviews/2026-08-18-implausible-value-silent-drop.md`](../../reviews/2026-08-18-implausible-value-silent-drop.md)

## Why

`CLAUDE.md`: *"Sync-push must mirror the web route."* The `pushMutations` `body_metrics` branch
carries a comment claiming it does. Nobody had sent the same out-of-range value down both paths.

## Measured

`weightKg: 10000` against a bound of 500:

```
POST /api/body-metadata  →  400  {"error":"Too big: expected number to be <=500"}
POST /api/sync/push      →  200  {"processed":1,"errors":[]}
                             → row written: steps 7000, weight_kg NULL
```

The drop is invisible in all three places it could be recorded: `errors: []` so the client confirms
and deletes the mutation; no `console.*` in the coercion block; no `error_events` row, verified by
query.

## The bounds are fine — the behaviour is not

Both paths import the same `packages/shared/src/validation/body-metrics.ts`, so the numbers cannot
drift. That is `One Formula, One Place` working. The comment claiming the mirror is accurate about
bounds and simply does not describe behaviour.

## The visible behaviour already exists, on 2 of 14 checks

Twelve sites coerce silently (`valid…OrNull(x) ?? undefined` — weight, bodyFat, calories, macros,
steps, distance, RHR, HRV, water, measurements). Two throw (`waterMlDelta`, `sleep_session`), which
become `errors[]` entries and reach the More-tab dead-letter badge.

Both throws are defensible on their own terms — a dropped *increment* loses the add entirely, and a
malformed sleep session is meaningless rather than incomplete. The open question is why **weight**,
the app's headline body metric, sits in the silent group.

## What the fix is not

**Not "throw everywhere."** A throw quarantines the mutation and the poison-pill rule forbids
retrying a validation failure forever; twelve new dead-letter paths would trade an invisible failure
for red badges the user cannot act on. The entry recommends, in order: log the coercion server-side
(one line, worth doing regardless), then a `warnings[]` channel separate from `errors[]`, then a
per-field product decision that an implementer should not make in passing.

## Reachability, stated honestly

Bounds are generous (weight 20–500 kg), so ordinary UI input never trips them. The path that reaches
this is the one the code comment already names — *"a corrupted local payload"* — plus a misreading
BLE scale. Rare, and designed to be undetectable when it happens.

## Not verified

Local `pnpm dev`. Not on the APK; the client half was read from `sync-engine.ts` rather than induced.
Domain branches outside the `body_metrics` block were not enumerated for the same pattern.
