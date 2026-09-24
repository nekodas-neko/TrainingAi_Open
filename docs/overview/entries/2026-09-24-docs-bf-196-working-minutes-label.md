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
