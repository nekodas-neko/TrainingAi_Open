# The per-set RPE prefill is already the modal rating at every planned percentage (Q-423, refuted)

**Date:** 2026-08-20 · **Lane B** · Measured against production via `POST /api/admin/db-query`
(`claude_ro`, row-scoped to the owner).

Q-423 asked for `defaultRpeFromPct` to be re-fitted, on the finding that the owner *"raises the
default 7.3× more often than they lower it — on 233 separate occasions"*, a **+0.41** mean shift
across **625 rated sets**. It named `floor` → `round` as the tempting one-liner and — correctly —
refused to ship on that reasoning, asking instead for the mapping to be **bracketed against the 625
observed ratings**.

Bracketed. The change is not supported, and the measurement that motivated it does not hold on the
input the prefill actually reads.

---

## 1. The prefill's input is `planned_pct`, and 312 of the 625 sets do not have one

`defaultRpeFromPct(style?.[i]?.pct)` is called at four sites in `components/workout-screen.tsx`
(858, 900, 938, 1086) with the **progression style's planned percentage**. The column that mirrors
it on the stored set is `set_logs.planned_pct`. Of the owner's 625 rated sets:

| | sets |
|---|---|
| rated, `planned_pct` present | **313** |
| rated, `planned_pct` **NULL** | **312** |

`planned_pct` began being written in **July 2026** — June's 75 rated sets have none, July's 372 have
147, August's 178 have 166. Every set before that carries no record of what it was prefilled from.

**Q-423's table was computed over all 625.** Reproducing it with
`COALESCE(planned_pct, intensity_pct)` returns n=625, mean shift **+0.419**, mean-where-unchanged
**7.109** — matching the entry's **+0.41** and **7.11** to the digit. So the missing 312 were filled
from `intensity_pct`, which is the **achieved** intensity (the weight actually lifted against the
1RM), not the planned percentage the prefill was computed from. For those sets the table compares a
rating against a number the app never showed the user.

## 2. On the 313 sets that do have one, the asymmetry is a tenth of what was reported

| | Q-423 (625, mixed basis) | measured (313, `planned_pct`) | August only (166) |
|---|---|---|---|
| left at the prefilled value | 360 (57.6%) | **288 (92.0%)** | 153 (92.2%) |
| raised by hand | 233 | **25** | 13 |
| lowered by hand | 32 | **0** | 0 |
| mean shift | +0.41 | **+0.125** | +0.133 |

The direction survives — the prefill is never too high and is occasionally too low — but the
magnitude does not. Ninety-two per cent of sets are accepted as prefilled, on the full window and on
August alone.

## 3. The current mapping is the modal rating at every observed percentage — all sixteen

| `planned_pct` | n | modal RPE | `floor` | `round` |
|---|---|---|---|---|
| 52 · 52.5 · 60 · 65 | 32 | 6 | 6 | 6 |
| **66** | 24 | 6 | 6 | **7 ✗** |
| **68** | 7 | 6 | 6 | **7 ✗** |
| 70.5 | 61 | 7 | 7 | 7 |
| 72.5 | 28 | 7 | 7 | 7 |
| **75** | 14 | 7 | 7 | **8 ✗** |
| **76** | 20 | 7 | 7 | **8 ✗** |
| **77.5** | 24 | 7 | 7 | **8 ✗** |
| 80 · 82 · 83 · 83.75 · 84 | 103 | 8 | 8 | 8 |

`floor(pct/10)` matches the bucket-modal rating at **16 of 16** observed percentages, covering
**313 of 313** sets. `round` misses five of them, covering **89** sets.

## 4. Every candidate mapping scored

| mapping | exact match | raised | lowered | \|raise−lower\| | mean error |
|---|---|---|---|---|---|
| **`floor` (current)** | **288/313** | 25 | **0** | 25 | +0.125 |
| `round` | 212/313 | 19 | **82** | 63 | −0.160 |
| `ceil` | 123/313 | 14 | 176 | 162 | −0.514 |
| `floor(p/10 + 0.25)` | 264/313 | 22 | 27 | **5** | +0.026 |
| `floor(p/10 + 0.4)` | 226/313 | 19 | 68 | 49 | −0.115 |

`round` does not narrow the asymmetry — it **inverts and widens** it, turning 25 under-prefills into
82 over-prefills. Nothing in the data supports it.

## 5. Why Q-423's own acceptance criterion picks the wrong answer

Q-423 said to *"pick the mapping that minimises the raise/lower asymmetry"*. Taken literally that
selects `floor(p/10 + 0.25)`, which reaches \|raise−lower\| = 5 — but only by trading 25
under-prefills for **27 over-prefills**, and it breaks the modal match on 75/76/77.5 where the owner
rated 7 on 56 of 58 sets.

**The criterion is confounded, and by the thing being measured.** 92% of these ratings were never
touched, so they *are* the prefill — agreement with the prefill is largely the prefill agreeing with
itself. Any statistic computed over all 313 inherits that anchoring. The unanchored signal is only
in the **25 sets the owner changed**, and it is not a mapping error:

| where the raises are | n |
|---|---|
| 70.5% → rated 8, 9 or 10 | 12 |
| 72.5% → 9 | 2 |
| 66% · 68% → 7 | 5 |
| 76% · 77.5% · 80% → 8 or 9 | 3 |
| 83.75% · 84% → 9 or 10 | 3 |

Twelve of twenty-five sit at one percentage, 70.5%, where 49 of 61 sets were left at 7. No mapping
reaches 8 at 70.5% without also breaking those 49. A set taken to RPE 10 at 70.5% is a hard set, not
a mis-prefill, and a percentage-only function cannot know which one it is.

## 6. What would settle it, and does not exist

Ratings collected **without** a prefill. Every rating in this table was shown a starting value, so
none of them is an independent judgement of effort. Until such data exists — a deliberate no-default
period, which would cost the owner a friction they have not asked for — a fit against this pool can
only reproduce the current mapping's own shape.

## Conclusion

**No change.** `defaultRpeFromPct` stays `clamp(floor(pct / 10), 6, 10)`. Q-423 is removed from the
queue; Q-420's copy of the same table is annotated with the correction, since Q-420 also proposes
recovering "which sets were touched" by recomputing the prefill at read time — which works for 313
of 625 sets and silently returns nothing for the rest.
