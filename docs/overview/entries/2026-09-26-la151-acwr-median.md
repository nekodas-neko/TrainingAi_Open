# 2026-09-26 — LA-151 ①: the ACWR median, and the consumer the entry named that does not exist

**Branch:** `refactor/la151-acwr-median` · **Lane A** · closes `LA-151`'s `acwr.ts` item

## What shipped

`computeVolumeAcwr` computed `typicalSessionVolumeKg` as `sorted[floor(n/2)]` — the upper of the
two middles, with `0` for an empty window. It now uses the shared `median` from `stats.ts`
(LA-148), keeping `?? 0` because every consumer is typed against `number` and the window is gated
by `minSessions` before anything acts on it.

Also corrects the score audit's display, which had begun contradicting itself.

## The entry's reason for taking this first was wrong

`LA-151` — which I wrote — said take `acwr.ts` first because it "feeds training-load advice". It
does not. `typicalSessionVolumeKg` is declared on `ActivityScoreInput` and **never read**:
**Q-190** replaced the volume lane's denominator with the absolute `sessionVolumeGoalKg`, on the
reasoning that a target built from the user's own median is a treadmill — train harder, the median
rises, the target rises, the score stays put.

So the bias reached a **display** and nothing that computes. That is the third entry today whose
measurement was sound and whose conclusion about blast radius was not, and the check cost ten
minutes.

## Measured before assuming

Over the owner's **119 real sessions across 180 days**, comparing the two tie-breaks on each
rolling 28-day window:

| | |
|---|---:|
| days simulated | 121 |
| identical | 74 (61%) |
| differ | **47 (39%)** |
| median absolute difference | **1.85%** |
| largest | **21.13%** |
| upper-middle higher on every differing day | **yes** |

Always upward, so it was a systematic bias, not noise. Had it still been the volume-lane
denominator, a higher denominator would have made the target harder and depressed the score on two
days in five — which is exactly why the measurement came before the edit rather than after. No
score moves, so no owner gate.

## The contradiction in the audit

Two adjacent rows of the score audit the owner can open:

- `sessionVolumeGoalKg` — *"Absolute per-session target (Q-190) — deliberately NOT the median of
  your own sessions."*
- `typicalSessionVolumeKg` — *"Median single-session tonnage — **the volume-lane denominator**."*

Q-190 changed the first and left the second's note behind. The second now says it is reported for
context and points at the row above.

## The test that was doing nothing

`typicalSessionVolumeKg is the median session volume` used three sessions — an **odd** count — so
it passed under both tie-breaks and pinned neither. Added an even-count case (500/1000/3000/5000 →
2000, not 3000) and an empty-window case, then **verified the new test fails against the old
implementation** before restoring.

## Not done

The other seven copies in `LA-151`, and the dead `typicalSessionVolumeKg` input, which is threaded
through six files and is cleanup rather than part of this fix. Both recorded on the entry, with the
lesson: establish what actually reads a number before deciding how risky its tie-break is.
