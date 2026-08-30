# 2026-08-30 — Q-270: what the empty column is NOT, and a crash found by finally running it

**Branch:** `fix/training-stress-column-empty` · **Lane:** A · **Domain:** readiness / devices

## The state of Q-270

`training_load_ots` is **0 of 104 days** in production — ten days after the previous re-check, and
fifteen after a fix that was supposed to populate it. The entry's own re-check condition (*"if it is
still 0, the diagnosis was incomplete"*) has now fired twice.

This session did not fix it. It **ruled things out**, which is the thing the entry keeps lacking:
each previous attempt started from a guess and shipped against it.

## Ruled out, all measured

- **All four gates pass, on all eight most recent days** — evaluated per date the way the route does
  rather than in aggregate: readiness `ble-derived` with a score, `n_history` 48–55 against a floor
  of 14, resting heart rate present, sex and date of birth present.
- **The MET gate passes from midday.** Samples span the whole local day — first 00:02–00:14, last
  22:25–23:55, **1,338–1,427 minutes** against a floor of 720. So the "today is a partial day"
  hypothesis I started from is wrong; it clears by ~12:07 local.
- **The route is not erroring.** `error_events` holds no `/api/training-stress` row over seven days.
- **The write path is correct.** `trainingLoadOts` is in `DERIVED_COLS`, and the upsert's COALESCE
  arm updates rather than swallows a real number — now pinned by a test.

So the route is **neither failing nor succeeding**: it is not being called, or is called and returns
`gated`, and nothing distinguishes those from outside.

## The structural finding

The persist is a side effect of a GET, fires only on `status === 'ok'`, and leaves no record that
the route ran or what it decided. **That is why this entry has been wrong twice** — a session that
cannot tell "not called" from "called and gated" has to guess, and both guesses so far were wrong.
The entry now says to fix the observability before the cause.

## The crash, found by doing what the entry asked

Q-270 says the persist is unproven locally. Proving it meant running `computeTrainingStress`, and it
**threw** — out of `runTrainingStressScore`, whose own docblock says *"Infallible: never throws."*

`validate` bounds rhr, readiness and vo2max but **not age**. `getAgeGroup` then clamps only the TOP
for female/male (`age >= 80 ? 80`) while the `other` branch clamps both ends, so an age below the
lowest group leaves `indexOf` at -1, indexes `table[-1]`, and hands `undefined` to `argminAbsDiff`.
The route calls it with no try/catch, so `GET /api/training-stress` 500s for that user.

Filed and shipped as **LA-40**: `getRhrCategory` returns null for a missing row and the score
returns null — the "can't produce a result" path already promised. **Not** a clamp: the low bound
the `other` branch uses is vendor behaviour, and inventing the same number here would be guessing at
the model's intent from outside it.

The owner is 33 and safe. The app has other users and a Play Store listing is the stated direction,
so a teenage user or a mistyped date of birth is a live path — and it also fires on any partial
constants table, which is not hypothetical: `lib/oura-models/constants/index.ts` records a route
reading `OURA_CONSTANTS_DIR` as undefined while boot logged success, and the 12 `/api/body-battery`
rows in `error_events` (last 2026-08-23T20:59) are that incident.

## Files

- `lib/oura-models/inference/ots.ts` — the infallibility fix.
- `lib/oura-models/inference/__tests__/ots.test.ts` — 2 new cases, running **without** the vendored
  constants, which is the only reason they run in CI where every parity block skips.
- `lib/data/postgres/__tests__/training-stress-persist.test.ts` — new; its upsert case runs
  everywhere, its two OTS cases guard on `hasRealConstants()`.
- `docs/implementation-backlog.md` — Q-270 rewritten around what is ruled out; LA-40 filed.

## Verification

`tsc --noEmit` clean. The two new test files pass (4 passed, 6 skipped for absent vendor constants).
**Mutation-verified:** removing the null guard makes both LA-40 cases fail with the original
`TypeError: Cannot read properties of undefined (reading 'length')`.

**A limitation worth stating rather than hiding:** the OTS parity fixtures here are *synthetic* —
their age-group table is `[7, 8, 1, 2, 3, 4, 5, 6]`, structurally well-formed and semantically
arbitrary — so no test on this machine can compute a real OTS. That is why the Q-270 repro's two
scoring cases skip, and why the LA-40 test was written to discriminate on the synthetic set instead.

**Not exercised:** production. I cannot call `/api/training-stress` there (it needs a session) or
read Railway's logs, which is exactly the boundary the observability finding is about.

## What is still open

Q-270 itself, with two named candidates and neither proven: `warmCache` returning early on a cached
`today:` key without checking its date, and a constants-delivery miss. Also unquestioned until now:
**every caller passes today**, so a completed day is only ever scored while still in progress.
