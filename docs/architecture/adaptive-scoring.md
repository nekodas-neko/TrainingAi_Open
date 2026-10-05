# Adaptive scoring — scores that learn the person

**2026-10-05.** Design for the owner's direction of the same day. Tracked as epic #2321. It builds on
[`ingest-and-scoring.md`](ingest-and-scoring.md) (one signal catalogue, store score **and**
coverage) and [`scoring-structure.md`](scoring-structure.md) (what the scores are today).

## What the owner asked for

> *"Something more concrete and systematic that will work over time … what if I wanted to add a new
> value to adjust sleep; something calculated from HR + body weight; or something random. I want
> our scoring system really fine tuned per person — a dynamic, growing, self-scoring system that
> adjusts with the user's data … baseline bins like hourly, daily, monthly, 2 month, 3 month … sleep
> for 2 months could be way different to 3 months later when it's winter … the point of our app will
> be that we can come up with very random niche correlations and use them to affect scoring — while
> trying to maintain accuracy. More like how does X affect you."*

Four requirements fall out of that, and the design is one part per requirement:

| Requirement | Part |
|---|---|
| Add any new value — raw, derived, or "something random" — without rebuilding | **A. Signals** |
| Know where today sits against *your* hour, week, month, season | **B. Baselines at many timescales** |
| Scoring that is tuned per person and changeable as data, not code | **C. Scores as configuration** |
| "How does X affect you", feeding back into scores without losing accuracy | **D. Learning, with guards** |

---

## A. Signals — anything measurable, declared once

A **signal** is a named stream of values for one person: `overnight_hr`, `body_weight`,
`caffeine_after_2pm`, `steps`, `room_temp`. Two kinds:

