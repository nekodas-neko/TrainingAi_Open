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
