# 2026-09-28 — LB-178: the suite's most reproducible flake was seed state, not ordering

**Lane B.** Branch `fix/home-banner-stack`. One e2e spec — no product code, no version bump.

## What it actually was

`tn53-sparkline-does-not-span-gaps:105` was the only spec flaky in **all three** CI censuses, so
`LB-178` named it the start point and named shared database state as the suspect. Earlier today I
refuted the obvious form of that (nothing else writes `resting_heart_rate`, nothing mutates
`users.timezone`, it passed 3/3 alone and 11/11 after the four other `body_metrics` writers) and
recorded that the next step was to **read the retained first attempt** rather than shuffle order.

Doing that answered it in one look. The error is neither a timeout nor a wrong count:

```
Expected substring: "3 days missing"
Received string:    "Resting Heart Rate — 14 days"
```

The note is **absent entirely**, so the chart saw *zero* gaps.

**`scripts/local-db/seed.sql` gives every one of the last 14 days a `resting_heart_rate` of 58.**
The spec seeded its four readings with `ON CONFLICT DO UPDATE` and never cleared the rest, so on a
freshly seeded database the window is full and there is no gap to disclose. **A spec cannot assert a
gap it does not create.**

## Why that reads as "flaky" rather than "broken"

- **CI seeds a new database every run.** Attempt 1 meets a full window and fails. The spec's own
  `afterAll` then NULLs those seeded values. The retry re-runs `beforeAll` against an empty window
  and **passes** — so the run reports *flaky*, every time, deterministically.
- **A local database is persistent**, so one earlier run had already emptied it and the spec could
  never fail here again. Measured: **0 of 15** rows in the window carried a reading locally, against
  **15 of 15** on a fresh seed.

Restoring `resting_heart_rate = 58` across the window reproduced the CI failure locally, byte for
byte — same error, same received string.

## The fix, and the control

`beforeAll` now NULLs `resting_heart_rate` across the whole window before seeding its four, so the
spec is independent of the seed and idempotent. **Control-run both ways against the restored
fresh-seed state:** unfixed → fails with the CI error; fixed → 3 passed.

**Sibling sweep, clean.** Of the specs that both seed `body_metrics` and mention an absence, only
this one asserts on a *rendered* absence; `metric-bounds-at-keyboard` and `reta-weight-response`
match on prose and an error message.

## ⚑ What this changes for the rest of LB-178

The remaining churn has a better hypothesis than ordering. The real asymmetry is not which spec ran
first — it is that **CI runs against a database seeded minutes earlier, while a local database has
been mutated by every previous run**. Any spec whose assertion depends on an absence, or on the
seed's exact values, is a *different test* in the two environments. The cheap probe is a
`pnpm db:local` rebuild followed by the full suite, which reproduces CI's starting conditions
locally; shuffling order does not.

## Two things that cost time, both recorded

1. **I chased the wrong suspect first.** The entry said "shared state", I read that as *another spec
   writing the same column*, censused that, found nothing, and wrote it up as refuted. It was shared
   state — with the **seed**, not with another spec.
2. **The retained first attempt is free and I reached it last.** Every E2E run uploads a
   `playwright-report` artifact containing the flaky test's first attempt, downloadable
   unauthenticated from the artifacts API. The job *log* is not a substitute: ~9,000 lines whose
   tail is container teardown.

## Not exercised

The fix is verified against a locally restored fresh-seed state, which is the condition that fails —
but not against a true `pnpm db:local` rebuild, and not yet on CI. The generalised seed-state
hypothesis for the *other* churning specs is **stated, not tested**: no full-suite run was made from
a rebuilt database. No product code changed.
