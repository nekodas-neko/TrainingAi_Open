# 2026-08-16 — the deferred measurements, taken

**Branch:** `claude/gym-app-comprehensive-review-j38fo9` · **Type:** review, docs-only ·
**Backlog:** no new numbers — **Q-292, Q-298, Q-300, Q-304 amended**

Sixth round. Every previous one filed entries that said *"measure this first, it may change the
fix"*. This one takes those measurements rather than leaving them for an implementer, because they
were all answerable from data already in hand.

## Two entries changed shape

**Q-304's escape hatch was tested and did not fire.** I had filed it with an explicit out —
`prescriptionFactor` might already absorb the high-rep inflation, and closing the entry as
measured-and-rejected was named an acceptable outcome. It isn't: **28 of the 29 sets at 13+ reps
that feed the 1RM carry no `planned_pct`**, so the factor returns 1 and the raw curve stands. The
proxy turned out exact rather than approximate — `log-exercise.ts:233` writes the same value the
factor consumes.

**Q-300's question is answered, and the answer removes a dependency.** It said to split Q-289's
buckets by rest adherence before recalibrating anything, and named the two outcomes. The
miscalibration **persists in all four bands** (expected-10: −1.75 on-target, −2.80 rushed, −2.33
overlong, −2.21 unknown). Rest is a contributor, not the explanation. **Q-289 should not wait on
it**, and Q-300 is re-scoped to its secondary half.

## The synthesis I didn't expect

The `unknown` rest band had the worst error, which is not a fact about rest. Splitting by whether a
**prescription** was recorded at all: prescribed **r = 0.499 / MAE 0.88**, unprescribed
**r = 0.297 / MAE 1.08**. So `prescriptionFactor` is doing real work *and* is not enough — both
groups still clear the dead band at expected-10.

The sharp end: **unprescribed light sets average +2.36, above the 2.0 emergency-deload threshold**,
not merely the 1.5 autoregulation band. Q-289, Q-299 and Q-304 turn out to share one upstream cause,
and the highest-leverage fix is the one none of them names: **get a progression style recorded on
more than 28% of sets.**

## Q-298 is down to one line

`log-exercise.ts:196` zeroes the 1RM when **either** the AI flag or **the phase** says deload;
**line 264 stores only the AI flag**. That is the whole bug, and the file's own comment at 190–191
already states both cases must not feed the estimate. They don't — only one is recorded.

Three rounds to get here: filed wrong, corrected (half the rows were by design), resolved from
production data, now pinned to source. Each step was cheap because the previous one wrote down what
it had actually checked rather than what it assumed.

## The AI audit, finished

All 117 insights, not the 8 I'd read: **7 imperial-unit errors** (all Fahrenheit, all in `sleep`)
and **12 absolute superlatives** — about **16% carry at least one**. A second fabricated superlative
is double-confirmed: *"a perfect recovery index"*, for a contributor **Q-271 measured has never
exceeded 50 on any of 31 scored days** because its anchor is unreachable.

One hit I want on the record as a **false positive**: a regex flagged
*"despite your illness radar remaining normal"* as train-through-illness advice. Reading it shows it
describes the radar. Counting it would have been the kind of finding that erodes trust in the rest.

## Blocked

**Railway per-query RTT** — Q-308 needs it before anyone touches the sync fan-out, and it cannot be
measured from the sandbox. Instructions handed to the owner.
