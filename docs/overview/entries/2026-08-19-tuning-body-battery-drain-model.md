# 2026-08-19 — The Body Battery drain model, fitted (Q-521 closed out, Q-527 filed)

**Agent:** Tuning 🎶 · **Branch:** `tuning/body-battery-drain-model` · **Docs-only.**

The owner resolved the contradiction between their two Body Battery answers, and added a term the
brief did not have:

> *"yes this is correct; the fitter we get, the more workout stimulus we should need for draining,
> outside of BMR draining which should naturally go up too."*

**Goal-normalised drain, plus a BMR-proportional baseline.** Both halves were checked against data
before being written into the brief.

## The BMR premise: right in principle, not yet true in fact

71 `body_comp` snapshots over 3.5 months. Monthly BMR **1,529 / 1,514 / 1,582 / 1,522**, trend
**r = +0.080** — flat. Build the model to respond to BMR, but don't let UI copy imply a
responsiveness the data hasn't shown yet.

## The linear split fails, and the failure is the useful part

The obvious allocation — baseline 40, workout 35, steps 25, each draining proportionally — simulates
over 90 real days to **mean 25.7, sd 16.4, max 58**. The typical day reads nearly empty and the tank
never approaches full. Sweeping the split doesn't rescue it: every linear allocation lands mean
26–34, sd 16–22.

**It isn't saturation** — both inputs vary well (workout completion sd **0.403**, 16 days at ceiling
and 29 at zero; steps sd **0.346**). It's that a *typical* day is ~58% of a *full* day, so any linear
scheme that puts a full day at 0 puts a typical day beside it. Three constraints — everything-hit → 0,
nothing-done → still depleted, typical → mid-range — cannot all hold under linear drain.

## The fit

```
c = 0.5 × min(1, workoutVolume / sessionVolumeGoal) + 0.5 × min(1, steps / stepGoal)
endValue = max(0, 100 − baseline − (100 − baseline) × c^2.0)
baseline = 25 × (bmrToday / bmrReference)
```

| day | end value |
|---|---|
| everything hit | **0** |
| workout only, no walking | **~30** |
| nothing done | **75** |
| typical | **~44** |

All three constraints hold. The concave exponent is what reconciles them, and it's also the right
physiological shape — the last push costs more than the first.

## The uncomfortable comparison, stated rather than buried

| | shipped | proposed |
|---|---|---|
| mean | 50.3 | ~44 |
| **sd** | **30.1** | **~22.6** |
| range | 0–100 | 0–75 |

**The proposed model has less spread.** That's not a regression: today's spread is largely ring wear
time (`corr(hr_sample_count, drained) = +0.518` vs `corr(steps, drained) = −0.153`). Twenty-two
points driven by what the owner did beats thirty driven by an artefact — *range is a filter, not a
verdict*, applied here against my own proposal. The 75 ceiling is inherent to having a baseline term;
removing it puts a sedentary day at 100, which contradicts the term the owner asked for. Recorded as
a choice, not an accident.

## Q-527 — a corrupt row that only matters once BMR is load-bearing

**2026-07-29 stores body fat 3.0%, fat-free mass 70.4 kg of 72.6 kg bodyweight, BMR 1,890** — against
~24% and ~1,520 either side. Below the essential-fat floor for a male: a bad scale reading propagated
through `cunninghamBmr`.

Inert today, because nothing keys a visible number off stored BMR. **Under Q-521 it becomes a day
that drains a quarter faster for no visible reason.** Guard the *input* (body fat band, fat-free-mass
share of bodyweight), not the output — a BMR range check catches this case and misses the next one.
Sequenced **before** Q-521, since a guard added afterwards leaves stored bad rows driving drain.

## Files

- `docs/reviews/2026-08-19-body-battery-drain-model.md` (new)
- `docs/implementation-backlog.md` — Q-521's sketch replaced with fitted parameters, pass tests and
  the linear-split warning; Q-527 filed; Q-276 cross-linked
