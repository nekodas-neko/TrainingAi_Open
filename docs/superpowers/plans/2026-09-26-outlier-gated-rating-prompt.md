# Announce and correct — the app fills the category and says so; the owner only ever corrects it

**Filed by:** Tuning · 2026-09-26 · entries **TN-81** (engine) + **TN-82** (surface)
**Answers:** `OR-171`, whose open design question was *"what counts as high or low enough to ask?"* —
the answer turned out to be that it should not **ask** at all.

**Origin, three statements from the owner.** On 2026-09-25, answering `Q-72` (recorded in `OR-171`):
*"Sleep is hard to rate. Its mostly normal. Maybe instead it auto sets it as normal; but if score is
high or low it asks was it a good or bad sleep?"* On 2026-09-26: *"I'd like it to auto fill if the
within the normal range; and only ask/require input when its outside the median range."* Then, asked
to confirm, he refined it into the design this plan now follows:

> *"auto fill to normal when readings dont say anything strange i.e wake up mood/energy/sleep etc.
> But if our results say something diferent (i.e sleep was later; or short or etc etc) then it can
> say; your values was bad; this has autofilled this category"*

That last version is materially different from the two before it, and better. **The app never asks a
question.** It fills the category itself and *announces* what it filled and why. The owner's only
interaction is to **correct it when it is wrong**.

## 1. Why this is worth building — three questions have already decayed to zero

Tuning has no validated outcome variable for the sleep and readiness models. `TN-73` produced the only
working instrument in the project (RPE residual, sensitivity ~0.25 points) and five other validation
attempts failed for want of a label: the models can be described, but not scored.

The reason a rating does not exist is **not** that the owner won't answer. Measured 2026-09-26 against
production, morning check-ins for the last 120 days:

| Month | morning sheets | `wake_mood` | sleep rating (touched) | `vs_yesterday` | illness |
|-------|---------------:|------------:|-----------------------:|---------------:|--------:|
| 2026-07 | 28 | **17** | 0 | 0 | 0 |
| 2026-08 | 28 | 0 | **3** | 0 | 0 |
| 2026-09 | 26 | 0 | 0 | **2** | 0 |

**82 morning sheets were submitted across three months.** He opens and saves the sheet on two days in
three. In each month exactly one field collects a handful of answers, and it is a *different* field
each month — the one newly added or newly moved to the top. Each then decays to zero.
`perceived_recovery` has **0 touched answers in 102 check-ins**.

Three distinct affordances were tried, in three positions: a one-tap emoji mood, a 1–5 scale seeded at
the midpoint, and a relative one-tap picker. `morning-checkin-sheet.tsx` carries the reasoning for the
third, written when the second had already failed:

> *First on the sheet, above the two scales. It is the question this check-in actually wants
> answered — the absolute one below it has been skipped every time for 81 days — and a question placed
> after two the owner skips inherits their fate.*

That diagnosis was right and the remedy was not: `vs_yesterday` was placed first and collected 2 of 82.
**Asking is the intervention that has now failed three times**, across every affordance and position
available on that sheet. This is the evidence that makes the owner's "don't ask me, tell me" the right
shape rather than merely the convenient one.

## 2. The design

**Every day, the app fills the category itself and states what it filled.** There is no question and
no required input, ever.

- **Ordinary day** — filled as normal, stated **quietly**: one line, no interaction demanded.
- **Outlier day** — filled as poor (or good), stated **prominently**, *with the reason*: "sleep was
  short and started late — marked this poor." The reason is what makes it correctable; a verdict with
  no stated cause cannot be argued with.

**The owner's only interaction is correction.** On a day the app has it wrong, he taps once to fix it.
On a day it has it right, he does nothing — which is exactly the auto-fill he asked for.

This is a better instrument than the rating it replaces, for a reason worth stating plainly: a
correction is a **disagreement**, and a disagreement is the highest-information data point available.
Thirty-five neutral 3s told us nothing. Three corrections in a month would tell us where the model is
wrong and in which direction.

**It also dissolves the sampling objection that the previous draft of this plan had to work around.**
Under an ask-only-on-outliers design, the error that matters most — a night scored **normal** that he
would have called bad — produces no prompt and is invisible by construction, which is why that draft
proposed randomly sampling one ordinary night in five. Announcing on **every** day removes the
problem instead of mitigating it: an ordinary day is announced too, so a wrong "normal" is just as
correctable as a wrong "poor". No random sampling, no extra prompts, and the middle of the
distribution is covered.

## 3. The one new risk, and the guard it needs

**Silence is ambiguous.** Under correction-only feedback, a day with no correction could mean the app
was right, or that he did not look. That distinction cannot be recovered afterwards, and it matters
because **zero corrections reads exactly like success.** It is the same shape as the 35-of-36 neutral
3s that started this: data that looks like agreement and is actually absence.

Two guards, and the second is non-negotiable:

1. **Record three states, not two** — `announced, no response` · `announced, acknowledged` ·
   `announced, corrected`. Where the surface can distinguish an acknowledgement from silence (the
   outlier announcement is prominent enough to be dismissed deliberately), that dismissal is weak
   evidence of agreement and is worth storing. A quiet ordinary-day line cannot carry that, and its
   silence must stay recorded as unknown rather than promoted to agreement.
