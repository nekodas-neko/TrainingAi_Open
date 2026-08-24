# Rushed rest does not cluster in time-constrained sessions (Q-300)

**Branch:** `feat/rest-adherence-signal` · **Lane A** · docs-only · no code change

## Why this is a measurement and not a feature

Q-300 asked for one thing before its remaining half could be built: *check whether the rushed sets
cluster in time-budget-constrained sessions before treating this as a user-behaviour finding.*
Building the coaching signal first would have shipped the wrong framing. Full working in
[`docs/reviews/2026-08-24-rest-adherence-clustering.md`](../../reviews/2026-08-24-rest-adherence-clustering.md).

## The answer

**No.** On 344 sets across 27 sessions (2026-07-18 → 08-23, the window `planned_rest_sec` exists in),
39.8% are rushed — holding the 37% Q-300 filed on 68 fewer sets. Per-session rushed fraction is mean
0.411, sd 0.138, and **zero of 26 sessions is rush-free while zero is mostly-rushed**. A time budget
is an event and would split the sessions into squeezed and unsqueezed; this is one narrow cluster.

## Two traps, both of which this nearly fell into

**Session duration correlates, and the correlation is circular.** The most rushed sessions are the
shortest — but rest is a *component* of duration, so rushing produces a short session. Reading it as
evidence of a budget infers the cause from its own effect. Duration is not a usable covariate here.

**Q-85's hypothesis has no instances to test.** Every shortened session in the history predates
`planned_rest_sec`; 26 of the 27 measurable sessions are the same 5-exercise shape. So Q-85 is
neither confirmed nor refuted — recorded that way rather than as a clean negative.

## The finding that replaces the framing

Actual rest barely responds to what was prescribed: planned 60 s → **75 s taken** (longer than
asked), 90 → 65, 120 → 110, 187 → 133. Prescribed spans 60–187 s; actual spans 65–133 s. The
coaching line is *"your rest ignores the plan"*, not *"you rushed today"* — the latter is meaningless
when every session rushes. Within-session drift is real (0.32 at exercise 1 → 0.47 at exercise 5) but
sits on a 0.32 floor before any budget could have been spent: time pressure explains the slope, not
the intercept, and the intercept is most of it.

## Not exercised

No code changed, so there is nothing to verify on device. **Q-300 stays open** — the surfacing itself
is unbuilt, and it is a Lane B UI change once the owner has seen this framing. Nothing here licenses
a rest term in `expectedRpe`; the 2026-08-16 measurement already showed rest is not Q-289's confound,
and this adds that the rushing has no session-level structure a model could key off.