- **Raw** — arrives from a connector or a log (the ingest architecture's catalogue).
- **Derived** — a formula over other signals, **declared as data**: name, formula, unit, and which
  timescale it lives at. *"Overnight HR per kg"* is
  `{ name: 'overnight_hr_per_kg', formula: 'overnight_hr / body_weight', unit: 'bpm/kg', grain: 'night' }`.

**Adding a value means adding one declaration, not a migration or a new score.** Once it exists it
automatically gets baselines (B), can be used by a score (C), and is tested for effects (D). That
is the property that makes "something random" cheap: nothing downstream needs to know it is new.

Behaviours count as signals too — a meal logged within 3 h of bed, a late workout, alcohol, a
supplement dose, a nap. They are exactly the "X" in "how does X affect you".

## B. Baselines at many timescales

For every signal, every day, the system keeps a **summary of your distribution** over several
windows — median, the quartiles, the 10th and 90th percentiles, and the sample count:

| Window | Answers |
|---|---|
| **Hour of day** (intraday signals) | "Is this HR normal *for 3 pm*?" |
| **7 days** | This week's normal |
| **30 / 60 / 90 days** | This month's, this season's normal |
| **365 days** | Your long-run normal |
| **Same weeks last year** | Seasonal: is this winter's sleep normal *for winter*? |

A value is then described as **where it sits in each window**: *"tonight's HRV is the 80th percentile
of the last 30 days, the 45th of the last year"*. Two things follow:

- **Scoring becomes personal automatically.** A component scored on *your percentile* rather than a
  fixed number ("8 hours = 77") adapts to each person without being refitted — it fixes the known
  problem that today's sleep calibration is fitted to one sleeper's nights.
- **Drift and seasons become visible instead of corrupting the score.** When the 30-day and
  365-day pictures disagree, that is information ("you are sleeping less than your usual — and it is
  winter, when you always do"), not a baseline silently moving under the score.

**Cost:** a handful of numbers per signal per window per day — tiny next to the raw data, and it
sits with the scored values in the cloud. The seasonal window needs a year of history to mean
anything; until then it is reported as *not enough history*, never guessed.

Today's single-timescale baselines (`personal-baseline.ts`, the 14-night medians in
`sleep-score.ts`) become the 14-day window of this.

## C. Scores as configuration

A score stops being code and becomes a **versioned model per person**:

```
component = signal + window + direction + curve + weight
model     = [components] + adjustments + version
score     = coverage-aware weighted blend   (store score AND coverage — ingest D3)
```

- **The curve runs over your percentile**, not the raw value, so "good" means "good for you".
  A few anchor points — *50th percentile → 60, 80th → 85* — are the curve.
- **Everyone starts from the same default model**: today's Sleep, Readiness and Activity weights and
  curves, ported so they produce today's scores exactly. Per-person changes are *overrides* on top,
  so a new user is never worse off than the defaults.
- **Every stored score carries its model version and its coverage**, so any past number can be
  explained and re-derived.
- This is where #2319's recommendations land: one table per score, in points out of 100, with each
  component's curve beside its weight, and a "what if" that reports how many past days move.

## D. Learning — "how does X affect you", with guards

### D1. The insights engine — finding effects

It scans pairs: **a signal or behaviour X** (with a lag of the same day to 3 days) against **an
outcome Y** (tonight's sleep, tomorrow's HRV, next session's performance), and reports effects such
as *"on days you eat within 2 h of bed, your deep sleep runs 18 minutes lower (31 nights vs 44)"*.

**This is where accuracy is won or lost**, because scanning hundreds of pairs guarantees chance
findings. Every reported effect must pass all of:

- **Enough data** — a minimum number of days on each side.
- **A real size**, not just a "significant" one — small effects are not reported.
- **A false-discovery control** across everything scanned at once (Benjamini–Hochberg), so testing
  500 pairs does not report 25 coincidences.
- **It holds in both halves of the history** — an effect that exists only in the first two months
  is not an effect.
- **A plain confounder check** against the obvious ones (day of week, training load, season).

Insights are shown as **associations, not causes** — *"tends to go with"*, never *"causes"*. The
existing `correlation.ts` is the seed; this generalises it from one pair to all of them.

### D2. Learning the weights — per person, slowly

To tune weights *for a person*, the system needs to know what a score is supposed to track — its
**target**. The obvious candidates already exist: how you rate the night the next morning (the
`sleep-feel-calibration` record), your morning check-in, how the next training session actually
went against what was expected.

Given a target, weights are refitted monthly with **shrinkage toward the defaults**: with little
data they barely move; with a lot they can move further. A refit is adopted **only if it predicts
the target better on days it was not fitted to**. Otherwise the current model stays.

### D3. Promoting an insight into a score

An effect that keeps holding up can become a score component — *"meals within 2 h of bed"* joining
the sleep score. The path is fixed: **insight → proposal with the days-moved report → shadow run
(scored alongside for two weeks, compared against the target) → owner's yes → live.** Nothing
reaches a score from the engine directly.

### D4. Guards that apply to all of it

- **Shadow before live.** A new or refitted model runs alongside the live one first; it replaces it
  only if it does better against the target.
- **Past scores do not silently change.** A stored score keeps the model version that made it.
- **Small numbers are said out loud.** One person has ~70 scored nights today; the engine reports
  *"not enough history"* rather than fitting noise.
- **Acting on a score changes the data.** If you sleep earlier because the app told you to, later
  data reflects that advice. The engine treats periods after a change in advice as separate.

---

## What exists, and what each part reuses

| Today | Becomes |
|---|---|
| `SLEEP_WEIGHTS`, `READINESS_WEIGHTS`, `ACTIVITY_MODEL` | the default model (C) |
| 14-night medians, `personal-baseline.ts` | the 14-day window (B) |
| Sleep's fitted final calibration | replaced by percentile curves (C), which are personal by construction |
| `correlation.ts` | the seed of the insights engine (D1) |
| `sleep-feel-calibration.ts`, `model-report-calibration.ts` | the first target and the comparison tool (D2) |
| Admin → Day Review | the tuning table and what-if (C, #2319) |

## Build order

Each step is useful on its own, and nothing changes a score until step 3 has proved it can match
today's numbers exactly.

1. **Signals.** The catalogue and derived-signal declarations — the ingest architecture's Phase 1,
   shared, not duplicated.
2. **Multi-window baselines** for every signal, including hour-of-day and same-weeks-last-year.
   Read-only: shown, not yet scored.
3. **Scores as configuration**, ported from today's code and **proven to produce identical scores
   over the whole history** before anything is allowed to differ. Score + coverage + version stored
   (#2067).
4. **The tuning table and what-if** (#2319).
5. **The insights engine**, read-only: cards, no effect on scores.
6. **Per-person weight fitting** in shadow mode, against the chosen target.
7. **Insight → component promotion**, with the owner's yes each time.

Steps 1–3 come after the release train settles and alongside the ingest work. Steps 5 onward need
months of data per person to say anything, which is a reason to start collecting the baselines
early, not to start fitting early.

## Decisions — answered by the owner, 2026-10-05 (#2328)

### 1. What the scores learn from: only the days that are out of the ordinary

**Never a forced rating.** Every day is scored from your own baseline by default, and that default
stands unless something looks unusual. **When a score falls outside your normal range, the app asks**
— *"your sleep scored 54, well below your usual; how did it feel?"* — and only then. Your answer is
what the learning uses: it either confirms the score or tells the system it was wrong, and in which
direction. A day you are not asked about, or do not answer, teaches nothing.

This is the **outlier-gated rating prompt the sleep score already has** (`sleep-verdict.ts`: a
trailing 28-day median ± IQR band, a prompt only outside it). Readiness has no equivalent yet —
#2105 builds it, and it is now a prerequisite for weight fitting (step 6).

*What it means for the learning:* answers arrive mostly on unusual days, so they teach the system
most about the edges of the range — exactly where a wrong score is most noticeable — and little about
ordinary days, which is acceptable because ordinary days are the ones the baseline already handles.

### 2. Past scores may be re-scored

The app is in trial mode, so **an improved model may re-score history.** Every score still records
the model version that produced it, so a re-score is traceable and could be reversed.

### 3. Refits may go live on their own

**Weight refits go live automatically** once they pass the shadow test. A new component still comes
to the owner first (D3).

## Components are a multiplier and a value — the owner's model

Owner, 2026-10-05: *"every component has a multiplier value and a contributing score value … rather
than change its value, we can just change the multiplier — 'that wasn't as useful as we thought,
drop it to 2.1' … easy to keep track of changes."*

So every component, in every score, is stated as exactly two things:

| | What it is | How it changes |
|---|---|---|
| **Multiplier** | how much this component counts (today's "weight") | the tuning knob — by the owner, or by a refit |
| **Value** | 0–100, how good this component was *today* | never by hand — computed from the data (below) |

**score = Σ (multiplier × value) ÷ Σ multiplier.** Same arithmetic as today; the change is that the
multiplier is the one thing anyone tunes, and **every change to a multiplier is logged** — date, old,
new, who or what changed it, and why — so the history of tuning is a list you can read.

### How a 0–100 value is made — the hard part

A value needs three reference points, and today's curves have only some of them:

1. **The possible range** — the lowest and highest the measurement can plausibly be (sleep 0–12 h).
2. **What is normal for you** — your percentile in the baseline windows (§B).
3. **What is actually good** — research-backed reference ranges (adults: 7–9 h of sleep; resting
   HR and HRV norms by age and sex), so "normal for you" cannot drift into "fine" when it is not.

The value blends the second and third: research decides where *good* sits, your own data decides
where *you* sit relative to it. Building this properly for every component is research, not coding —
one reference sheet per component, citing its sources — and is tracked as #2331, before step 3. **Done 2026-10-05:** [`component-references.md`](component-references.md) gives, for every component, its range, the research reference with sources, and whether "good" can only be personal.
