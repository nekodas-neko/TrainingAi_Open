# 2026-09-16 — "why would it recommend Upper?" — the answer is the engine is right, and the bug is beside it

**BugFix intake.** Docs-only. Owner, on the home card recommending **Upper** the day after Push,
with chest, shoulders and triceps listed as sore: *"How does this work? I did push yesterday which
was an upper- why would it reccomened upper?"* Two entries filed: **BF-171** and **BF-172**.

## The recommendation was correct, and reproducing it is what found the defect

`computeAiDynamicNextSession` does not reason about Push/Pull/Upper/Lower labels — it scores muscle
overlap, recency and how overdue each session is. Fed his real program (`Bankai`), his seven logged
sessions since 2026-09-07 and his real check-in, a scratch harness reproduced his screenshot's
alternatives list to the point:

| session | overall | recovery | balance | freshness |
|---|---|---|---|---|
| **Upper** | **84** | 70 | 100 | 100 |
| Pull | 82 | 91 | 50 | 100 |
| Lower | 74 | 62 | 81 | 100 |
| Legs | 59 | 57 | 33 | 99 |
| Push | 37 | 43 | 16 | 48 |

Upper's chest, shoulders and triceps **are** penalised — every sore main-role muscle is clamped to
40. But five of Upper's nine weighted muscle-units are back and biceps, last trained Sunday at 95%
recovered, and Upper has not run for six days. `70 × 0.55 + 100 × 0.25 + 100 × 0.20 = 84`. Push
scores 37. **The plain-English answer: "Upper" here is half a Pull session, and the engine is
answering at the muscle level rather than the label level.**

## BF-171 — the one function in the repo that matches muscle names raw

`sessionRecoveryScore` compares muscle names with exact lowercased equality on both sides.
Two things fall through it, both measured on the same harness:

1. **Sore "Back" clamps nothing.** The check-in picker offers a **Back** pill; the exercise library
   has `lats`, `upper back` and `traps`, and no `back`. Adding `Back` to his sore list moves every
   one of the five scores by **zero**.
2. **`core` never finds its recovery.** `computeMuscleRecovery` keys through `normalizeMuscle`,
   which folds `core` → `abs`; the assignments say `core`. The lookup misses and a miss returns
   **100**, while the same payload carries `{"muscle":"abs","pct":86}`.

`moodMuscleMatches` exists for exactly this and is used by six other consumers. The seventh — the
one that picks the session — is the one that does not use it.

**Worth carrying forward:** the two limbs currently cancel. `core` matches the sore pill exactly
while missing the recovery lookup, so fixing only the recovery side **raises** Legs 59 → 62 and
Lower 74 → 77. A half fix moves scores the wrong way; the entry says so.

## BF-172 — the explain screen calls the fit score "readiness"

`session-explain-content.tsx:31` renders `overallScore` as *"Overall readiness for this session"*
and bands it with `scoreBand`, the readiness ladder. So the screen leads with a green **84 HIGH**
labelled readiness, directly above its own signals reading **readiness 37 · Low**, HRV well below
baseline, and **strong deload advised**. Same class as BF-154 — a number correct in its own terms
under a caption belonging to a different quantity.

## Not filed

The ordering itself, the 0.55/0.25/0.20 low-readiness reweighting, and the freshness and balance
components were checked against the reproduction and all behave as documented.

## What was not exercised

Nothing ran on the S25. Both entries are settled off-device by design — BF-171 is pure shared math
with a unit test named in the entry, BF-172 is a caption in the browser.

## Follow-up: *"is this correct or should it have been lower?"*

Two further hypotheses measured, both cleared, both written into BF-171 so they are not re-opened:

1. **Freshness and balance are session-name-keyed while recovery is muscle-keyed.** True —
   **44.4%** of Upper's weighted muscle work was trained in the previous 24 h and it still scores
   freshness 100 — but it changes nothing, because Upper's muscle-weighted age is **49.7 h**, past
   `sessionFreshnessScore`'s 48 h cap. A muscle-derived freshness saturates at 100 too and Upper
   lands at 83.5. Push is the only session it moves, and it moves further from selection.
2. **The overlap is invisible to the score.** It is not; it is already Upper's recovery 70 against
   Pull's 91.

**So 84 is correct as a fit score, and the app's verdict was never "you are fresh"** — it said
strong deload advised, offered Rest, and showed readiness 37. What remains true is that Upper 84 and
Pull 82 is a near-tie decided by under a point, with the better-recovered session losing only on
being less overdue. That is a design call for the owner rather than a defect, and it is noted in
BF-171 without a separate entry.

## Second follow-up — the owner was right, and BF-173 is the reason

*"I trained push/upper body yesterday and legs the day before. Surely it would see that I trained
the muscles it wants to use today - yesterday. Legs would be more recovered?"*

