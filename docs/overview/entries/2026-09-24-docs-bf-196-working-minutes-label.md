# BF-196 — the session is exactly full and the label makes it look short

**Branch:** `docs/bf-196-working-minutes-label` · docs-only · BugFix intake

Owner: *"it says if I complete on time I will finish at 51 minutes which is less than the 60 — does
this sound right?? Ideally we can push that to the full duration?"*

It is right, and it is already at full duration. The estimate is not measured against the 60-minute
session budget — it is measured against the **working** budget, which is the session budget minus a
warm-up carve-out:

| term | value |
|---|---|
| session budget | 60 min |
| measured warm-up median (20 sessions, 30 days) | 9.3 min |
| carve-out, clamped to [4, 15] | 9 min |
| **working budget** | **51 min** |
| **his current Lower prescription** | **51 min** |

51 against 51. Add the warm-up back and it is the full hour. There is no nine-minute gap; what is
wrong is the comparison, and the card invites it — `ai-prescription-card.tsx:213` renders a bare
`~51 min` beside a session the lifter configured as 60, with nothing saying the warm-up is excluded.

Recommended: name the quantity — `~51 min working`. One word, no second line, and durable because
the carve-out is measured rather than fixed. Alternatives recorded with what each is better at:
showing both numbers (loses on card width at 384 dp, which BF-96 and BF-139 have each run out of),
estimating the whole session instead (loses because the card would then quote a different number
from the one the engine fits against — the divergence **One Formula, One Place** exists to prevent),
and a tooltip (loses because this is read mid-gym at a glance).

**This sharpens BF-189 and is recorded there too.** BF-189 asked why every exercise sits at the
2-set floor. The budget is binding to the minute, so "the engine is leaving room unused" is ruled
out and its three levers are the only ways to add volume. It also re-weights them: of those 51
working minutes, ~14.9 are bar-loading — a little under a third, and the largest reclaimable block.

The entry also warns against the tempting fix: `expandToBudget` exists and is gated on an explicit
long request on purpose. Its own comment says the conservative under-fill *is* the finish-early
margin. Here there is not even an under-fill to spend.

## Follow-up the same session — BF-197, and a correction to the entry above

The owner's next question was the useful one: *"bar load and rest time should be able to be analyzed
from past and can determine how much time is needed so not sure if that can be adjusted."*

**He was right, and the mechanism already exists.** `resolveTransitionSec` prefers his measured
per-exercise median over the constant, and `measuredRestSec` reaches the duration model the same way.
The estimate is already personalised. **It spends each learned number once too often:**
`estimateExerciseDurationSec` charges rest after every exercise's last set — which he skips on 93.5%
of 309 exercises — and charges a transition after the last exercise, where a session has N−1 gaps.

Reconstructed from his own medians (32 sessions, 45 days: transition **319 s/gap**, rest **107 s/set**,
set work **49 s**), for the live 5-exercise Lower plan:

| | as shipped | both off-by-ones fixed |
|---|---|---|
| 2 sets per exercise | **51.4 min** | 37.2 min |
| 3 sets per exercise | 63.8 min | **49.6 min** |

51.4 reproduces the 51 on his card to the tenth, so this is the shipped path rather than a model of
it. His measured working time runs a median **39.9 min** — the corrected figure matches it to 2.7 min,
the shipped one misses by 11.5. **Three sets on all five exercises corrects to 49.6 against the
51-minute budget: it fits, with no lever from BF-189 needed.**

**This withdraws a clause written earlier the same session.** The BF-189 amendment above concluded
that 51 = 51 *"rules out the engine leaving room unused."* The identity is real; the inference is not.
51 = 51 says the estimate fills its budget, not that the estimate is true. Against his measured median
the engine leaves ~11 real minutes unused. Both places that drew the wrong conclusion are struck in
place rather than quietly edited, so a reader of either entry meets the correction.

Filed **BF-197** (`Lane: A`) and amended **LA-65**, whose "change nothing" rested on `5 × 240 = 4 × 300`
— arithmetic about the *constant*. At his measured 319 s the cancellation breaks in the wrong
direction at exactly N = 5, so it never protected him.

The counter-argument is recorded rather than dismissed: `expandToBudget`'s comment says the
conservatism is the finish-early margin, and his working time has a p90 of 53.9 and a max of 81.7, so
removing 14.2 min of slack will push more sessions past the hour. The entry's answer is that a margin
arising from a double-count scales with exercise and set count rather than with his variance, so it
should be taken explicitly if it is wanted.

Nothing was run — docs-only, as above.

## Second surface, same session — the summary's `DURATION` is wall clock

Owner, on a completed Lower session showing `48:00`: *"Like this workout says 48 thats way under 60?
Is it not counting warmup?"*

**It is.** `done-screen.tsx` renders `workoutEndMs − workoutStartMs`, and `workoutStartMs` is stamped
at the start of the warm-up. Measured on that session: wall **47.9 min**, warm-up **12.5**, working
**35.4**.

The two numbers he sees are in different units and neither says so — the card's `~51 min` is working
time, the summary's `48:00` is the whole session. Compared directly they read as *"3 minutes under"*;
the real comparison is **51 planned working against 35.4 actual — 15.6 under**, on a session whose
warm-up also overran its 9-minute carve-out by 3.5.

That is BF-197 caught live and larger than the median case: it predicts 14.2 phantom minutes and this
session gave back 15.6. BF-196 now owns both strings rather than just the card's.
