# 2026-09-26 — LA-147: a duration change stops spending the model's budget

**Branch:** `fix/la147-refit-rate-limit-bucket` · **Lane A** · closes `LA-147`.

`RV-202 ②` stopped a duration change from calling the model but left it spending the model's
allowance. The prescribe route took one `rateLimit('prescribe:<user>', 20, 1h)` before it knew
which kind of request had arrived, so twenty preset switches in an hour produced "Too many
requests" for work the AI never saw. The limit's own comment cited preset-switching as the reason
it was 20 rather than 10 — the justification had outlived the behaviour it was written for.

## Two buckets, and the ordering the entry worried about

- `prescribe-any:<user>` — **60/hour**, checked FIRST, before the body is read. It bounds every
  prescribe request of either kind.
- `prescribe:<user>` — **20/hour**, the model's own, checked on the generation path only.

A preset request that falls through to a real generation (no stored plan, expired, a pending
whole-session deload) reaches the second check and is charged, which is right: it is about to
spend tokens.

**The entry's ordering catch is softer than it states, and that changed the design.** It says the
branch "is only knowable after `getSessionPeriodization`". It is not — `durationPreset` comes from
the parsed request body, before any repository read. What *is* only knowable later is whether the
re-fit will succeed. So the tempting shape is to parse first and then pick a bucket; that would
move the only guard behind a body read, letting a caller spend parses by omitting the field that
decides the branch. Keeping a cheap ceiling in front and charging the model's bucket on the branch
that reaches it gets both properties with no reordering.

The re-fit is not free either — it runs a full `aggregateSignals`, about 30 repository reads — so
60/hour is a real bound rather than a formality.

## Measured on the dev server

Limiter rows cleared, one real generation to have something to re-fit, then preset switches:

- **25 switches, all 200.** Before this the 20th would have been a 429.
- Buckets afterwards: `prescribe-any` **26**, `prescribe` **1**. The 25 re-fits spent nothing of
  the model's allowance — the whole point, read straight out of `rate_limits`.
- Pushed further: the **first 429 lands at `prescribe-any` request #61**, exactly the ceiling, with
  the model bucket still at **1** after 59 re-fits.

## Verification

- Full suite green; lint **831**, exactly baseline; `check-test-typecheck` at baseline; Custom
  Rules **80 of 80**. No version bump — the change is only visible when you were being throttled
  wrongly.
- 5 new tests. Mutation pass, 3 real mutants + 1 control: collapsing back to one bucket killed 3,
  dropping the model check on the fall-through path killed 2, and moving the ceiling behind the
  body parse killed 1. The control — swapping the two constants' declaration order — survived.

## Not exercised

**A second replica.** The limiter's authoritative store is the `rate_limits` table with an
in-memory L1 in front, and the documented accepted lag is that a cold replica can let a few
requests through before its first DB round-trip. Everything above ran against one dev process, so
the two buckets were verified per-process; nothing here changes that shared-store behaviour, but
nor did this run test it.

**No device.** The failure this fixes is a toast on the pre-workout screen, and the toast itself
was not seen — only the status codes behind it.