The model agrees with him and the score discards the agreement. `computeMuscleRecovery` has his
quads at **69**, hamstrings **63**, glutes **73** against chest **49**, shoulders **45**, triceps
**59**. But `suggestedSoreMuscles` auto-ticks anything trained within 48 h and under 85% recovered —
reading *that same output* — and `sessionRecoveryScore` then clamps every ticked main muscle to
`min(pct, 40)`. Quads scored 69 by the model are scored 40 by the picker. One fact, counted twice,
the second time harder.

Because the clamp is a flat floor it also flattens the ordering: quads at 69 and chest at 49 both
land on exactly 40, so the very comparison he is making is deleted before it reaches the score.

**It changes the answer.** Same day, leg ticks removed: **Lower 85 wins**, Upper 84, Pull 82, Legs 72,
Push 37. The leg soreness ticks are the entire reason he got Upper.

Measured and rejected as the fix: replacing the clamp with `pct × 0.6` preserves the ordering and
leaves the winner unchanged (Upper 82.0, Pull 81.7, Lower 75.8). The defect is the double count, not
the clamp's shape — the entry says so, so it is not re-tried.

`mood_logs` has no provenance column, so nothing downstream can tell a volunteered report from an
accepted suggestion. That is what makes the clean fix a schema change, and it is why BF-173 carries
`Gate: owner` rather than a chosen direction.

**Filing order matters:** fixing BF-171 makes BF-173 worse, because normalising `core` → `abs` adds
another correctly-matched muscle to the double count.

## Third follow-up — the owner's two proposed fixes, measured

*"I think an option would be to look for a muscle group trained within the past 24 hours instead.
And also there should be different scoring recovery for smaller muscle groups like abs vs quads."*

**The 24 h auto-tick window** does flip the pick to Lower — by **0.4 points** (Lower 84.4, Upper
84.0). Recorded in BF-173 and not recommended: it decides the pick by less than half a point while
the double count stays live inside 24 h, and the 48 h window is separately load-bearing for the
per-exercise deload, whose own source comment calls back-to-back leg days at 46-47 h *"exactly the
case worth deloading"*. The separation worth keeping is 48 h for the deload question, no double
count for the selection question.

**Per-muscle recovery constants** are filed as BF-174. The model has one base `tau` of 24 h for
every muscle, scaled only by bout volume against that muscle's own median — no notion of size. A
probe (abs/calves ×0.75 … quads/glutes/hams ×1.25, invented, not fitted) moves abs 86 → 93 and
quads 69 → 63, and the `Math.min(48, …)` ceiling is already binding on the large muscles, so
hamstrings do not move at all.

**The interaction is the finding:** on its own the per-muscle base does not change the pick, and
**combined with the 24 h window it cancels it** — slower large muscles lower the leg sessions,
undoing what the narrower window gave them. Both of the owner's ideas land on Upper together and
Lower separately. That is the argument for fitting BF-174 against data rather than shipping a
plausible table, and for BF-173 landing first.

## Owner decision — provenance, and the premise confirmed

*"It auto picked muscles for me i didnt choose them manually."* — **BF-173 was filed with that as an
inference from `suggestedSoreMuscles`'s thresholds; it is now a statement from the lifter.** It also
promotes the defect from an edge case to the normal path: if he does not hand-tick, every tick in
`mood_logs` is a suggestion echo and the clamp has double counted on every check-in.

*"Happy to go with your recommendation."* — **provenance**, over the cheaper no-schema suppression.
The gate on BF-173 is cleared and the alternative stays recorded as the fallback if the migration
proves to be the expensive half.

**Two consequences written into the entry so they are not re-litigated:**

- **The clamp will go dormant**, because with provenance and an owner who accepts the pre-selection
  no tick is lifter-added. That is the correct outcome — the recovery pct already carries the fact —
  and the entry says so, because an implementer who finds `Math.min(pct, 40)` never firing will
  otherwise "fix" it back.
- **The deload is unaffected, and this was verified rather than assumed.**
  `computePerExerciseDeload` (`per-exercise-deload.ts:30-51`) reads `soreMusclesInSession` from the
  mood log through `moodMuscleMatches` and never touches `sessionRecoveryScore`. So the 48 h
  auto-suggest keeps driving deload while selection stops double counting — which is exactly the
  separation the entry argued for, now confirmed in code.

BF-173 and BF-171 move to the top of the queue, **sequenced rather than batched**. The first attempt
batched them — both edit `sessionRecoveryScore`, both settle on the same unit tests — and
`next-item.js` rejected it correctly: the provenance fix carries a migration, and a migration never
batches because its revert is a corrective migration. `Needs: BF-173` on BF-171 gets the same
ordering guarantee at no revert risk, and the ordering genuinely matters — BF-171 landing first
would make the recommendation worse, since every muscle it newly matches is a muscle BF-173's double
count then clamps to 40.
