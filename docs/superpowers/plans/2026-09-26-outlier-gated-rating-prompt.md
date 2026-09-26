# Outlier-gated rating prompt — asking only on the nights worth asking about

**Filed by:** Tuning · 2026-09-26 · entries **TN-81** (engine) + **TN-82** (surface)
**Answers:** `OR-171`, whose open design question was *"what counts as high or low enough to ask?"*
**Origin:** the owner has now said this twice, independently. On 2026-09-25, answering `Q-72`
(recorded in `OR-171`): *"Sleep is hard to rate. Its mostly normal. Maybe instead it auto sets it as
normal; but if score is high or low it asks was it a good or bad sleep?"* And on 2026-09-26, asked
directly: *"I can start rating - but I'd like it to auto fill if the within the normal range; and
only ask/require input when its outside the median range - as in high or low."* On reporting scores
that feel wrong he added: *"If I remember; I will let you know. But nothing off the top of my head. I
think the above structure would work for this too."*

Saying it twice unprompted is worth recording: this is a settled preference, not a passing
suggestion, and §2 below departs from it only on a point he could not have been expected to
anticipate.

## 1. Why this is worth building — three questions have already decayed to zero

Tuning has no validated outcome variable for the sleep and readiness models. TN-73 produced the only
working instrument in the project (RPE residual, sensitivity ~0.25 points) and five other validation
attempts failed for want of a label: the models can be described, but not scored. A daily subjective
rating is the cheapest label available.

The reason it does not exist is **not** that the owner won't answer. Measured 2026-09-26 against
production, morning check-ins for the last 120 days:

| Month | morning sheets | `wake_mood` | sleep rating (touched) | `vs_yesterday` | illness |
|-------|---------------:|------------:|-----------------------:|---------------:|--------:|
| 2026-07 | 28 | **17** | 0 | 0 | 0 |
| 2026-08 | 28 | 0 | **3** | 0 | 0 |
| 2026-09 | 26 | 0 | 0 | **2** | 0 |

**82 morning sheets were submitted across three months.** He is opening and saving the sheet on two
days in three. In each month exactly one field collects a handful of answers, and it is a *different*
field each month — the one that was newly added or newly moved to the top. Each then decays to zero.

`perceived_recovery` has **0 touched answers in 102 check-ins**, across the whole window.

Three distinct affordances were tried, in three positions: a one-tap emoji mood, a 1–5 scale seeded
at the midpoint, and a relative one-tap picker. `morning-checkin-sheet.tsx` carries the reasoning for
the third, written when the second had already failed:

> *First on the sheet, above the two scales. It is the question this check-in actually wants
> answered — the absolute one below it has been skipped every time for 81 days — and a question
> placed after two the owner skips inherits their fate.*

That diagnosis was right and the remedy was not: `vs_yesterday` was placed first and collected 2 of
82. **Adding a fourth question to this sheet is the intervention that has now failed three times.**

The cause is not affordance or position. It is that a question asked every single day, whose honest
answer is almost always "same as usual", has no perceptible payoff — and 82 consecutive saves have
trained a reflex of hitting **Save** without reading. Any new field inside that sheet inherits the
reflex.

This is why the owner's instinct is the first proposal that addresses the actual cause. A prompt that
appears four to six times a month, framed as *"last night reads unusual — was it?"*, is a different
proposition from a daily field, and it is the only version of this that the evidence supports.

## 2. The statistical constraint the owner's framing cannot be expected to anticipate

Taken literally — ask **only** when the score is outside the median range — the resulting data cannot
validate the score, for two reasons.

**Selection on the predictor.** Sampling on the score's own value is range restriction applied to the
variable under test. An agreement statistic computed on the tails is not the agreement over all
nights, and it is biased *upward* whenever the tails agree, which is exactly where any scoring model
is most likely to be right. The measurement would flatter the model.

**The failure mode of interest is unsampled by construction.** The calibration error that matters is
a night the model scored **normal** and the owner would have called bad — a false negative. Under a
pure outlier gate that night never produces a prompt, so the design is structurally blind to the
errors it most needs to surface.

**The fix preserves the owner's actual requirement, which is about effort, not about the tails.** Ask
on every outlier night *and* on a small random sample of ordinary nights — proposed **1 in 5**, which
adds fewer than two prompts a month. The two cases must be **presented identically**, so the owner
cannot tell from the prompt which kind of night it is; a distinguishable "routine check" invites a
different answering style and reintroduces the bias by another route.

Record **why** each prompt fired (`outlier_high` · `outlier_low` · `sampled`) so the analysis can
stratify and weight rather than infer it afterwards.

## 3. Auto-fill must never fabricate an answer

