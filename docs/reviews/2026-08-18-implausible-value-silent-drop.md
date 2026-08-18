# Review — an implausible value: rejected on web, silently discarded on the device path

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** numeric bound enforcement across the two write paths
**Findings filed:** Q-485 · **Clean results recorded:** two

## Why this lens

`CLAUDE.md`'s offline-sync rule is *"Sync-push must mirror the web route"*, and the `pushMutations`
`body_metrics` branch carries a comment claiming it does: *"Matches the web route's
(`BodyMetadataPostSchema`) numeric bounds — without this a corrupted local payload could push an
out-of-range value straight past the push path."* Nobody had sent the same out-of-range value down
both paths and compared.

## Measured

Same value, same field, same instant — `weightKg: 10000` against a bound of 500:

```
POST /api/body-metadata                       →  400
  {"error":"Too big: expected number to be <=500"}

POST /api/sync/push  {domain:"body_metrics"}  →  200
  {"processed":1,"errors":[]}

  → row written: steps 7000, weight_kg NULL
```

The bounds do mirror — both paths import the same `packages/shared/src/validation/body-metrics.ts`,
so they cannot drift. **What differs is what happens when the bound is hit.** The web route refuses
the save and says why. The push path writes the rest of the row, drops the field, and reports
complete success.

**The drop is invisible in all three places it could have been recorded:**

| Where | Result |
|---|---|
| Push response | `errors: []` — the client confirms the mutation and deletes it from the outbox |
| Server log | nothing — the coercion block has no `console.*` |
| `error_events` | no row (verified by query after the run) |

So a value the web refuses with a clear message is, on the canonical runtime, discarded with no trace
anywhere and no way for the user to know.

## Finding (Q-485) — the same function treats an implausible value two different ways

Inside `pushMutations` there are **14** value checks and **two** policies:

- **12 coerce silently** — `valid…OrNull(x) ?? undefined`, across `validWeightKgOrNull`,
  `validBodyFatPctOrNull`, `validCaloriesOrNull`, `validMacroGOrNull`, `validStepsOrNull`,
  `validDistanceKmOrNull`, `validRestingHrOrNull`, `validHrvMsOrNull`, `validWaterMlOrNull`,
  `validMeasurementCmOrNull`.
- **2 throw** — `waterMlDelta` (`throw new Error('body_metrics: implausible waterMlDelta …')`) and
  `sleep_session` (`throw new Error('sleep_session: implausible — …')`). A throw becomes an entry in
  `errors[]`, so the mutation is retried, eventually dead-lettered, and surfaces on the More-tab
  badge. **The visible behaviour already exists in this function.**

Both throws are defensible on their own terms — a dropped *increment* loses the add entirely (and
`CLAUDE.md` records a `-1e9` delta once driving hydration to minus a billion), and a malformed sleep
session is meaningless rather than merely incomplete. The question this finding raises is why
**weight** is in the other group. A dropped weight is a lost measurement in the app's headline body
metric, and it is lost as silently as it is possible to lose something.

### What the fix is not

**Not "throw everywhere."** A throw quarantines the mutation, and `CLAUDE.md`'s poison-pill rule is
explicit that a validation failure must not be retried forever. Converting 12 silent coercions into
12 dead-letter paths would trade an invisible failure for a queue full of red badges over values the
user cannot correct from the badge.

### What it could be

In rough order of cost:

1. **Log the coercion server-side.** One line in the block. It makes the drop visible in
   `error_events`/logs without changing client behaviour at all, and it is enough to answer "did my
   weight save?" after the fact.
2. **Add a `warnings[]` channel to the push response**, separate from `errors[]`, that the client can
   surface without dead-lettering the mutation. This is the version that tells the *user*.
3. **Decide per field** which values are "incomplete but keep going" and which are "meaningless,
   quarantine" — i.e. move some of the 12 into the throw group deliberately rather than by default.

(1) is the one worth doing regardless; (2) is the real fix; (3) is a product decision and should not
be made by an implementer in passing.

### Reachability

The bounds are generous (weight 20–500 kg), so ordinary UI input never trips them — the dial and the
scale are bounded. The path that reaches this is the one the code comment already names: *"a
corrupted local payload"*, plus a misreading BLE scale. So this is not a common event; it is an event
that, when it happens, is designed to be undetectable.

## Clean results

- **The bounds genuinely mirror.** Both write paths import the same shared validation module, so the
  numbers cannot drift — this is the `One Formula, One Place` rule holding. The comment claiming the
  mirror is accurate about bounds; it simply does not describe behaviour.
- **`sleep_session` and `waterMlDelta` are correct** and are the reference for the visible path.

## Not verified

Local `pnpm dev`. Not on the APK — but the push branch is server code and the client half
(`errors: []` → confirm → `deleteMutations`) was read from `sync-engine.ts` in an earlier sweep rather
than induced here. I did not enumerate whether any other domain branch coerces silently outside the
`body_metrics` block.
