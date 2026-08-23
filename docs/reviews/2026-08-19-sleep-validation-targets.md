# What can the Sleep Score actually be validated against?

**Date:** 2026-08-19 · **Agent:** Tuning 🎶 · **Pillars:** `[sleep]` `[readiness]`
**Owner report that started it:** *"I usually just deem everything as 'okay' with a 3; upon waking I
don't feel instantly super rested or not rested. It's not something I feel or can describe straight
away… generally it's a mid. What other options do you have for comparisons?"*

**The answer reverses the ask I made.** I was about to ask the owner to spread their morning ratings
across the full 1–5. They should not. Measured, **the rating already carries more signal than
anything else available** — and every alternative in the app is worse. The problem was never the
owner's rating; it was using Pearson correlation on it, which Q-72 had already flagged and which I
repeated.

---

## 1. Objective next-day outcomes: only one has any signal, and two are structurally disqualified

Correlations against **raw sleep measures** rather than the composite score — deliberately, so the
2026-08-18 recalibration cannot contaminate them (the Q-511 rule: *a correlation computed across a
model change is not evidence*). n = 67 nights over 3 h.

| candidate yardstick | r vs sleep duration | verdict |
|---|---|---|
| **steps that day** | **+0.210** | weak, but the best objective signal available |
| HRV vs steps | +0.176 | (control) |
| efficiency vs steps | +0.116 | weak |
| **training volume** | **+0.028** | ❌ **structurally disqualified — see below** |
| **mean RPE** | **−0.023** | ❌ **structurally disqualified — see below** |

**Training volume cannot respond to sleep, by construction.** The program prescribes the session and
the owner performs it; adherence measured **73.6% actual against 73.1% planned** (Q-514 sweep). A
number the app itself dictates cannot be used to validate another number the app produces. **RPE is
disqualified for a different reason**: `RPE_DEAD_BAND = 1.5` means a rating has to miss by a wide
margin before anything registers, so it is deliberately insensitive.

That leaves **steps** — real, weak, and worth using as a secondary check rather than a target.

---

## 2. Of the *live* self-reports, the sleep rating is the most variable — and there are only two

**⚠️ CORRECTED 2026-08-19, after the owner said "I thought we removed this?" — they were right.**
The first version of this section compared six self-report scales as though all six were live. **Three
of them are retired**, and `components/morning-checkin-sheet.tsx` says so in its own comment:

```ts
// Retired scales — always null so a re-save clears any historical value.
motivation:        null,
restingSoreness:   null,
wakeMood:          null,
```

Last stored value per field settles it:

| field | n | sd | distinct values | last value | status |
|---|---|---|---|---|---|
| **`sleep_quality_feel`** | 46 | **~0.8** | **5** | **2026-08-19** | ✅ **live** |
| `perceived_recovery` | 46 | 0.36 | 2 | **2026-08-19** | ✅ live |
| `physical_tiredness` / `mental_drain` | 5 each | — | — | 2026-08-17 | live but barely used, and written by a surface other than the morning sheet |
| `motivation` | 35 | 0.34 | 3 | 2026-08-07 | ⛔ retired |
| `resting_soreness` | 20 | **0.00** | **1** | **2026-07-23** | ⛔ retired |
| `wake_mood` | 17 | 0.39 | 2 | 2026-07-20 | ⛔ retired |

**The conclusion survives and gets stronger.** Among the scales still being collected, the comparison
is `sleep_quality_feel` (sd ~0.8 across 5 values) against `perceived_recovery` (sd 0.36 across 2) —
a field of two, not six. The sleep rating is the most variable live self-report by a wide margin.

**What was withdrawn:** this review previously recommended rewording or dropping `resting_soreness`
on the grounds that it was "asking a question the owner isn't answering". It was already dropped, on
2026-07-23. **Its constant 3 is the fossil of a retired question, not a live data-quality problem** —
and a constant value is a plausible reason it was retired in the first place.

**The one genuine alternative** is `mood_logs.energy_level`, which is **categorical, not a 1–5 scale**:
75 entries splitting **ok 35 / good 34 / low 4 / drained 2**. That is a near 50/50 split across two
levels — far better spread than any numeric scale here, and it supports the owner's own account
exactly: they cannot put a magnitude on how rested they feel, but they evidently *do* distinguish "ok"
from "good", 69 times. **Qualitative comparative labels get answered; abstract magnitudes get a 3.**

**Observed and deliberately not filed:** the three retired columns still carry their full plumbing —
local SQLite column, `RECONCILE_COLUMNS` entry, sync-engine mapping, adapter upsert arm. Removing them
touches migrations, the local store and the sync path for no user-visible benefit, and dead columns
cost essentially nothing. Recorded here so the next reader knows it was seen rather than missed.

## 3. But the numeric rating tracks sleep better than the categorical one does

| self-report | n | vs duration | vs efficiency | vs HRV |
|---|---|---|---|---|
| **`sleep_quality_feel`** (sign-corrected so higher = better) | 46 | **+0.220** | **+0.316** | −0.145 |
| `energy_level` (drained 1 → good 4) | 62 | +0.107 | −0.114 | **−0.424** |

**Sleep feel is the better yardstick** — +0.32 against efficiency, in the right direction, from a
rating that spends 87% of its mass in two buckets. Low variance is not the same as no information.

**The `energy_level` ↔ HRV coefficient of −0.424 is a lead, not a finding, and must not be quoted as
one.** It is the largest number in this review and it points the wrong way (higher HRV, lower
self-rated energy). Pearson on a 4-level ordinal with 92% of the mass in two adjacent levels is
exactly the shape that manufactures coefficients. Before it means anything it needs a rank measure
and a check for the obvious confound (energy is logged on training days, which have distinct HRV).

---

## 4. What to do instead — and the ask that was withdrawn

**Do not ask the owner to rate differently.** Honest low-variance data beats performative spread, and
a rating consciously stretched to fill a scale stops measuring what it measured before, which would
invalidate the 46 nights already collected.

**The fix is the yardstick, not the rating** — Q-72 said this and the ask I made ignored it:

1. **Use a rank measure over the extreme nights**, not Pearson over all of them. With 6 nights at
   1/4/5 and 40 at 2/3, the question worth asking is *"do the nights the owner flagged as unusual
   score differently from the mass?"* — a two-group comparison, which 6 nights can answer, rather
   than a coefficient, which they cannot.
2. **Re-run against the recalibrated score.** Every published correlation here predates v1.319.0
   (sleep mean 84.1 → 69.5, sd 15.9 → 16.6). The old score had ~18 points of usable range; a rating
   cannot agree with a number that does not move. **This is the single highest-value re-measurement
   in the Tuning queue and it is blocked only on stored history accumulating** — the recalibration is
   not back-filled, so it needs ~3 weeks of nights scored under the new model.
3. **Add `energy_level` as a secondary target once §3's lead is resolved** — its spread is genuinely
   better, and the categorical form is the reason.
4. **Consider asking the sleep question later in the day.** The owner's account is specific: the
   information is not available at waking. This is a product change, not a calibration one, and it is
   noted rather than proposed.

**Caveats.** One athlete; n = 46–67; `claude_ro` row-scoped. Every correlation here is directional.
The sleep-feel figures are sign-corrected from the stored convention (1 = best), which is the kind of
detail that silently flips a conclusion — the raw column is **not** higher-is-better.
