# Does rushed rest cluster in time-constrained sessions? (Q-300)

**Measured 2026-08-24** against production via `/api/admin/db-query`. Q-300 asked this before its
secondary half — rest adherence as a coaching signal — could be treated as a user-behaviour finding
rather than a scheduling artefact, and flagged Q-85 (a shortened session keeps full-length rest
periods) as the adjacent hypothesis.

**Answer: no — and Q-85's hypothesis cannot be tested with this data at all.** The rushing is
uniform, and the one thing that would show a time budget is absent from every measurable session.

## The data

`set_logs` rows with both `rest_time_sec` and `planned_rest_sec > 0`, joined through `exercise_logs`,
soft-deletes excluded. **n = 344 sets across 27 sessions, 2026-07-18 → 2026-08-23** — the window
starts at the `planned_rest_sec` cutover (migration 126), which is what bounds this measurement.

| | |
|---|---|
| mean rest taken | **95 s** |
| mean rest planned | **110 s** |
| rushed (< 75% of planned) | **137 (39.8%)** |
| overlong (> 150% of planned) | **55 (16.0%)** |

Q-300 filed 37% rushed on n = 276. On 68 more sets it is 39.8% — the same finding, not drift.

## 1. It is uniform across sessions, not episodic

Per-session rushed fraction, over the 26 sessions with ≥ 5 measurable sets:

| | |
|---|---|
| mean | **0.411** |
| sd | **0.138** |
| sessions with **no** rushed sets | **0** |
| sessions ≥ 80% rushed | **0** |

A time budget is an event: some sessions get squeezed and others do not, which shows up as a bimodal
split with a clean tail. This is a single narrow cluster spanning 0.11 to 0.60, with **every session
rushing something**. That is a pacing habit.

## 2. Session duration correlates, and the correlation is circular

Shorter sessions do rush more — the five sessions at 0.60 run 33–57 min, the three lowest run
49–92 min. **This is not evidence.** Rest is a component of session duration, so rushing rest
*produces* a shorter session. Reading it the other way round would be inferring the cause from its
own effect. Duration cannot separate "ran out of time" from "rests briefly" and should not be used to.

## 3. Rushing drifts up within a session, on a floor that is already high

By exercise position (1 = first logged):

| position | n | rushed |
|---|---:|---:|
| 1 | 81 | 0.321 |
| 2 | 77 | 0.416 |
| 3 | 71 | 0.394 |
| 4 | 58 | 0.414 |
| 5 | 57 | **0.474** |

There is a real drift — 0.32 → 0.47 — and it is the one signal here consistent with time pressure
accumulating. But it sits on a **0.32 floor at the very first exercise of the session**, before any
budget could have been spent. Time pressure can account for the slope; it cannot account for the
intercept, and the intercept is most of it.

## 4. Q-85's hypothesis has no instances to cluster in

Completed sessions by exercise count, split at the cutover:

| exercises | pre-cutover | **post-cutover** |
|---:|---:|---:|
| 0–4 | 17 | 0 |
| 5 | 23 | **26** |
| 6 | 14 | 0 |
| 2 | 0 | 1 |

Every shortened session in the history predates `planned_rest_sec`. In the window where adherence is
measurable at all, **26 of 27 sessions are the same 5-exercise shape**. So this data cannot say
whether a shortened session keeps full-length rest periods — there are no shortened sessions in it.
Q-85 stays open on its own evidence; it is not confirmed and it is not refuted here.

## What the data does say, which is a better finding

Actual rest barely responds to what was prescribed. At the three well-populated planned values:

| planned | n | mean actual | rushed |
|---:|---:|---:|---:|
| 60 s | 40 | **75 s** (+25%) | 0.300 |
| 90 s | 44 | **65 s** (−28%) | 0.477 |
| 120 s | 121 | **110 s** (−8%) | 0.347 |
| 187 s | 9 | **133 s** (−29%) | 0.444 |

Prescribed rest spans 60–187 s; actual rest spans 65–133 s, and at the shortest prescription the
owner rests **longer** than asked. The prescription is compressed toward a personal pace rather than
followed — which is a coaching finding about the plan being unrealistic or unnoticed, not about the
lifter running late.

## Consequences

- **Q-300's secondary half is confirmed as a user-behaviour finding.** Surfacing rest adherence is
  worth doing, and the useful framing is "your actual rest ignores the prescription" rather than
  "you rushed today", which the uniformity makes meaningless.
- **Do not use session duration as a rest-adherence covariate anywhere.** It is downstream of the
  thing being measured.
- **Nothing here licenses a rest term in `expectedRpe`.** The 2026-08-16 measurement already showed
  rest is not Q-289's confound; this shows the rushing has no session-level structure a model could
  key off either.
