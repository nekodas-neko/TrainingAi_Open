# 2026-09-15 — the illness radar was written to degrade and its only caller never let it (PS-42)

**Branch:** `lane-a/ps42-illness-radar-generic-path` · **Lane A** · no version bump — nothing changes for a ring user

## What shipped

`computeIllnessRadar` takes four optional weighted signals — temperature 0.40, breathing 0.25,
resting HR 0.20, HRV balance 0.15 — and renormalizes over whichever are present. It is built for
partial input. Its only caller ran it as `latestSummary ? compute(…) : null`, so a user without a
ring got **no illness computation at all**: not a degraded one, not a `learning` one, nothing.

It now runs on the generic branch too, with `tempZ` and `breathZ` null (no generic source supplies
either, exactly as the generic readiness composite already leaves its temperature contributor null)
and the resting-HR and HRV z-scores taken from the composite rather than recomputed.

**Nothing changes for a ring user**, and that was checked rather than assumed: the owner has
`oura_daily_summary` for **30 of the last 30 days**, so `latestSummary` is non-null and his branch is
untouched.

## What is genuinely new behaviour

A generic user's readiness can now be **suppressed** by the radar, because line 593 subtracts
`illness.readinessSuppression` from the score and that line was already there — it simply never had
a non-null `illness` to read on this path. That is the point of the entry rather than a side effect,
but it is a score moving for a class of user, so it is stated plainly rather than buried: an elevated
or fever flag will dock a ring-less user's readiness the same way it docks a ring user's.

`learning` suppresses nothing, which the tests pin.

## The mutation pass found something the tests could not

Five mutants. Three were caught, and **two survived — both correctly**, which is the useful result:

| Mutation | Outcome |
|---|---|
| revert to the ring-only gate | ✅ caught |
| approximate the absent signals as `0` instead of omitting them | ✅ caught |
| fire the radar with no composite at all | ✅ caught |
| **claim a mature baseline (`nHistory: 99`)** | survived — **equivalent** |
| **control** — the z-scores recomputed inline rather than hoisted | survived — equivalent, as intended |

The `nHistory` mutant looked like a hole and is not. `trailingBaselineZ` needs
`BASELINE_MIN_NIGHTS` **prior** samples before it returns a number at all, so on this path a non-null
z-score already implies `genericNHistory >= BASELINE_MIN_NIGHTS`. The two gates are coupled:
**whenever there is a signal to judge, the baseline is already mature**, and the radar's own
cold-start gate can never be the one that fires here.

That also means the "stays in learning" test pins `signals.length === 0`, not baseline maturity — it
passes for a different reason than its old name claimed. Renamed, and the coupling is recorded in
both the test and `readiness-payload.ts`, because it is an accident of the current threshold: lower
`trailingBaselineZ`'s minimum and the gate becomes load-bearing the same day. Both gates stay.

## Verification

Four tests in `lib/health/__tests__/illness-radar-generic-path.test.ts`, driven through the real
`buildReadinessPayload` with a mocked repository rather than through the formula — the formula was
never the defect, the wiring was. They cover a radar existing at all for a ring-less user, the two
unsupplied signals being **absent** rather than zero (a zero is a claim about a measurement nobody
took, and temperature carries the heaviest weight), `learning` with no suppression and no advisory,
and nothing at all when there is no recovery signal to judge.

Fixtures derive their dates from the clock: the payload builds its own 28-day window from today, so
a hardcoded date walks out of that window and the fixture silently stops contributing.

Full gate green: `Ran 75 of 75 Custom Rules steps`, lint, both typechecks, full suite.

**Not exercised: a real generic account.** The sandbox has no Health-Connect-only user, and the owner
cannot be one — he has a ring, which is what makes his path safe here and also what makes it
unverifiable from his account. The entry's own verification step wants a test account with
`body_metrics`/`sleep_sessions` populated and no `oura_daily_summary` row; that is still owed.
