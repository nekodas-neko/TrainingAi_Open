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
