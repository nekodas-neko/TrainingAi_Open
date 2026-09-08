# 2026-09-08 — one prescription's whole life gets tests (PS-39)

**Branch:** `test/ai-periodization-prescribe` · **Lane:** A · tests + docs only, no product code.

## What shipped

`lib/__tests__/ai-periodization-session-routes.test.ts` — 27 cases across the three routes that make
up a prescription's life: `prescribe` generates it, the session `GET` is what the card reads, and
`respond` accepts or dismisses it. None had a test that imported its handler. **Batched**, because
they verify as one thing: a prescription that generates but cannot be read, or is accepted without
reaching the bar, is the same defect seen from three places.

Two behaviours carry live incidents and are why the file exists:

- **Accepting a deload is the moment the phase flips**, and `advancePhase` nulls the stored
  prescription as a side effect — so the route re-stores it, with **its own expiry** rather than a
  fresh week, or the deload the user just accepted never reaches the bar.
- **The GET normalises what it read.** A generation-time floor cannot reach a row already stored and
  those live up to seven days: four single-set prescriptions were live on 2026-07-28, one of them
  `auto_applied` and actually loading the bar, and an accessory sat at 77.5% beside a primary
  prescribed 76%. Pinned: the two-set floor, the anchor load cap, and a stored
  `transition_recommended` to the phase you are already in rewritten to `stay`.

Also pinned: the stale-baseline auto-heal (completes from personal records when the completion
endpoint was never reached, leaves a genuine baseline week alone, and asks for prior logs **within
the active program only** — a shared exercise name under a different program must not let a fresh
cycle skip its own AMRAP week); the card signals coming from two cheap reads rather than the full
25-query aggregation; `Cache-Control: private, no-store`; ownership before anything else on the GET;
and both refusal ladders, including the generator's own failure status surviving instead of
collapsing to a 500.

`scripts/check-route-test-coverage.js` baseline 128 → **125**. `workout-data` is the last of the
twelve that were believed covered.

## Notes

- **A case was vacuous and only the mutation pass showed it.** The `.strict()` assertion on
  `respond` ran against a state whose prescription was null, so every body was a 400 for the *next*
  reason down and the case passed with the schema removed. Rewritten against a state that would
  otherwise succeed. This is the second time in two PRs that mutation testing caught something
  reading could not — the first was a guard of mine that was dead *and* weakening.
- **Twenty-one mutations** across the three routes: dropping the read normalisation and its
  `roleById` argument, the no-store header, the ownership check, the program scope on the heal, the
  heal condition, the re-store after `advancePhase`, the deload conditions in three directions, the
  expiry, the no-prescription guard, both `.strict()`s, the timezone, the forwarded arguments, the
  generator's status, the rate limit, the uuid guard, the preset default, and the size limit. All
  caught, each by the case that names it.
- `normalizeStoredPrescription` and `buildCardExerciseSignals` are **not** mocked — they are what is
  worth holding. `generatePrescriptionForSession` is; it is the whole generation engine and has its
  own tests.
- Four `ai-periodization` routes remain uncovered (`baseline/complete`, `program-overview`,
  `…/transition`, `weekly-volume`) — they are a coherent next batch, but not one this PR needed.
