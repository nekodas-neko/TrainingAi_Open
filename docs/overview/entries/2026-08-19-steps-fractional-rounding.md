# 2026-08-19 — a fractional step count no longer costs the whole day (Q-321, Lane A half)

**Branch:** `fix/steps-fractional-rounding` · **Lane:** Implementation A

## What Q-321 had left

The entry's product question was already answered by the owner (*"happy for you to make the best
guess"*): **none of the twelve coerced `body_metrics` fields should quarantine the mutation** — a
`body_metrics` column is one independent daily observation among many, so dropping an implausible HRV
still leaves a valid weight and step count on the same row. That decision needed no code.

What did need code was the bug found while deciding it, and it splits by lane:

- **Lane B** — import the existing validators into `components/health/metric-log-sheet.tsx` so a
  user-typed value is refused at the keyboard. Still open.
- **Lane A** — `validStepsOrNull` was the only validator in
  `packages/shared/src/validation/body-metrics.ts` gated on `Number.isInteger`. Shipped here.

The entry asked for both in one PR. They cannot be: `packages/shared/**` is Lane A's, so the shared
half would have needed a baton claim to ride in a Lane B PR. Doing it here removes that dependency.

## The correction, which changed the fix

The entry's finding was that the **push branch** silently dropped a fractional count while every
sibling validator rounded. True — but it did not check `BodyMetadataPostSchema`, thirty lines below
in the same file. **The web route rejected it too**, with `z.number().int()`, answering **400 for the
entire body-metrics write**. `metric-log-sheet` POSTs `{ localDate, <one field> }`, so that 400 is
the whole save failing, not one field being dropped.

So the two paths *agreed on policy* and differed only in visibility. **Fixing the validator alone
would have created the drift the one-write-path-per-domain rule exists to stop** — the APK's offline
push would accept a value the web route refuses. Both were changed together.

Rounding is the house pattern rather than a new call: `resting_heart_rate` and `water_ml` are
`integer` columns too, and `validRestingHrOrNull` / `validWaterMlDeltaOrNull` both take a finite
number and `Math.round` it. Steps was the outlier.

## What shipped

- `packages/shared/src/validation/body-metrics.ts` — `validStepsOrNull` takes `Number.isFinite` and
  rounds; `BodyMetadataPostSchema.steps` drops `.int()` and rounds via `.transform()`, so the route
  stays a pass-through and an `integer` column never sees a fraction.
- `lib/__tests__/body-metrics-validation.test.ts` — a rounding case, and a **pairing** case asserting
  the schema and the validator agree on the same input. The pairing is the point; either half alone
  is what drifts.

**Bounds are checked on the raw value, before rounding**, so `-0.4` is out of range rather than
rounding up into a valid `0`. That is `validRestingHrOrNull`'s order too, and it keeps "in range"
from depending on which way a value happens to round. One of my own test assertions got this
backwards first.

## Verified

Against `pnpm dev` on the local DB, as the user:

```
POST /api/body-metadata {"localDate":"2026-08-14","steps":8000.5}  → 200
SELECT steps ... WHERE date='2026-08-14'                           → 8001
POST /api/body-metadata {"localDate":"2026-08-14","steps":200001}  → 400 "Too big"
```

Before, the same POST answered 400 — asserted directly by the repo's own pre-existing test
(`safeParse({ steps: 1.5 }).success === false`), which this PR updates.

Gate: `npx tsc --noEmit` clean, `pnpm check:rules` **Ran 49 of 49**, full unit suite **407 files /
3,630 tests passed, 0 failed**.

## Deliberately not done, and the residual

- **The local store is not rounded.** SQLite's INTEGER affinity keeps `8000.5` as-is, so a local
  write and the server would differ by half a step until the next pull overwrites it. Nothing
  validates locally *at all* today — that is precisely Q-321's remaining Lane B half, and adding a
  lone round for steps would be a partial version of it in the wrong lane.
- **No changelog entry or version bump.** No client sends a fractional step count today
  (`metric-log-sheet` parses integers), so there is no observable user-facing change — this removes a
  latent data-loss path, it does not alter anything on screen.
- **Not exercised:** nothing on-device, no native path, no real decoder producing a fractional count
  (none exists yet — that is the latent case this guards).