The owner asked for the normal range to "auto fill". The infrastructure to do this honestly already
exists and **must** be used: `sleep_quality_feel_touched` / `perceived_recovery_touched`
(`lib/data/postgres/schema.ts:602`, `lib/sqlite/migrations.ts:311`) exist precisely because
`sleep_quality` was defaulted to `'ok'` for 91 days and two surfaces then presented that default
back as the owner's own answer — TN-57, with regression coverage in
`lib/__tests__/tn57-untouched-scales-are-not-answers.test.ts`.

**Hard constraint: an auto-filled or unprompted day writes `touched: false`.** An auto-fill that sets
`touched: true` recreates TN-57 deliberately and destroys the outcome variable this whole plan exists
to create. The fill is a display convenience; it is never data.

`suggestedSoreMuscles` (`packages/shared/src/checkin/suggested-soreness.ts`) is the reference for the
shape — derive from the model, pre-select, let the owner override — including its habit of justifying
the auto-selection with a measurement rather than an assumption.

## 4. The gate needs a baseline, and the score it would gate on is not stored

Measured 2026-09-26: `sleep_sessions` holds **119 rows for the last 120 days** — `duration_hours` on
all 119, `average_hrv_ms` on 102 — and **`sleep_score` is non-null on 0 of them.** The sleep score is
computed on read, never persisted.

Two consequences, and the second is the one that will silently ruin the dataset:

1. The gate must compute the score *and* a rolling baseline at prompt time, from the night's stored
   inputs. Inputs are effectively complete, so this is viable.
2. **The score as shown must be snapshotted beside the rating.** If only the rating is stored and the
   score is recomputed later, any change to the scoring model rewrites the number the rating was
   given against, and every pairing silently decays into noise. A rating whose paired score is not
   pinned is not evidence. This is the single most important engine requirement in this plan.

Baseline definition — to be settled by the implementer, recommended shape: **median and IQR over a
trailing 28-night window**, with the gate firing outside `[p25 − 0.5·IQR, p75 + 0.5·IQR]`. Median and
IQR rather than mean and sd because the distribution is bounded and left-skewed, and because a single
bad night must not widen the band that decides whether the next bad night is worth asking about.
Tune the multiplier to land **4–6 prompts a month**; that rate, not the multiplier, is the target.
A 28-night window needs 28 nights, so the gate must hold its fire until the window is full rather
than firing on a thin baseline — `packages/shared/src/health/temperature-baseline.ts` is the
in-repo precedent for a rolling baseline with a minimum-coverage guard.

## 5. Scores that feel wrong — the same mechanism, one caveat

The owner confirmed the same structure for reporting a score that feels wrong. Mechanically this is
the same prompt with a different question: on an outlier day, a one-tap *does this match?* against
the displayed score. It yields labelled disagreements, which are worth more per data point than
agreements.

The caveat is the same as §2 and is **not** optional here either: disagreements collected only on
outlier days say nothing about whether mid-range scores are trusted. The sampled ordinary days carry
that, which is a second reason not to drop them.

## 6. Work split

Per the path rule in `docs/agents/README.md` §3 — storage and computation reach through `lib/` and a
migration, so they are Lane A; the sheet is Lane B. Engine half first.

**TN-81 · Lane A — the gate and the snapshot**
- Rolling median/IQR baseline over stored sleep inputs, with a minimum-coverage guard.
- The gate decision, returning `null | outlier_high | outlier_low | sampled`, deterministic per date
  so a re-render cannot re-roll the 1-in-5 sample and flip the prompt away mid-morning.
- Persist, per rating: the **score as shown**, the baseline band, and the prompt reason. New column(s)
  → migration, plus the regenerated `claude_ro` twin in the same PR, and the two TCP-`DATABASE_URL`
  tests run before pushing.
- Confirm no write path sets a `touched` flag for an unprompted day.

**TN-82 · Lane B — the prompt** · `Needs: TN-81`
- On a gated day the morning sheet asks **one** question; on an ordinary day it asks none. This is a
  replacement of the current scales, not a fourth field beside them — §1 is the argument, and a
  fourth field is the thing that has failed three times.
- Outlier and sampled prompts render identically.
- Copy shown to the owner before it ships: the framing is what makes a rare prompt answerable, and it
  is cheap to review and expensive to re-do.

**Device verification:** the morning sheet is the canonical daily surface and the local store is on
the write path, so the pass needs the APK, not `pnpm dev`.

## 7. What this does not do

- It does not change any score. Tuning proposes; a calibration change is the owner's and Lane A's.
- It does not retrofit the 82 historical check-ins. They carry `touched: false` and are correctly
  unusable as labels; nothing here should make them look otherwise.
- It does not promise the rate is right. The 4–6/month target and the 1-in-5 sample are starting
  values, to be re-measured once real prompts have fired — a gate that fires twice a week is a
  daily field wearing a gate, and will decay the same way.
