# 2026-09-04 — I filed LA-57 yesterday and it is wrong (Q-509 candidate 3)

**Branch:** `fix/la57-hrv-ramp-not-step` · **Lane:** A · **Domain:** readiness / devices

Docs-only, and the deliverable is a retraction plus the measurement that forces it.

## What I got wrong

LA-57, filed 2026-09-03 by this same agent, said night HRV **doubled at the 2026-07-07 re-key** —
`body_metrics.hrv_ms` 26.9 (Cloud, n=14) → 55.9 (BLE, n=59), with per-night ranges of 20–39 before
and 40–56 after, *"no return and no overlap to speak of"* — and concluded **"a doubling within days
is a measurement-definition change, not physiology."**

Both observations are what a **monotonic ramp** produces when it is cut in the middle.

## The measurement that settles it

Night HRV **inside the BLE era alone** — one device, one decoder, where a definition change is not
possible:

| week | n | night HRV (ms) |
|---|---|---|
| 2026-07-06 | 5 | 45.5 |
| 2026-07-20 | 7 | 52.9 |
| 2026-08-03 | 7 | **63.0** |
| 2026-08-24 | 7 | 56.6 (one night at **26.5**) |

**+38% within a single device era**, then a plateau. A change in which statistic is computed gives a
step and a new stable level; it cannot make values keep climbing for five weeks under an unchanged
decoder. And the ranges overlap after all — that 26.5 ms night sits inside the 20–39 band the entry
attributed to Cloud-era measurement.

Weekly daily-HRV means across the boundary run 21.8 → 31.1 → **41.6 (the re-key week)** → 46.4 → 52.9
→ 59.2 → 68.0. The boundary week sits on the line between its neighbours, and the ramp continues four
weeks past it. RHR does the same in reverse: 68.3 → 50.0.

## What is still open, narrowly

Whether a definition change *also* sits underneath the ramp. Nothing here excludes it. What is
excluded is the evidence LA-57 offered — pre/post means and non-overlapping ranges, both of which a
ramp produces unaided. Testing it properly means modelling the trend and fitting a discontinuity
against it, on about **two weeks** of pre-boundary HRV. That is thin, and it is different work from
what the entry describes. The RMSSD-vs-SDNN check is still worth doing on its own terms.

## Q-509's candidate 3 closes, the other way up

The 2026-09-03 measurement stands: `recovery_index_hours` is flat over 58 BLE nights. Its reading was
wrong. **It is not that nothing was changing** — night HRV rose 38% and RHR fell 6 bpm across exactly
those nights, steps rose 5,618 → 7,558 and weight 68.35 → 71.45 kg. The metric named for recovery did
not respond to any of it.

So candidate 3 does not close as "no physiological change to find". A large one happened and the
metric ignored it — **independent corroboration of Q-509's own estimator-bias conclusion**, reached
without the anchor-ratio argument.

## A caveat I raised and discarded

`oura_daily_summary` holds no rows before 2026-07-07, which suggested the Cloud-vs-BLE refit might
compare **two different estimators** rather than one estimator on two inputs. It does not:
`oura_heartrate` carries Cloud-sourced series from 2026-06-22 to 07-06 and `ble` from 07-06, so our
estimator ran on both. Q-509's framing is sound. Written down because the next reader will notice the
same empty table and should know it was checked, not missed.

## The pattern, third instance in one session

A before/after mean across a trending series manufactures a step. The other two: mixing
`pg_database_size` with a user-table sum on BF-55, and reading `computed_at` as a per-score stamp on
LB-53. All three are the same mistake — comparing two things that are not the same measurement and
attributing the difference to the subject.

## Not exercised

Production was read only, through `claude_ro`, which is row-scoped to the owner — one person's data,
which is the right scope for this question. No code changed. Weekly means, no smoothing; the
2026-07-06 week straddles the re-key and is reported as-is.

## Gates

`pnpm check:rules` 68 of 68 · `check-backlog-pointers` OK, 290 entries.
