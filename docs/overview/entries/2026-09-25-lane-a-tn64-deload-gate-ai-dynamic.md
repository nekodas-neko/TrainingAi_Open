# TN-64 (b) and (c) — the deload gate reaches the mode the app actually uses

**Branch:** `lane-a/tn64-deload-gate-ai-dynamic` · Lane A · v1.465.43. Follows TN-64(a) (#1594),
which put the ACWR on the record so this change could be judged at all.

## The one-line change, and why it was worth three parts

```
- if (program?.phaseMode === 'automatic') {
+ if (program?.phaseMode === 'automatic' || program?.phaseMode === 'ai_dynamic') {
```

`earlyDeloadRecommended` is the only place a readiness score automatically changes what the app
prescribes. It had never fired in 118 sessions, and the reason was not the thresholds. Measured on
production: of five programs, **three are `ai_dynamic` and two are `automatic` — and the two
`automatic` ones are the oldest (May 23, Jun 5) and both inactive**, while the active program
(*Bankai*) is `ai_dynamic`. `automatic` is the legacy mode. The gate had been unreachable for every
session logged since the owner moved across.

The owner answered this on 2026-09-24, taking the recommendation as written over *delete the gate*
and over *lower the thresholds*.

## What was deliberately not done

**`manual` stays out.** Under it the owner drives the phases himself, so the app proposing one is a
different product question and nobody has answered it. A later tidy-up to `!== 'manual'` would
answer it by accident, so a test pins the exclusion.

**The thresholds are untouched** (`EARLY_DELOAD_SCORE_MAX` 45, `EARLY_DELOAD_ACWR_MIN` 1.2). Moving
them in the same change would make a new prompt ambiguous between *the gate opened* and *the bar
dropped*. A threshold change is Tuning's proposal.

**(c) required no code.** The read path only ever set a flag; `confirmEarlyDeload` is reached from
one place, an authenticated `POST /api/confirm-early-deload` that refuses any program but the
active one. That is now pinned by a test asserting `readiness-payload.ts` never mentions
`confirmEarlyDeload` — because the reversibility of (b) rests entirely on it. Widening the gate
widens **who is asked**, not what happens.

## A finding filed rather than fixed — LA-138

Building this surfaced something the entry does not mention: **`program_phases` holds 0 rows for
all five programs**, and the active program's `started_at` is NULL, which short-circuits the phase
lookup before it runs. So `inDeloadPhase` has always been `false`, and the guard meant to stop the
app recommending a deload *while already in one* has never suppressed anything.

That was harmless while the gate was unreachable. Now it is the difference between being asked once
and being asked during a deload week — still only a redundant question, since every prompt needs
confirmation. It is filed as **LA-138** rather than fixed here, because the prior question is
whether `ai_dynamic` is meant to write phase rows at all or tracks its cycle elsewhere; answering
that wrong means populating a table nothing reads.

## Verification

`tsc` clean · Custom Rules **78 of 78** · full suite green · the gate tests **12 passed** with the
sibling threshold file.

Mutation pass — **4 mutants, 4 killed**, 1 equivalent control survived:

| mutant | outcome |
|---|---|
| revert the widening (back to `automatic` only) | killed |
| over-widen to any non-null `phaseMode` (admits `manual`) | killed, 2 tests |
| inline `45`/`1.2` instead of the named constants | killed |
| the read path calls `confirmEarlyDeload` itself | killed |
| *control:* the two disjuncts swapped | survived, correctly |

**One process note.** The first attempt at the revert mutant used `sed` with `|` as the delimiter
against a pattern containing `||`; it errored and never applied, and the run then reported
**exit 0, all passed** — which reads exactly like a surviving mutant. Only the `sed` error line
distinguished them. A mutation that fails to apply is indistinguishable from one the tests miss,
so the assertion is worth making explicitly: re-run it, and check the file actually changed.

## Not verified

**Whether the prompts are any good.** This entry's own success test is *"a prompt appearing on a
genuinely low day"*, which needs the owner watching it — recorded as the entry's `Keep:`. And the
ACWR column only fills forward from 2026-09-25, so there is no history to judge against yet.

**No device check, and none is owed** — server-side logic on a read path. The card itself is
existing UI that has simply never had the chance to render.
