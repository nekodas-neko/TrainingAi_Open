# The bounds existed for months; the client never asked (Q-321)

**Branch:** `feat/validate-metrics-at-the-keyboard` · **Lane B** · v1.348.0

## What was wrong

`packages/shared/src/validation/body-metrics.ts` holds a threshold for every body metric, and both
the web route and the sync-push branch import it. **Nothing under `components/` or `app/` did** —
verified by grep, and it is the whole finding. `components/health/metric-log-sheet.tsx` checked only
`valueNum <= 0`.

So a 5,000 kg weight was accepted by the sheet, written to the local store, queued as a mutation,
pushed, and discarded server-side. The number the user typed appeared nowhere afterwards.

## What Q-321's own framing missed

The entry named `metric-log-sheet.tsx`. There are **three** client surfaces writing
`domain: 'body_metrics'`, and the other two matter more:

- **`app/session-select/components/log-value-sheet.tsx` had no bounds check at all** — not even the
  `> 0` its sibling carried — across **seven** fields: weight, steps, calories, the three macros and
  water.
- **`components/profile/water-log-sheet.tsx`** takes a custom millilitre amount, and
  `validWaterMlDeltaOrNull` is one of the **two** validators that *quarantines* rather than coerces.
  An over-5,000 ml entry therefore dead-lettered into a badge the user cannot act on — which is the
  outcome Q-321's own decision section argues hardest against. Of the fields this change covers, it
  is the one that was actually costing something.

## The change

`components/health/metric-bounds.ts` — one map from the field name each sheet already uses to the
validator and bounds already in the shared module, plus the message. **No new thresholds**: every
bound is imported, so the client and server cannot disagree about what is acceptable. All three
sheets call `metricBoundError(field, raw)`, render it inline, disable Save on it, and re-check it in
the save handler so "never queue the value" is true rather than merely hard to reach.

One behaviour change worth naming: **0 steps is now accepted.** `STEPS_MIN` is 0, and the old
`valueNum <= 0` refused it — a disagreement with the server, in the direction of refusing something
valid. Pinned by test so a future "must be positive" tidy-up cannot bring it back.

`validStepsOrNull`'s fractional-rounding bug, which the entry asked to fix in the same PR, **was
already fixed** on `main` by the Lane A half. Confirmed by reading it, not assumed.

## The measurement that corrected this PR's own test

The obvious guard is "the value must not reach `body_metrics`". I wrote that, then mutation-checked
it by restoring the old `valueNum <= 0`, saving 5,000 kg, and polling the table — **it passed.**

`getLocalStore` returns null in the web sandbox, so the sheet takes its API fallback, and
`BodyMetadataPostSchema` refuses 5,000 with a 400. The row was never written either way. The path
the entry describes — stored locally, queued, pushed, discarded — is the **device** path and cannot
run here at all.

So the database poll is kept as an invariant but is **not** the guard. The discriminating assertions
are the two client ones — the inline message naming the bound, and Save disabled — and those do fail
on the old check. The spec's own docstring records this, because "assert on the database, not the
toast" is normally the right instinct and here it was wrong.

## Verification

- `components/health/__tests__/metric-bounds.test.ts` — 10 cases: every boundary inclusive on both
  ends, the 5,000 kg case by name, zero steps, water strictly positive and capped, an unbounded
  field staying saveable, and a coverage case asserting every field the three sheets can pass has a
  bound (otherwise the guard is a silent no-op for it).
- `e2e/metric-bounds-at-keyboard.spec.ts` — 4 passed, including a plausible weight still saving, so
  a bound that refused everything would not pass.
- `pnpm check:rules` — Ran 55 of 55. Typecheck and lint clean.

## Not exercised

**The device path was not run, and it is the one the defect lives on.** `getLocalStore` returns null
here, so the local-store write and the outbox queue in all three sheets took the API fallback in
every test above. On the APK the guard runs before either, which is read from the code rather than
observed. Not checked on the S25.

**`log-value-sheet.tsx` and `water-log-sheet.tsx` were not driven end to end** — their bounds are
covered by unit test and by reading, not by a browser pass; only the weight sheet has an e2e path.