- `docs/domains/body/README.md`
- `scripts/check-doc-index-size.js` — backlog baseline 11069 → 11143
- `docs/agents/state/tuning.md`

## Not exercised

Docs-only; no code path changed. Every figure is a **simulation replay** over stored inputs using
current goals — including the 7,000 step goal from Q-524, which is not yet what `getDailyGoals`
returns. Workout completion uses tonnage against `DEFAULT_SESSION_VOLUME_GOAL_KG`; if Q-505 changes
what a full session means, these numbers move with it. `claude_ro`, row-scoped, 90 days, one athlete;
the exponent 2.0 is fitted to one person's distribution of effort.

---

# Same PR — daily goal vs weekly target (reshapes Q-505)

**Owner question:** *"The goal being x amount of heart minutes per day to depict healthy heart usage
through the day right? But you also gotta count for weekly targets. How handle this?"*

Correct, and larger than it looks. **`DEFAULT_ZONE_MINUTES_GOAL = 22` is WHO's 150 min/week divided
by seven**, and that division does not preserve the guideline: 150 minutes taken in three sessions
satisfies WHO completely and fails the daily goal on four days in seven.

## The rule, and the one contributor that breaks it

**Match each contributor's window to its guideline's own unit.** Applied across all six, exactly one
is wrong: `zoneMinutes` (WHO is weekly, window is daily). `steps` (Paluch, per day), `moveHours`
(per day) and both strength lanes (weekly, already rolling-7d) are correct.

The precedent was already in the same file — `activity-score.ts` comments its strength block
*"rolling 7-day, so a rest day still scores off recent training."* The two contributors whose
guidelines are weekly already got the treatment the owner is asking for.

Measured, rolling 7-day ÷ 150 under Q-523's corrected threshold: contributor mean **79.2**, sd 26.7,
**zero days 0/59** (daily ÷ 22 gives 63.8 / 38.7 / 6 zero days). Weekly total mean **164.4 min**,
range 12–378, meeting WHO on 26 of 59 days. Smoother, and no day reads zero — which is honest, since
a rest day inside an active week is not a day of zero cardiovascular activity.

## The two questions were already separate contributors

The owner's phrasing splits them exactly: *"healthy heart usage through the day"* is **distribution**
and *"weekly targets"* is **dose**. `moveHours` measures the first, `zoneMinutes` the second. They got
conflated because the dose contributor was given a daily window it was never designed for — and
because the distribution contributor **does not work** (Q-522, 856 of 857 hours qualify). Dividing WHO
by seven has been standing in for a contributor that exists and is saturated.

## Recommendation: two numbers

**Today** — steps, moveHours, session-happened. **This week** — active minutes vs WHO 150, strength
frequency vs ≥2/wk, weekly tonnage. Q-505 is specified but unbuilt, so this is the moment.

## A framing I filed this morning and retired this afternoon

`strengthFreq` sitting at 100 on 78% of days was filed as *a constraint the redesign must work
around*. That was wrong. **In a weekly compliance number it is correct behaviour** — "you met the
strength guideline in 78% of trailing weeks" is true and useful. **Its ceiling was never the problem;
its scorecard was.** The earlier framing is marked superseded in Q-505 rather than left standing
beside its replacement.

## A conclusion I nearly published and the data refused

60% of the Activity Score's effective weight is already rolling-7d, which reads like "the daily score
is really a weekly number". Measured against the 23 stored scores it is not that simple: score ↔
same-day steps **r = +0.324**, ↔ sessions7d +0.186, ↔ volume7d **+0.026**. **The rolling terms carry
the weight and almost none of the variance, because they saturate** — so they set the *level* while
same-day steps move it slightly around it. That is the actual mechanism behind Q-505's anomaly, where
828 steps scored 76 and 8,935 scored 64.

## Added files

- `docs/reviews/2026-08-19-daily-vs-weekly-windows.md`
- `docs/implementation-backlog.md` — folded into Q-505; Q-523 points at it for the window half
- `docs/domains/activity/README.md`