2. **A month with near-zero corrections means the instrument has FAILED, not that the model is
   validated.** Write that down now, because in six months the temptation will run the other way. If
   corrections are ~0 after a month of announcements, the honest conclusion is that he is not reading
   them — which is the decay pattern from §1 arriving in a new costume — and the answer is to change
   the surface, not to publish a validation.

**Never infer a label from an announcement the owner did not respond to.** An auto-filled,
un-corrected day is not his opinion, and anything that later treats it as one recreates `TN-57`
(below) with extra steps.

## 4. Auto-fill must never fabricate an answer

The infrastructure to do this honestly already exists and **must** be used:
`sleep_quality_feel_touched` / `perceived_recovery_touched` (`lib/data/postgres/schema.ts:602`,
`lib/sqlite/migrations.ts:311`) exist precisely because `sleep_quality` was defaulted to `'ok'` for 91
days and two surfaces then presented that default back as the owner's own answer — `TN-57`, with
regression coverage in `lib/__tests__/tn57-untouched-scales-are-not-answers.test.ts`.

**Hard constraint: the auto-filled value writes `touched: false`. Only a correction writes
`touched: true`.** That single rule is what keeps the dataset honest under this design — it is the
difference between "the app's guess" and "his answer", and every analysis downstream depends on it.
An auto-fill that sets `touched: true` destroys the variable this plan exists to create.

`suggestedSoreMuscles` (`packages/shared/src/checkin/suggested-soreness.ts`) is the reference for the
shape — derive from the model, pre-select, let the owner override — including its habit of justifying
the auto-selection with a measurement rather than an assumption.

## 5. What counts as "strange" — and the score is stored nowhere

The owner named the inputs: *"sleep was later; or short or etc etc"*, across *"wake up
mood/energy/sleep"*. So the gate reads the night's **components**, not only a composite — a night of
normal duration that started two hours late is strange, and a composite can average that away.

Measured 2026-09-26: `sleep_sessions` holds **119 rows for the last 120 days** — `duration_hours` on
all 119, `average_hrv_ms` on 102 — and **`sleep_score` is non-null on 0 of them.** The score is
computed on read, never persisted. Two consequences:

1. The gate must compute the verdict at announcement time from stored inputs. Inputs are effectively
   complete, so this is viable.
2. **The verdict and the values behind it must be snapshotted.** If only the outcome is stored and the
   inputs are recomputed later, a scoring change rewrites what each correction was disagreeing with,
   and the corrections decay into noise with no signal that it happened. **A correction whose paired
   verdict is not pinned is not evidence.** This is the most important engine requirement here.

Threshold shape — recommended, for the implementer to settle: **median and IQR over a trailing 28
nights per component** (duration, onset time, efficiency), outside `[p25 − 0.5·IQR, p75 + 0.5·IQR]`
flagging that component. Median and IQR rather than mean and sd because the distributions are bounded
and skewed, and because one bad night must not widen the band that judges the next one. Tune toward
**4–6 prominent announcements a month**; the rate is the target, the multiplier is only how it is
reached. A 28-night window needs 28 nights — hold fire until it is full rather than announcing off a
thin baseline (`packages/shared/src/health/temperature-baseline.ts` is the in-repo precedent for a
rolling baseline with a minimum-coverage guard).

## 6. Scores that feel wrong — the same mechanism, now genuinely the same

The owner confirmed this structure covers reporting a score that feels wrong (*"I think the above
structure would work for this too"*). Under announce-and-correct they are **the same feature**: the
app states its verdict, and a correction *is* the report that the score felt wrong. Nothing separate
needs building, and he never has to remember to report anything — which was the original problem
(*"If I remember; I will let you know"*).

## 7. Work split

Per the path rule in `docs/agents/README.md` §3 — storage and computation reach through `lib/` and a
migration, so they are Lane A; the surface is Lane B. Engine half first.

**TN-81 · Lane A — the verdict, the snapshot, the three states**
- Per-component rolling median/IQR baselines with a minimum-coverage guard; a verdict of
  `normal | poor | good` plus **which components triggered it**, since the reason is what gets
  announced.
- Persist per day: the verdict, the component values behind it, the baseline bands, and the response
  state (`none | acknowledged | corrected`).
- Auto-fill writes `touched: false`; a correction writes `touched: true` and the owner's value.
- New column(s) → migration, plus the regenerated `claude_ro` twin in the same PR, and the two
  TCP-`DATABASE_URL` tests run before pushing.

**TN-82 · Lane B — announce quietly, announce loudly, correct in one tap** · `Needs: TN-81`
- Ordinary day: one quiet line stating it was filled as normal. No interaction demanded.
- Outlier day: prominent, **states the reason** ("slept 5h10, 90 min later than usual"), one tap to
  correct, dismissal recorded as acknowledgement.
- This **replaces** the two scales on that sheet rather than joining them — §1 is the argument.
- Copy shown to the owner before it ships: the whole design rests on an announcement he will actually
  read, and §3's failure mode is him not reading it.

**Device verification:** the morning sheet is the canonical daily surface and the local store is on
the write path, so the pass needs the APK, not `pnpm dev`.

## 8. What this does not do

- It does not change any score. Tuning proposes; a calibration change is the owner's and Lane A's.
- It does not retrofit the 82 historical check-ins. They carry `touched: false` and are correctly
  unusable as labels; nothing here should make them look otherwise.
- It does not promise the rate is right. 4–6 prominent announcements a month is a starting value, to
  be re-measured once real ones have fired — announce loudly twice a week and it becomes wallpaper,
  which is §3's failure mode arriving on schedule.
