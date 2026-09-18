# Session journal — batch folded 2026-09-18

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-09-15-or116-resting-vs-intraday-hr"></a>

# 2026-09-15 — OR-116: one metric name over two metrics

**Branch:** `fix/or116-resting-vs-intraday-hr` · **Lane B**

The owner, comparing two screens: *"I dont see any other values that match that home screen HR value
— current = 73, min = 50, average = 89, max = 125, and the HR card says 60."*

**Every one of those numbers was right.** Home's 60 is last night's **resting** rate
(`body_metrics.resting_heart_rate`); the 73/50/89/125 are today's **intraday** series. Both screens
called their figure "Heart Rate", and nothing said they were different things — so a user comparing
them can only conclude that one is broken.

This is the failure mode where there is no bug to find. Checking the arithmetic confirms both sides
and explains nothing, which is roughly what the entry's author did before filing it.

## What shipped

Home's chip reads **"Resting HR"**; the detail screen's four stats are captioned **"Today so far"**.

**The Home label follows the source, and that conditional is the part worth keeping.** The value is
`restingHrLastNight ?? restingHr ?? hrCurrent`, and the third fallback **is a different metric** —
`hrCurrent` is a live BLE sample, a desk reading rather than a night. Labelling it unconditionally
"Resting HR" would have moved the false claim instead of removing it, which is the same mistake the
entry was filed about, one layer down.

The wording is Health's existing one: `rhr-hrv-spo2-card.tsx` already renders "Resting HR" at the same
9px uppercase treatment. Three names for one signal was the problem; a fourth would not help.

## Measured, not eyeballed

"Rest HR" is the longest short label in a four-cell row, so the spec measures with
`getBoundingClientRect()` that no child exceeds its cell and the document does not scroll sideways at
phone width. A label that wrapped or clipped would be a new defect traded for the old one — and at
8.5px with 0.16em tracking that is exactly the kind of thing a green functional assertion misses.

Both tests fail against `main`.

## Found while reading, deliberately not fixed

`app/health/heart-rate/page.tsx` passes `restingHr={data?.hrMin ?? null}` into `HrFactorsCard` —
today's intraday **minimum** standing in for the resting rate. On the owner's own figures those are 50
and 60, so they are not the same number. That is a **fourth** presentation of this signal and
possibly a real defect rather than a naming one.

Not touched here: it changes what a card computes from rather than what it is called, and whether
`hrMin` is a deliberate proxy or an oversight has to be established before it is "fixed". Recorded on
the entry as a `Keep:`.

## What labelling did not solve

The entry was filed on a three-surface problem: Health's tile shows the value bare, Home's shows it
with a delta against baseline, the detail screen shows neither. **Three surfaces, one number, three
amounts of context.** Naming each surface stopped the numbers reading as broken; it did not decide
what each surface is *for*. That stays open, and it is a design question rather than a defect.

## Not exercised

**No device pass**, and the label change is exactly the kind that wants one — the short label only
renders in the band ring style, and the owner's chosen style decides whether "Rest HR" is ever on
screen at all.

<a id="2026-09-15-pillar-reachability-and-composites"></a>

# 2026-09-15 — the owner cannot score 100, and the reason is not the design

**Tuning.** Docs-only. The owner asked for the base data a usable pillar system needs, for composite
metrics built from computed values, and for a scoring answer with one hard requirement attached:
*"as long as with my current metrics I have a way to get 100 on pillars I am happy."*

## The requirement is not met, and readiness is the reason

| pillar | best ever | mean | days | days ≥ 90 |
|---|---:|---:|---:|---:|
| Sleep | 97 | 73 | 63 | 19 |
| Activity | 91 | 73 | 50 | 1 |
| **Readiness** | **87** | 64 | 62 | **0** |

**`temperature` has never reached 100 in 62 days** — max 96, mean 76. It is scored *closer-better*,
with 100 sitting exactly at the personal baseline, so a miscentred baseline puts 100 out of reach
**by construction rather than by difficulty**. That is TN-6 and BF-13, both already queued: no new
work, just priority. `recoveryIndex` averaging 43 against a max of 100 is the second drag and is
explained by nothing queued.

`checkin` looked like a third and is not: the map runs `pumped → 100` and the owner has never logged
`pumped`. Honest self-report, filed as explicitly not a defect so nobody "fixes" it.

**Sleep needs no change.** The calibration maps a blend of 93 to a displayed 100 against a
theoretical max of 99.2, so the ceiling is steep rather than closed. `LATENCY` peaking at 90 and
`TIMING` at 95 are fine for the same reason — the calibration compensates, which is worth recording
because both look like bugs in isolation.

## The rule this produces

**Every contributor must be able to reach 100 on a genuinely excellent input, or the pillar's ceiling
is silently below 100** — and it breaks two ways: a curve whose maximum is below 100 (harmless if the
calibration compensates, so check that first), or a closer-better contributor whose baseline is
miscentred, which no calibration can rescue.

## Health Connect: the ring-only list is smaller than the docs say

The connector guide classifies skin temperature as having no second source. **Health Connect defines
`SkinTemperatureRecord`**, and `HeartRateVariabilityRmssdRecord` for HRV. It can carry every input
our pillars need except beat-to-beat intervals. We read 11 types and ten more exist that the pillars
would use, skin temperature being the largest gap.

Two defects found in `health-connect-sync.ts` while reading it, both landing on the Health-Connect
user specifically: the overnight HRV and SpO₂ windows filter on `d.getHours()` against the **device**
timezone, and a comment documents `hrvMs` as SDNN where the code reads rMSSD.

## Composites

Four, none already implemented. **Load vs readiness** (ACWR × readiness) is the one worth building
first — it is the question the deload engine is actually asking, and it works with no wearable at
all. **Sleep debt** needs duration alone. Autonomic balance and true sleep time need an HR source and
efficiency respectively.

## Not exercised

Docs-only; no code changed, nothing run on device. Score ceilings are computed from the live curves
and calibration in `sleep-score.ts`, and the achieved figures are the owner's own account through
`claude_ro`, row-scoped to one user — the "never reached 90" finding is about this account over 62
days and is not a claim about the pillar for anyone else. The Health Connect type list was read from
the vendor's current public documentation, not from the pinned plugin source, so **which of those
records the pinned `@devmaxime/capacitor-health-connect` build can actually request is unverified**
and must be checked against that source before TN-44 is built.

<a id="2026-09-15-rv38-body-battery-no-data-badge"></a>

# 2026-09-15 — RV-38: the guard that got weaker as the data got worse

**Branch:** `fix/rv38-body-battery-no-data-badge` · **Lane B**

Body Battery printed **Good / Steady / 50** for an account that has never worn anything.

## The route was honest; the card was not

`GET /api/body-battery` for the zero-data account says it has nothing **four separate ways**:

```json
{"current":50,"label":"Good","trend":"steady","hasData":false,
 "confidence":{"sampleCount":0,"samplesPerHour":0,"sufficient":false},
 "anchor":50,"anchorSource":"default"}
```

The card rendered a colour-coded label, a bar filled to 50%, and no qualification of any kind.

## Why it survived: the guard inverted at the worst case

```ts
const lowData = battery.hasData && conf != null && !conf.sufficient
```

- enough samples → no badge ✓
- too few samples → "Limited data" ✓
- **none at all → no badge** ✗

The qualification got *weaker* as the data got worse. Read once, the `hasData` term looks like
defensive care; what it actually does is exempt the one case where the warning is most true. Dropping
it is the entire fix — `sufficient` is already false in both cases that deserve the badge, which is
what makes it the right condition on its own.

## Two things checked rather than assumed

**The expanded copy needed no guard.** The *"your ring recorded only N heart-rate readings"*
paragraph sits inside the `battery.hasData ?` branch, so a zero-data account never reaches it. Had it
been outside, this fix would have told someone their ring recorded "only 0" readings.

**The stale comment was real.** Lines 134–139 claimed the explainer *"only renders in the NO-DATA
state, which means on any ordinary day nobody ever reads it"* — two lines below the Q-276 note saying
it is always visible, and directly above unconditional JSX. Deleted.

## What is deliberately not fixed

**The number.** The owner handed it to Tuning on 2026-09-14 — *"This requires tuning still"* — and a
Body Battery re-fit silently re-scores months of history, so it goes through a proposal that states
how many other days it moves. Nothing here touches it.

**Whether no-data deserves an `—` rather than a badge.** That is the owner's call, and
`/health/heart-rate` shows the stronger posture already exists in the app. Not asked and not
blocked on: the badge is strictly better than what shipped before and reverses in one line, so
shipping it does not foreclose the decision.

## Verification

The e2e runs as the zero-data account and **captures the response beside the rendered text**, which
the entry asked for specifically — a rendered 50 on its own cannot distinguish a bug from a fixture.
Against `main`'s unfixed card the badge is simply absent and the test fails on it.

## Not exercised

**No device pass.** Kept as RV-38's `Keep:` ③.

<a id="2026-09-15-sleep-score-rewards-removing-a-sensor"></a>

# 2026-09-15 — the sleep score pays you to take the ring off

**Tuning.** Docs-only. The owner pushed back on the core/adjustment design with a specific worry:
a user logging only bed and wake times could reach 100, and once staging arrives that alone should
no longer be enough. Checking the worry against the live weights found a worse defect than the one
the design was proposed to fix.

## The measurement

One night — 8 hours, consistent window, poor deep and REM, HRV below the personal baseline — run
through `sleep-score.ts`'s real renormalising formula:

| scored with | contributors | score |
|---|---|---:|
| ring | 10 of 10 | **74** |
| basic watch | 6 of 10 | 84 |
| phone or manual only | 3 of 10 | **92** |

Renormalising over whichever contributors are present means removing the ones dragging the score
down *raises* it. **The app pays 18 points for taking a sensor off.**

## Why that reframes the entry

TN-38 task C was filed on comparability — two users' 78s are computed from different weight sets.
That is true, abstract, and easy to defer. The same defect seen from the owner's angle is
**more information can only ever hurt you**, which is not deferrable and is the argument that
actually lands.

## The shape the objection forces

The core must **not** reach 100. Core tops out near 92 — *"as good as it looks from here"* —
adjustments run roughly −20 to +8 weighted toward deduction, and the night above lands on 74 either
way. A ring user's number is unchanged; taking the ring off now leaves 92 with lower confidence
rather than a free 18 points. 100 comes to mean *confirmed good by everything visible*.

Recorded with the alternative it rules out: capping the core far below 100 so that sensors only ever
add. That pins a phone-only user at 55, which reads as "you sleep badly" when the truth is "we
cannot see" — punishing someone for hardware they do not own is worse than an optimistic estimate
carried with a stated confidence.

**What stays the owner's is the input list per pillar, not this shape.**

## Not exercised

Docs-only; no code changed and nothing run on device. The three scores are one night's sub-scores
put through the real formula — a worked example chosen to expose the direction, not a measurement of
an actual logged night. The 18-point gap is a property of renormalisation and holds for any night
where the deeper contributors score below the shallow ones; it would invert on a night where they
score above.

<a id="2026-09-15-tn13-closed-bare-number"></a>

# 2026-09-15 — TN-13 closed on a decision, not a fix: the bare number stays

**Branch:** `docs/tn13-bare-number-owner-decision` · **Lane B** · docs-only

TN-13 shipped a resting-HR delta on Home's chip — `50 · −7 vs usual` instead of a bare bpm — on
2026-08-30. **It has never been on screen.**

## The defect, recorded because it will not be fixed

`RING_GEOMETRY` gives `showDot: true` to exactly **one** of eighteen ring styles (`accentring`), and
`oura-score-chip-row.tsx` renders the cue only under `geo.showDot`. So the delta was invisible on
seventeen styles including the default. The owner, once sent to the right screen: *"on the homescreen
HR chip it just says a number."*

A later ring-style pass had dropped the cue deliberately for the score cards — their colour moved to
the icon — and took the HR delta with it. That is a different thing, and the distinction is the whole
argument for the feature: a Readiness score of 72 interprets itself, a resting HR of 60 does not.

**It failed on the one day it had something to say.** Production, 2026-09-15: `resting_heart_rate`
**60** against **57 · 55 · 54 · 55** on the four preceding nights — the cue would have read about
`+4 vs usual`, an elevated morning, which is exactly the signal the entry was filed to surface.

## The owner chose the bare number

Asked directly, with the four options and the cost of each shown as they would appear in the row, the
answer was: leave it. The reasoning was already on the entry before the question was put — *"which is
fine as it makes it consistent with the rest."*

**This is a decision, not a dodge, and the shape of the choice is why.** Restoring the cue on the HR
chip alone makes it the only cell in the row with a second line. Restoring it on all four puts a cue
under three numbers that already interpret themselves — which is precisely what the ring-style pass
removed on purpose. Neither is obviously right; the owner reads that row every morning and pays the
cost of a wrong answer daily. That is the definition of a call that is theirs.

## What survives

The engine half is untouched and correct: `packages/shared/src/health/resting-hr-cue.ts` still
computes the delta, and it still reaches the chip's **accessible name**, so a screen-reader user hears
the comparison that a sighted user does not see. If the decision is ever revisited, the data is there
and the render condition is a one-line change.

The entry's open legibility question — whether a cue grown from one word to five reads at the tile's
type size — is **struck as moot**. It cannot be answered about something that will not be drawn.

## Not this

TN-13 and **OR-116** came from the same owner report and are different defects. OR-116 — Home's 60
matching nothing on the Heart Rate screen — shipped the same day in v1.456.18. Closing TN-13 does not
close OR-116's remaining questions, including `hrMin` standing in for a resting rate in
`HrFactorsCard`.

The HRV-instead-of-HR question also stays answered (2026-08-31): resting HR correlates **−0.491**
with the owner's check-in against HRV's **−0.331**, the two share 56 % of their variance, and HRV is
the noisier vital. Neither question should be re-opened.

<a id="2026-09-15-tuning-core-input-line"></a>

# 2026-09-15 — four owner decisions, and a measurement that reversed my own fix order

**Tuning.** Docs-only. The owner asked to be asked every question blocking Tuning's queue; four came
back answered, and checking one of them against real days overturned the recommendation I had made.

## TN-36 — the fix order was backwards

I filed the deload finding with *"give readiness a way to clear a day"* as step 1 and called it the
cause. Simulating each fix against the owner's last 22 days says otherwise:

| | Sept days recommending a deload |
|---|---|
| today | **11 of 15** |
| stress override unwired | **1 of 15** |
| plus the readiness-clears rule | **1 of 15** |

The owner's streak reaches three exactly once in 22 days, so `consecutiveTrainingDays < 3` was
already clearing nearly every day and the stress override was doing essentially all of the
over-recommending. The structural defect is real — readiness 100 still returns `recommended: true` —
but it is not what the owner is feeling and it moves nothing on current data.

**Order reversed, gate lifted, and both halves stay separate** so the re-measure has one variable.
The remaining recommendation on 09-15 is the engine working: three training days behind it and
readiness 40.

**What produced the correction was simulating rather than reasoning.** The original ordering came
from reading the code, where the readiness ladder is plainly the structural defect. It is, and it is
also inert here. A code read cannot tell you which defect a user is feeling.

## TN-38 task C — the inventory the decision needed

The owner declined the proposed core/adjustment line and asked to see every metric first, which was
the right call: the line reads as one decision and is really three, with very different stakes.

| | sleep | readiness | activity |
|---|---:|---:|---:|
| phone only | 35% | 35% | 63% |
| phone + basic wearable | 55% | 66% | 100% |
| plus sleep stages | 87% | 66% | 100% |

Activity reaches full core on any wearable because its heaviest terms are logged workouts and steps.
Sleep is the whole question — 48 of its 110 points sit in HRV, stages and restfulness. Written up
with the tiered metric inventory and the argument against putting stages in the core (stage
estimates differ wildly between devices, which reintroduces exactly the incomparability the core
exists to remove) in
[`docs/reviews/2026-09-15-every-metric-and-the-core-line.md`](../reviews/2026-09-15-every-metric-and-the-core-line.md).

## Decided outright

- **TN-31** — the 3-on/3-off interval walk maps to `tempo`; a sixth run type waits until the
  protocol is run often enough to tune its band.
- **TN-38 task B** — build PS-41 now and validate when a friend onboards. There is no
  Health-Connect-only account and there will not be one.

## Not exercised

Docs-only; no code changed and nothing was run on the device. The 22-day simulation reconstructs
`computeDeloadStrength`'s branches from stored readiness, `stress_high_minutes` and completed
sessions — it is not the engine executing, and `energyLevel`/`selfReportedSick` were not
reconstructed, so both can only escalate. Every figure is the owner's own account via `claude_ro`,
which is row-scoped to one user.

<a id="2026-09-15-unused-signal-audit"></a>

# 2026-09-15 — what else our data could tell us, and one retraction

**Tuning.** Docs-only. The owner asked what other metrics could be calculated from data already
held. The audit looked for stored-and-unused signal rather than proposing new measurements, and the
best finding was not a new metric at all — it was that an existing one has never been checked.

## The headline

**Daytime stress is imputed and the ground truth is in the database.** The ring streams HRV events
for ~7% of waking hours, so the model fits a regression on night data and applies it to daytime HR
and temperature. That imputation drives `stress_high_minutes`, which drives the deload override
that fired on 10 of the last 22 days.

The chest strap writes raw beat intervals — 136,440 over 48 days — and is worn **07:00–13:00,
peaking at 08:00**. That is the window the model is guessing about, and twelve of the last fourteen
strap days carry thousands of beats on days the model also ran. `rmssdFromRr` already exists and
already runs on this data for workout windows. Comparing the two is a measurement, not a project.

Filed as **TN-39**, with the constraint that the output is a number and a verdict, not a patch —
scoring changes stay owner-signed.

## The same beats feed three models they never reach

`rollup/run.ts` runs LF/HF, breathing rate and the 5-minute HRV series **on ring IBI only**. The
strap's reader is called from two places, and the strap's 136,440 beats yield exactly one number: a
workout's rest-window rMSSD. Because the strap is worn in waking hours, pointing those models at it
would produce daytime LF/HF, breathing rate and HRV series — signal the app has from no source
today. Filed as **TN-40**, gated behind TN-39 because the agreement result decides whether these
merge with the ring series or stay separate.

## Retraction

Earlier the same day I told the owner nightly HRV could come from the strap today with a pipeline
change only. **The pipeline change is real; the nightly data is not there** — 242 beats across 6
nights, total. PS-44's architectural claim survives, its validation path does not, and the entry now
says so with the hour-grouped measurement attached. A row count of 136,440 looks like plenty until
it is grouped by hour, which is exactly how the mistake was made.

## Two hypotheses tested and killed

- **`ehr_*` is not automatic workout detection.** Event counts run highest on days with no workout
  (802 events / 0 workouts on 09-15; 764 / 0 on 09-11).
- **There are no computed-but-unsurfaced metrics.** Four modules looked dead on a narrow grep and
  all four are consumed once the search widens. Recorded because the same grep will mislead again.

**TN-41** covers the four raw tags stored without a rollup consumer, ranked below the other two and
honest that the value is modest. `0x73` (1,494 episodes) has no decoder and is owner-gated: its byte
layout must come from the `open_oura` Rust source, which now lives only in the archived private repo.

## Not exercised

Docs-only; no code changed, nothing run on device. Every figure is the owner's own account read
through `claude_ro`, which is row-scoped to one user — the wear-pattern and event-count findings are
about this owner's usage and do not generalise to other accounts. No decoder was written and no byte
layout was inferred.

<a id="2026-09-16-bf-171-session-fit-name-matching"></a>

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

## Follow-up: *"is this correct or should it have been lower?"*

Two further hypotheses measured, both cleared, both written into BF-171 so they are not re-opened:

1. **Freshness and balance are session-name-keyed while recovery is muscle-keyed.** True —
   **44.4%** of Upper's weighted muscle work was trained in the previous 24 h and it still scores
   freshness 100 — but it changes nothing, because Upper's muscle-weighted age is **49.7 h**, past
   `sessionFreshnessScore`'s 48 h cap. A muscle-derived freshness saturates at 100 too and Upper
   lands at 83.5. Push is the only session it moves, and it moves further from selection.
2. **The overlap is invisible to the score.** It is not; it is already Upper's recovery 70 against
   Pull's 91.

**So 84 is correct as a fit score, and the app's verdict was never "you are fresh"** — it said
strong deload advised, offered Rest, and showed readiness 37. What remains true is that Upper 84 and
Pull 82 is a near-tie decided by under a point, with the better-recovered session losing only on
being less overdue. That is a design call for the owner rather than a defect, and it is noted in
BF-171 without a separate entry.

## Second follow-up — the owner was right, and BF-173 is the reason

*"I trained push/upper body yesterday and legs the day before. Surely it would see that I trained
the muscles it wants to use today - yesterday. Legs would be more recovered?"*

The model agrees with him and the score discards the agreement. `computeMuscleRecovery` has his
quads at **69**, hamstrings **63**, glutes **73** against chest **49**, shoulders **45**, triceps
**59**. But `suggestedSoreMuscles` auto-ticks anything trained within 48 h and under 85% recovered —
reading *that same output* — and `sessionRecoveryScore` then clamps every ticked main muscle to
`min(pct, 40)`. Quads scored 69 by the model are scored 40 by the picker. One fact, counted twice,
the second time harder.

Because the clamp is a flat floor it also flattens the ordering: quads at 69 and chest at 49 both
land on exactly 40, so the very comparison he is making is deleted before it reaches the score.

**It changes the answer.** Same day, leg ticks removed: **Lower 85 wins**, Upper 84, Pull 82, Legs 72,
Push 37. The leg soreness ticks are the entire reason he got Upper.

Measured and rejected as the fix: replacing the clamp with `pct × 0.6` preserves the ordering and
leaves the winner unchanged (Upper 82.0, Pull 81.7, Lower 75.8). The defect is the double count, not
the clamp's shape — the entry says so, so it is not re-tried.

`mood_logs` has no provenance column, so nothing downstream can tell a volunteered report from an
accepted suggestion. That is what makes the clean fix a schema change, and it is why BF-173 carries
`Gate: owner` rather than a chosen direction.

**Filing order matters:** fixing BF-171 makes BF-173 worse, because normalising `core` → `abs` adds
another correctly-matched muscle to the double count.

## Third follow-up — the owner's two proposed fixes, measured

*"I think an option would be to look for a muscle group trained within the past 24 hours instead.
And also there should be different scoring recovery for smaller muscle groups like abs vs quads."*

**The 24 h auto-tick window** does flip the pick to Lower — by **0.4 points** (Lower 84.4, Upper
84.0). Recorded in BF-173 and not recommended: it decides the pick by less than half a point while
the double count stays live inside 24 h, and the 48 h window is separately load-bearing for the
per-exercise deload, whose own source comment calls back-to-back leg days at 46-47 h *"exactly the
case worth deloading"*. The separation worth keeping is 48 h for the deload question, no double
count for the selection question.

**Per-muscle recovery constants** are filed as BF-174. The model has one base `tau` of 24 h for
every muscle, scaled only by bout volume against that muscle's own median — no notion of size. A
probe (abs/calves ×0.75 … quads/glutes/hams ×1.25, invented, not fitted) moves abs 86 → 93 and
quads 69 → 63, and the `Math.min(48, …)` ceiling is already binding on the large muscles, so
hamstrings do not move at all.

**The interaction is the finding:** on its own the per-muscle base does not change the pick, and
**combined with the 24 h window it cancels it** — slower large muscles lower the leg sessions,
undoing what the narrower window gave them. Both of the owner's ideas land on Upper together and
Lower separately. That is the argument for fitting BF-174 against data rather than shipping a
plausible table, and for BF-173 landing first.

## Owner decision — provenance, and the premise confirmed

*"It auto picked muscles for me i didnt choose them manually."* — **BF-173 was filed with that as an
inference from `suggestedSoreMuscles`'s thresholds; it is now a statement from the lifter.** It also
promotes the defect from an edge case to the normal path: if he does not hand-tick, every tick in
`mood_logs` is a suggestion echo and the clamp has double counted on every check-in.

*"Happy to go with your recommendation."* — **provenance**, over the cheaper no-schema suppression.
The gate on BF-173 is cleared and the alternative stays recorded as the fallback if the migration
proves to be the expensive half.

**Two consequences written into the entry so they are not re-litigated:**

- **The clamp will go dormant**, because with provenance and an owner who accepts the pre-selection
  no tick is lifter-added. That is the correct outcome — the recovery pct already carries the fact —
  and the entry says so, because an implementer who finds `Math.min(pct, 40)` never firing will
  otherwise "fix" it back.
- **The deload is unaffected, and this was verified rather than assumed.**
  `computePerExerciseDeload` (`per-exercise-deload.ts:30-51`) reads `soreMusclesInSession` from the
  mood log through `moodMuscleMatches` and never touches `sessionRecoveryScore`. So the 48 h
  auto-suggest keeps driving deload while selection stops double counting — which is exactly the
  separation the entry argued for, now confirmed in code.

BF-173 and BF-171 move to the top of the queue, **sequenced rather than batched**. The first attempt
batched them — both edit `sessionRecoveryScore`, both settle on the same unit tests — and
`next-item.js` rejected it correctly: the provenance fix carries a migration, and a migration never
batches because its revert is a corrective migration. `Needs: BF-173` on BF-171 gets the same
ordering guarantee at no revert risk, and the ordering genuinely matters — BF-171 landing first
would make the recommendation worse, since every muscle it newly matches is a muscle BF-173's double
count then clamps to 40.

<a id="2026-09-16-bf167-deload-flag-disagrees"></a>

# 2026-09-16 — BF-167: the deload is applied and the toggle says otherwise (BugFix intake)

Docs-only. Owner: *"I dont know if its triggered deload or not. I accepted the ai reccomensatuon."*

## It did. Every exercise is cut.

| exercise | prescribed | `preDeload` |
|---|---|---|
| Barbell Bench Press | **52%** | 76% |
| Barbell Overhead Press | **52%** | 72.5% |
| Cable Chest Dips | **52%** | 70.5% |
| Dumbbell Fly | **52%** | 76% |
| Tricep Cable Combo | **52%** | 76% |

All five carry `deloaded: true` and `deloadNote: "Deload — illness radar: elevated"`.

## And the same stored object says `deload: false`

`prescription.deload` reads **false** on this row and the three before it, while the exercises inside
read `deloaded: true`. The disagreement is inside one JSON blob, and the toggle reads the flag:

```tsx
prescribedDeload={… && !!periodization?.state.prescription?.deload}   // false here
```

So `DeloadToggle` renders *Full — **As prescribed*** over a session at 52%.

## The component is already right — do not touch it

BF-8 fixed the labels and its comment names this exact failure: *"When the engine has already applied
a deload, Full is an OVERRIDE of it — and saying 'as prescribed' there is how the screen came to
contradict the card below it."* It behaves correctly **when told the truth**.

The root is that the two fields answer different questions. `prescription.deload` means *this is a
deload prescription* — a phase decision. `exercises[].deloaded` means *this exercise's load was cut*,
here by the illness radar **after** the model produced its plan. BF-8 wired the label to the phase
flag, and a per-exercise safety deload never sets it.

Recommended: read `exercises.some(e => e.deloaded)`, which is the question the label actually asks. A
phase deload sets `deloaded` on its exercises too, so one read covers both.

## The same cause, one paragraph lower

The rationale says *"within the **72.5-80%** intensity band for the primary compound"* against rows at
**52%** — those are the `preDeload` figures (bench 76%, inside the band). The prose was written before
the radar cut the loads and nothing regenerated it. BF-99's class again, and fixing the toggle does
not fix it.

## Cleared, so it is not refiled as a bug

The rationale's *"50-min working budget"* against a picker showing **Normal 60 min** is **correct**.
`effectiveTimeBudgetMin` is `workingBudgetMin(total)` — total minus the warm-up carve-out — so ~48–50
of a 60-minute session is right, and the model says *"working budget"* precisely. All 23
`program_sessions` rows carry `time_budget_minutes = 60`. Two right numbers measuring different
things; I nearly filed it as a hallucination.

## Not exercised

Docs only. Every figure is a production read of `session_periodization` and `program_sessions`.

<a id="2026-09-16-bf168-bf169-completion-signals"></a>

# 2026-09-16 — BF-168 and BF-169: two ways the app is unsure a workout finished (BugFix intake)

Docs-only. Two reports in one message, and only one of them is solved.

## BF-169 — the stamp waits for the exercise library

*"Some workouts show the completed sign straight after the workout. But some days dont… It may be
some specific excercises or how long it takes to leave the last screen."* Both guesses are right and
they are the same cause.

```tsx
{trainedToday && muscleActivations.length > 0 && <CompletedStamp />}
```

`muscleActivations` is empty until `library.length > 0` — a separate fetch. So the stamp is gated on
the exercise library arriving (*"how long it takes"*), and on that session's exercises producing
assignments at all (*"specific exercises"*).

**Every other completion signal on the same card uses `trainedToday` alone**: the green ring, the
screen-reader text, and the button reading **Start Again**. The card says "complete" three ways while
the one visual he looks for is missing — visible in his own screenshot, which shows Start Again and
no stamp.

It is not a careless line. `:432` guards the *heatmap* on the same array, correctly, because a
diagram with no assignments is nothing; the stamp is drawn over that diagram and inherited the
condition. Fix: gate the stamp on `trainedToday` alone, leave `:432` as it is.

## BF-168 — the leave prompt on a screen with nothing to leave

*"After excercise is conplete it still asks for confirmation to leave"*, with the dialog over the
session-select screen.

```ts
if (isWorkoutActive(getState()) && window.location.pathname.startsWith("/workout"))
// isWorkoutActive = !!workoutStartMs && mode !== 'done'
```

**`/workout` is the session-select tab as well as the workout screen**, so the path term cannot tell
"in a workout" from "looking at the list".

**The exact state was not reproduced, and the entry says so.** `resetSession()` clears both fields;
the completion path sets `mode = 'done'`; the mount-time reset depends only on `[sessionType]` so it
does not run on a return to the tab; `rolloverDay` touches neither. Something leaves the pair set and
reading did not find it.

**One observation narrows it**, and it is a question rather than a finding: the card behind the
dialog offers **Start Again**. If that was tapped, a new session legitimately began and the dialog is
*correct* — while the card still reads COMPLETED, which is why it looks wrong. That makes it a
labelling problem with a different fix, so the entry asks before anyone builds.

The entry also warns against widening `isWorkoutActive`: the same predicate guards the guided-walk
and activity prompts in that listener and the `beforeunload` warning, and BF-166 records that this
guard is the only thing between a back press and a discarded session.

## Not exercised

Docs only. Both mechanisms were read in the shipped source; neither was reproduced, and BF-168 is
explicitly unresolved on its trigger.

<a id="2026-09-16-bf168-dialog-outlives-navigation"></a>

# 2026-09-16 — BF-168: the leave dialog outlives the screen that raised it (BugFix intake)

Docs-only. BF-168 was filed with one question for the owner, because the answer chose between two
different fixes. He answered: *"No; it was straight after finishing the workout and pressing the back
button."*

That kills the Start-Again theory — no new session had begun, so this is not a labelling problem.

## A second read eliminated three more candidates and none was the cause

- The store's `persist` has **no `partialize`**, so `mode` is persisted and cannot fall back to
  `'pre'` on rehydrate.
- `isWorkoutActive`'s own comment confirms `'done'` is the deliberate and only safe exit: *"'pre' is
  also the hub screen shown during a workout … so it must NOT be excluded here."*
- **No site re-arms `workoutStartMs`** — outside the start handler the only write is the clear at
  `workout-screen.tsx:1698`.

## What the second read did find

**The dialog is never dismissed on navigation.** `confirmLeaveOpen` is set at
`mobile-auth-handler.tsx:48` and cleared **only** by the user tapping Stay or Leave. There is no
effect on `pathname`.

So a prompt raised legitimately on one screen **survives any navigation** and reappears over whatever
is now displayed — which is precisely a "Leave workout?" dialog sitting over the session-select tab,
a screen with no workout to leave. It matches the screenshot rather than merely being compatible with
it.

That makes a testable sequence: back pressed while the last exercise's summary was still up
(`mode === 'exercise-summary'`, `workoutStartMs` set) raises the dialog **correctly**; the app then
reaches `done` and navigates to session-select, and the undismissed dialog rides along. *"Straight
after finishing"* fits that moment — finishing the last set reads as finishing the workout.

## Worth fixing regardless of whether it is the whole story

The missing dismissal is not specific to this path: any of the three guards in that listener can
raise a prompt that then outlives its screen. One effect clearing all three confirm flags on
`pathname` change covers it.

The entry still does not claim the root cause is settled, because it is not — it claims a real defect
that produces this exact appearance.

## Not exercised

Docs only. Read in the shipped source; not reproduced on device.

<a id="2026-09-16-bf170-collapsed-meal-macros"></a>

# 2026-09-16 — BF-170: the footer was withheld on a promise the collapsed row does not keep (BugFix intake)

Docs-only. Owner: *"Same issue here where the singular meal doesnt show macro below it."*

His diary makes the comparison itself. **PRE WORKOUT** holds one saved meal (*Protein Shake +
Cruskit*, 5 ingredients) and shows **no P/C/F**. **POST WORKOUT**, directly below, holds one loose
food and shows **P 17g · C 17g · F 10g**.

## The suppression is deliberate and rests on a false premise

```ts
// A group row states its own macros AND calories; a loose row states neither.
return kinds[0] === 'meal' ? { show: false, … } : { show: true, … }
```

`mealFooter` withholds the section footer for a lone meal because the group row is believed to state
its own macros. It does not — `diary-meal-group.tsx` puts the P/C/F line **inside `{open && (…)}`**,
under the ingredient rows. The always-visible header carries the name, the ingredient count, the
calories and a chevron. **Collapsed, which is the default and what his screenshot shows, the row
states calories only.**

So the footer is skipped for a claim that is half true, and the macros appear nowhere.

## It is BF-120's own defect with the kinds swapped

`meal-card-footer.ts` records why BF-120 existed: *"a section holding one loose food showed protein,
carbs and fat **nowhere**, while the section above it showed all three."* That is his screenshot
again — except the section showing nothing is the meal and the one below showing all three is the
food.

## Fix at the group, not at the footer

Move the P/C/F line out of `{open && …}` so a collapsed meal states its macros beside its calories.
That makes the comment true, leaves the decision table untouched, and fixes every meal group rather
than only the lone-in-a-section case. Patching `mealFooter` instead would print the macros twice the
moment the group is expanded.

Out of scope: whether a loose row shows per-item macros in the diary. Q-406 moved those into the
detail sheet on purpose and BF-120 settled the section-level answer that followed.

## Not exercised

Docs only. Both components and the decision module were read in the shipped source; the comparison
comes from the owner's screenshot.

<a id="2026-09-16-chore-or-117-owner-triage"></a>

# 2026-09-16 — the owner-gate triage: most of the 52 were never the owner's

**Branch:** `chore/or-117-owner-triage` · backlog only. No product code.

## The count, and what it hides

95 entries carry a gate: **52 `Gate: owner`**, 20 `Gate: device`, 22 `Verify: device`, 1
`Verify: owner`. Read as a work list that says the owner is blocking 52 items. They are not.

**Eight of them are provably not owner-ready** — Q-275, Q-272, Q-508, Q-515, Q-516, Q-522, Q-523,
Q-149. Every one is a scoring change, where the route is **Tuning proposes → the owner signs → Lane A
implements**, and every one says in its own text that **no proposal exists**. Q-149 is the clearest:
*"cannot be asked for until Tuning has produced"* the fitted number. Putting these to the owner asks
them to sign a blank page, and meanwhile they have been counting as owner debt in every sweep.
Marked `NOT OWNER-READY` so the next sweep skips them.

**Sixteen more are scoring-shaped** and need the same check, one at a time — they do not state
either way, so this entry does not claim they are unready.

## Two sittings, not five asks

Batched on **what the owner has to be sitting in front of**, per the batching rule's own axis:

- **`owner-admin-sitting`** — LA-68, TN-1, LA-56 all need a **fullHistory redecode/rollup triggered
  by hand from an admin session**. One login. Asked separately they cost three.
- **`owner-branch-protection`** — LB-52 (add classic protection beside the Ruleset so auto-merge
  works) and **Q-297's second residue** (should E2E become a required check). One settings page, two
  toggles. Nothing previously connected them; they sat in different domains.

## One closed on its own evidence

**Q-283** — *"~11 MB of indexes have never served a scan"*. Re-measured 2026-09-02 and **stale by
~14×**: its one real candidate was already dropped in migration 249, leaving **800 kB**. The entry
had said *"this should probably be CLOSED rather than implemented"* for two weeks and nobody acted,
because `Gate: owner` kept it alive. Dropping 800 kB of indexes is not worth an owner's attention.

The caution it carried survives in the removal note: **`idx_scan` counts reads, not constraint
enforcement**, so a zero-scan unique index is still working — `rr_intervals_pkey` read 0 in August
and 5,034 in September. Never drop an index on `idx_scan` alone.

## What is genuinely the owner's

**Actions only they can run (7, in 3 sittings):** the admin batch above · the branch-protection batch
above · `VACUUM FULL` (BF-106) · one tier's artwork (BF-126) · a night in the Polar H10 (Q-4, agreed
2026-08-04 and never done).

**Decisions only they can make (roughly 10):** real money (PS-46, an Apple Developer enrolment and a
new platform target) · new auth surface (PS-45) · two data-losing migrations (BF-144, LA-71) ·
deleting a live HTTP route (LA-89) · product direction (BF-77 shared meals, LA-82 degraded-profile
zones, PS-43 backfill policy) · a rename that does not deliver what was asked (Q-44).

Everything else in the 52 is mine, a lane's, or Tuning's.

## Result

Queue **339**; `Gate: owner` **52 → 43** with eight of those marked not-owner-ready. Backlog
**22,378 → 22,301**, baseline ratcheted.

`check-backlog-pointers` clean on 339 · `pnpm check:rules` **Ran 75 of 75**.

**Surfaces not exercised:** none apply — backlog only.

<a id="2026-09-16-chore-or-118-aggregation"></a>

# 2026-09-16 — seventeen entries, four asks — and a build hiding in a `Keep:`

**Branch:** `chore/or-118-splits-and-batches` · backlog only. No product code.

## The unblock: Lane B's READY was two, and one of its builds was filed as "not new work"

**Q-305's `Keep:` said the push:pull card section *"is Lane B's and is now unblocked"*** — the shared
grouping it waited on shipped as **LB-103 on 2026-09-13**. That sentence sat under a heading reading
*"shipped; only the stated residue is owed. **Not new work**"*, and the Keep carried an **inline
`Gate: device`**, which parks the whole entry because `keep.js` reads a gate from anywhere in the
block. So an unblocked Lane B build was in PARKED for three days while Lane B's READY list was two
items long.

Split out as **OR-118**. Lane B's READY: **2 → 3**.

**This is the second time an inline gate inside a `Keep:` has done this** — BF-46 was the first, in
August. The shape is worth naming: a gate written as prose inside a residue is invisible as a gate
and total in its effect.

**And I made the mirror-image mistake writing the split, then caught it:** OR-118 first carried
`Verify: device`, which means SHIPPED, so it filed unbuilt work under *"a look is owed, nothing is
blocked"*. Corrected to a plain **Verification** line. The field goes on when the code lands.

## Four asks instead of seventeen

Grouped on **what the owner has to be sitting in front of**, not on subject:

| grouping | entries | the one thing |
|---|---|---|
| `back-gesture-sitting` | BF-166, LB-107, LA-109, BF-100 | the Android system back gesture, which Playwright cannot fire |
| `admin-console-sitting` | Q-316/317/318/544/531, BF-10, LB-5 | `/admin` → Devices **in the APK** |
| `history-row-policy` | Q-298, Q-527, LA-21 | "a fix is forward-only — edit the history or leave it?" |
| `destructive-migration` | BF-144, LA-71, LB-42 | three migrations that remove data |

**The history-row grouping is the one that pays.** Three entries have been sitting unasked for weeks
because each felt too small to raise on its own — 10 rows, 1 row, 7 rows. Asked once it is a minute.
**And it has a decided precedent that should be offered with it: BF-81, 2026-09-01, the owner chose
no recompute** on 38 rows, told all three options and their costs. The reasoning generalises — a
partial re-derivation leaves a mixed-provenance column *harder* to reason about than a uniformly-old
one. Recommendation recorded: leave all three.

**`owner-admin-sitting` and `admin-console-sitting` are the same visit.** There is one device and one
person, so the entries wanting a *look* and the entries wanting the owner to *run* something are the
same screen on the same phone. Ten entries, one login.

## Two rules written down, because both were nearly broken here

- **An ask-grouping is not a `Batch:` when its members are migrations.** `CLAUDE.md` forbids batching
  a migration — its revert is a corrective migration. `destructive-migration` and `history-row-policy`
  are presented together and shipped strictly one at a time.
- **A `Batch:` cannot span lanes**, and `check-backlog-pointers` caught me trying: Q-533 is Lane A and
  the admin batch is Lane B. A batch ships as one PR, a PR is one lane's work. **The sitting is
  shared, the PRs are not** — a distinction the field cannot express, so it is prose on the entry.

## Result

Queue **340**. Lane B READY **2 → 3**. Seventeen entries reachable through four asks.

`check-backlog-pointers` clean on 340 · `pnpm check:rules` **Ran 75 of 75**.

**Surfaces not exercised:** none apply — backlog only.

<a id="2026-09-16-docs-lb111-movement-pattern-window"></a>

# 2026-09-16 — `docs/lb111-movement-pattern-window`

Backlog only. No product code.

**OR-118 was unparked as startable Lane B work four hours after being split out of Q-305, and it is
not startable: the number it renders cannot be fetched by any client today.** Filed the engine half
as **LB-111** (Lane A) and parked OR-118 on it.

## What the entry claimed, and what is actually true

OR-118 said: *"`components/health/` (the Training surface), reading shared helpers only. No storage,
no derivation change: every number it renders already exists."*

Half of that holds. The **grouping** exists — `movementPattern()` shipped as LB-103 on 2026-09-13,
and a grep shows it has **no callers at all**, so this card would be its first. The **numbers** do
not. The measurement in the entry — *legs 481 · push 433 · pull 333 · other 168 over 60 days* — came
from a direct query. Checked rather than assumed, every route that could serve it:

| route | window |
|---|---|
| `GET /api/weekly-muscle-sets` | `GET()`, no params — computes this Monday server-side |
| `GET /api/ai-periodization/weekly-volume` | same, `startOfWeekInTz(tz)` + 6 days, hardcoded |
| `GET /api/muscle-tonnage-trend` | 6 weeks, but **tonnage, not sets** |
| `grep -rn '60.*day' app/api/*/route.ts` | nothing |

**Tonnage is not a substitute and using it would have been the wrong kind of shortcut.** Legs move
far heavier loads, so a tonnage share overstates them — it would hide the pull-set deficit the card
exists to surface, under a label claiming to show set balance.

## Why this is Lane A's half first

The derivation is already windowed:
`getWeeklySetsByMuscleGroup(userId, programId, weekStart, weekEnd, tz)` takes **arbitrary** start and
end dates in spite of its name. Every caller throws that away. So what is missing is an **exposure**,
and a route under `app/api/**` is Lane A's by the path rule — *both halves → Lane A, engine half
first*. Building the card first would mean either a Lane B route (a lane violation) or a card that
silently renders one week and calls it a balance.

**One real design question goes with it**, which is why LB-111 is not a one-liner: the method scopes
to a single `programId`, and a 60-day window can span a programme change, so sets logged under a
previous programme either count or vanish. Recommended counting them — the card's claim is about the
lifter's training balance, not one programme's adherence — but it is a genuine choice and the answer
belongs in the route.

## The lesson, which is the third of this shape in two days

An entry's statement about **what data exists** is prose until something checks it, exactly like its
recommended fix and its plan. BF-167's recommendation would have reddened BF-8's guard; BF-5's plan
told PR 2b to keep a param the route cannot honour; OR-118 says every number already exists and one
of them does not. All three were caught by reading the thing the entry pointed at rather than the
entry — and in this case by a grep for `movementPattern` callers, which returned nothing and made
the "already exists" claim checkable in one command.

**Not a criticism of the split**, which was right: the build genuinely was hiding inside a `Keep:`
with an inline gate, and finding it was the hard part. The premise it inherited came from Q-305.

<a id="2026-09-16-feat-bf5-week-in-review-page"></a>

# 2026-09-16 — `feat/bf5-week-in-review-page`

**BF-5 PR 2b** — the week in review is a page, not a banner that expands. v1.457.0.

Owner, 2026-08-23: *"rather than chevron type display; id rathee its own page that you can get to
from a banner notifcation; or a permanent link in the health tab somewhere - the page shohld be more
indepth; kinda like the training calendar entry; but for the whole week. so it can visually compare
the week based on the metrics its talking about."*

PR 2a (2026-09-15) made `/api/weekly-digest` return the metrics it used to flatten into a prompt and
throw away, on the cached path as well as the fresh one. This is the surface half.

## What shipped

- **`app/health/week/`** as `page.tsx` + `week-detail-content.tsx`, beside `app/health/day/` — the
  shape the owner named.
- **The week drawn, not described.** `WeekVolumeChart` (tonnage per day, a rest day as a real zero
  rather than a gap) and `WeekMetricCard` (readiness, sleep score, sleep hours, HRV, high-stress
  minutes — each the week-over-week pair the paragraph states, over the seven daily readings that
  average to it). Both `react-chartjs-2`, per the plan; nothing hand-rolled.
- **Reused rather than rebuilt:** `WeeklyMuscleSetsCard` for muscle volume, and `WeekTrendsSection`
  (Q-112e) for the month around the week — it answers a different question from this page's own
  metrics, five *weekly* points against the four completed weeks before them, so it moves here
  rather than being dropped or duplicated.
- **The banner becomes the entry point.** A tap opens the page; the once-per-week fetch, the
  `localStorage` dismissal and the error state all stay, because they are what make it a banner.
- **A permanent Health entry** (`weekInReview` in `TRAINING_ORDER`, beside the calendar). The banner
  is dismissible and fires once a week, so a page reachable only from it is unreachable for the rest
  of the week — and permanently so for anyone who dismissed it.
- **The reminder lands on the page** (`/health/week`) instead of Home with a param.

## Two of the plan's own PR-2b instructions did not survive contact

Both for one reason, found by reading the route before building against it: **`/api/weekly-digest`
computes the recap week itself and reads nothing from the body but `force`.**

1. **The plan suggested keeping a query param so `reminder-deep-links.test.ts` could stay as-is** —
   *"the cheaper option that keeps the test as-is: keep a param the page reads."* That param would
   have been a control the route cannot honour: the exact "valid link that does nothing" that test
   was written to catch. Inventing one to satisfy the test would have been the tail wagging the dog.

   **The test was generalised instead.** A query-less row asserts what actually makes a route land
   somewhere real: it has its own `page.tsx`, **and it is not a tab href** — read from `TABS`, so
   adding a tab cannot quietly approve a reminder that lands on it. That second half is the original
   failure restated: `/` was wrong because it opens a tab and leaves the user to find a banner, and
   so would `/nutrition` be. Query-bearing rows keep their assertion unchanged. Proven load-bearing
   by pointing the reminder at `/nutrition` and watching it go red.

2. **The page therefore takes no `?week=`.** I had written one in before checking the route. Removing
   it also keeps the plan's §6 — *"an arbitrary past week is a real query-range change and its own
   entry"* — true rather than half-implemented behind a parameter that silently did nothing.

## The stray trailing `*` was neither a metrics problem nor this page's

`Response`'s `parseIncompleteMarkdown` is a **streaming** repair: it counts single asterisks and
appends a closing one when the count is odd. That is right mid-stream and wrong for a string that is
already finished, where an unterminated `*` is text the model wrote.

The prop already existed and defaults to `true`, so the fix is to pass `false` where the string is
complete. **Sibling-surface sweep:** the weekly digest (this page) and the daily digest card are both
finished strings; the coach's transcript genuinely streams and keeps the default. `DismissibleBanner`'s
unused `href` prop gained a comment rather than a change — it renders a bare `<a>`, which inside the
WebView reloads the app and discards every mounted tab, so the banner navigates via the transition
router.

## What was verified, and what was not

- `components/health/week/__tests__/bf5-week-in-review-page.test.ts` — **10 of 13 assertions fail
  against `main`**. The three that pass on both sides are deliberate preservation pins: the
  once-per-week fetch, the dismissal, and the banner's error state. Stated rather than counted.
- `e2e/bf5-week-in-review-page.spec.ts` — **3 passed** in the browser: the failure path (which is
  what a harness run actually reaches, since `/api/weekly-digest` 5xxs here without an LLM key), the
  render against a stubbed payload, and the Health entry point navigating. The stub proves the page
  draws what it is given and says nothing about the route computing it — PR 2a owns that half, and
  the spec says so.
- `card-429-error-state.spec.ts` and `tabs-instant-paint.spec.ts` — **passed unchanged**, which is
  the check that the banner is still a banner: it still fails loudly and still POSTs on Home mount.
- `reminder-deep-links.test.ts` — 7 passed, with the generalised branch proven red.
- Full suite **7526 passed**, `pnpm check:rules` **Ran 75 of 75**, lint 0 errors, build clean.

**NOT exercised: the device, and specifically the notification.** No harness run can fire a
Capacitor local notification, so that the reminder actually lands on `/health/week` is settled only
on the S25. Also unexercised: safe-area insets under the page's scroll container, Samsung WebView
canvas rendering for the two charts at 412 dp, native SQLite, and drifted production data — the
charts were driven from a synthetic fixture, so a real week's shape (long muscle names, many PRs,
a week with no readings at all) has not been seen. BF-5 carries `Verify: device`; Q-112e's own
`Keep:` was rewritten, because it pointed the owner at a banner expansion that no longer exists.

<a id="2026-09-16-fix-bf170-collapsed-meal-macros"></a>

# 2026-09-16 — `fix/bf170-collapsed-meal-macros`

**BF-170** — a logged meal in the Nutrition diary showed its protein, carbs and fat nowhere.
v1.456.23.

## The defect

`mealFooter` withholds a section's totals footer when the section holds a single meal, on an
explicit premise written in its own source: *"A group row states its own macros AND calories; a
loose row states neither."*

The group row did not keep that promise. `diary-meal-group.tsx` renders the thumbnail, the name, the
ingredient count, the **calories** and a chevron in its always-visible header; the P/C/F line sat
**inside `{open && …}`**, under the ingredient rows. Collapsed — which is the default, and
deliberately so, because the flood of one meal as eight sibling rows is what BF-39 was filed on — the
row stated calories only. So the footer was withheld for a claim that was half true, and the macros
appeared nowhere.

The owner's screenshot is **PRE WORKOUT** (one saved meal, five ingredients) showing no P/C/F
directly above **POST WORKOUT** (one loose food) showing *P 17g · C 17g · F 10g*.

**This is BF-120's own defect with the kinds swapped.** That entry's reasoning, still in
`meal-card-footer.ts`, reads: *"a section holding one loose food showed protein, carbs and fat
nowhere, while the section above it showed all three."* Same sentence, meal and food exchanged.

## The fix

The P/C/F line moved out of the expansion to sit full-width under the header — and outside the
header's `role="button"`, since it is not part of what toggles and the entry asked that the
four-element row not gain a fifth thing.

Fixed at the **group**, not at the footer, as the entry directed. That makes `mealFooter`'s premise
true for **every** meal group rather than only a lone one, needs no change to the decision table,
and avoids the duplicate that fixing it in `mealFooter` would produce the moment the group opened.
`mealFooter` and `meal-card.tsx` are untouched.

No duplication anywhere else: the section's own `MealTotals` renders only while the **section** is
collapsed, which hides the group entirely.

## The e2e covered this component and could not see it

`e2e/diary-nested-meal.spec.ts` had four tests over `DiaryMealGroup`, and **none of them could fail
on this defect**. The one that asserts `P 24g` taps the row open first, so it passed throughout —
the entry spotted this and it is worth recording, because the file reads like coverage.

A fifth case now asserts **before any tap**: the group is still `aria-expanded="false"` with every
ingredient name absent, and `P 24g` / `C 60g` are each on screen exactly once. Counted rather than
scoped, which is the stronger form BF-120's own case uses — `toHaveCount(1)` fails on 0 (this
defect) and on 2 (a duplicate). It then opens the group and re-counts.

**Proven load-bearing in the browser:** against the unfixed component it fails with
`Expected: 1, Received: 0` — the owner's screenshot reproduced in the harness.

## What was verified, and what was not

- `components/nutrition/__tests__/bf170-collapsed-meal-macros.test.ts` — **1 of 4 assertions fails
  against `main`** (the ordering one, which is the fix). The other three are pins that pass on both
  sides: the macro line appears exactly once, the expansion still carries the ingredient rows, and
  `mealFooter`'s three cases are unchanged. Stated rather than counted as evidence.
- `e2e/diary-nested-meal.spec.ts` — **7 passed**, including BF-39's collapse behaviour, BF-98's
  no-duplicate-footer case and BF-120's lone-loose-food case, all unchanged under this fix.
- Full suite **7513 passed**, `pnpm check:rules` **Ran 75 of 75**, lint 0 errors, build clean.

**NOT exercised: the device.** What the S25 adds over the harness here is width — the macro line
sits under a header already carrying a thumbnail, a name, an ingredient count, a calorie figure and
a chevron, and the harness runs a mobile viewport but not Samsung's WebView. Native SQLite,
safe-area insets and drifted production data were all untouched. BF-170 carries `Verify: device`.

<a id="2026-09-16-fix-lb113-health-connect-timezone"></a>

# 2026-09-16 — `fix/lb113-health-connect-timezone`

**LB-113** — `syncHealthConnect(tz = DEFAULT_TZ)` and `enrichActivityLogs(candidates, tz = DEFAULT_TZ)`
gained the parameter on 2026-09-16 and nothing passed it, so both fell back to Brisbane. v1.457.6.

Right for the owner, wrong for anyone else, and silent either way — the shape CLAUDE.md names
directly: *"a default every caller overrides is a safety net, and it is what makes forgetting
silent."*

## The entry named the wrong second call site, and the one it missed is the one that mattered

It said *"`components/health-connect-provider.tsx` calls both without it"* and *"small and local: two
call sites in one component"*. Neither half held.

- **The provider calls only `syncHealthConnect`.** It is twelve lines and calls one function.
- **The un-timezoned `enrichActivityLogs` call is inside `syncHealthConnect` itself**
  (`lib/health-connect-sync.ts:471`), where `tz` is already in scope and was simply dropped.

That second point is what makes it worth writing down: the entry's own pass test — *"neither entry
point is called without a timezone"* — would have been satisfied by fixing the component alone, while
enrichment carried on bucketing in Brisbane. A grep for both names across the repo is what found it;
reading the entry would not have.

## The provider did not have the session either

The entry assumed *"the provider has the session and can pass `session.user.timezone`"*. It is a bare
client component with no props and no session access.

It is mounted inside `UserTimezoneProvider` (`app/layout.tsx:162`, inside 151–172), which is fed
`session?.user?.timezone` from the server layout — so `useUserTimezone()` is the app's established
client-side source and gives the same value the entry wanted. Because the provider is server-fed
there is no placeholder-to-real flip, which is what makes it safe to depend on: the effect is keyed
on `[tz]` rather than `[]`, so changing the profile timezone re-syncs instead of pinning whatever was
current at mount, and there is no double sync on first render.

The `= DEFAULT_TZ` defaults stay. Removing them would be a breaking signature change to a module Lane
A owns, and the defect was the callers.

## What was verified, and what was not

- `components/__tests__/lb113-health-connect-timezone.test.ts` — **4 of 5 assertions fail against
  `main`**. The fifth is a deliberate pin that the defaults stay in place, and passes on both sides.
- `e2e/tabs-instant-paint.spec.ts` — **7 passed**. Not a test of the sync, which cannot run here; it
  is the check that the root layout still paints, since this provider is mounted in `app/layout.tsx`
  and a fault there takes every tab with it.
- Full suite **7577 passed**, `pnpm check:rules` **Ran 75 of 75**, test-typecheck none above
  baseline, lint 0 errors, build clean.

**NOT exercised: the sync itself, and it cannot be here.** `syncHealthConnect` returns immediately
unless `Capacitor.isNativePlatform()`, so every harness run takes the early exit — the tests pin the
call sites, not the behaviour. The check that matters is on the S25 with a non-Brisbane profile
timezone: sync, then confirm a day's metrics land on the day the phone shows. LB-113 carries
`Verify: device`.

<a id="2026-09-16-fix-workout-completion-surface"></a>

# 2026-09-16 — `fix/workout-completion-surface`

**BF-169 · BF-168 · BF-167** — three defects on the surfaces either side of finishing a workout,
shipped as one PR. Batched on the verification, per the backlog's rule: all three are settled by the
same device run — complete a session, press back, land on the select tab — and each costs the same
workout to reach. v1.456.22.

## BF-169 — the COMPLETED stamp waited on a fetch it has nothing to do with

The stamp rendered on `trainedToday && muscleActivations.length > 0`. The second term is the
exercise **library**, a separate fetch: until it lands `muscleActivations` is `[]` and the stamp does
not draw, however complete the session is. A session whose exercises produce no muscle assignments
yields the same empty array. That is exactly the owner's *"some days dont… it may be some specific
excercises or how long it takes to leave the last screen"* — both of his guesses were right and they
were the same cause.

Every other completion signal on the card — the green ring, the screen-reader text, the button
reading **Start Again** — is driven by `trainedToday` alone, so the card said "complete" three ways
with no stamp. His screenshot shows precisely that.

The stamp now renders on `trainedToday` alone. The heatmap keeps its own
`muscleActivations.length > 0` guard, which was always correct for the diagram — a silhouette with no
assignments is nothing. The entanglement came from a guard that is right for one and wrong for the
other. `CompletedStamp` is `absolute inset-0`, so the container gains a `min-h-24` when there is no
diagram behind it to give it height; applied only in that case, so the working card keeps exactly the
height the heatmap gives it.

## BF-168 — two defects, and the entry's own proposal for the second would not have worked

**The path term.** `/workout` is *both* routes: `app/workout/page.tsx` renders `WorkoutScreen` when
`?session=<id>` is present and the tab shell otherwise — the same distinction `tabKeyForHref`
already encodes. `window.location.pathname` drops the query, so the old
`pathname.startsWith("/workout")` could not tell the workout screen from the session-select tab (and
matched `/workout-select` besides), and raised "Leave workout?" on a screen with nothing to leave.
Now `pathname === "/workout" && searchParams.has("session")`. `isWorkoutActive` is untouched, as the
entry required — both of its terms are load-bearing for the `beforeunload` warning and for the
guided-walk and activity guards.

**The undismissed dialog**, which the entry found while looking and which fits the screenshot: the
three confirm flags were cleared *only* by the user tapping Stay or Leave, so a prompt raised
legitimately on one screen survived any navigation. Press back while the last exercise's summary is
up and the prompt is **correct** at that instant; the session then reaches `done`, navigates to the
select tab, and the prompt rides along over a card reading COMPLETED.

**The entry proposed keying the dismissal on `pathname` change. That would not have fired for the
case it was filed on** — `/workout?session=<id>` → `/workout` is the *same pathname*. Keyed on the
subject instead: each flag clears when its own active-predicate goes false. All three, not just the
workout one, because any of the three guards can outlive its screen.

## BF-167 — shipped as a union, and the entry's recommendation was a regression

`prescription.deload` means *this is a deload prescription* — a phase decision.
`exercises[].deloaded` means *this exercise's load was cut*, which is what the illness radar and the
soreness quadrant set **after** the model has produced its plan. A safety deload therefore leaves the
phase flag false, and the toggle — which read only that flag — said *Full — as prescribed* over a
session prescribed at 52% of 1RM.

The entry recommended **replacing** the flag with `exercises.some(e => e.deloaded)`. Reading the
fixture before running it caught that this breaks BF-8's own guard:
`e2e/deload-visible.spec.ts` seeds `deload: true` with `exercises: []`, which a `.some()` alone reads
as *Full*. Shipped as the union instead — `deload || exercises.some(deloaded)`. The defect here is a
false **negative**, and the phase flag is never a false positive: when it is set the session
genuinely is a deload, so keeping it costs nothing and drops nothing. `deload-toggle.tsx` was not
touched; BF-8 already made it label correctly, and it does the right thing when told the truth.

## What was verified, and what was not

- `components/__tests__/workout-completion-surface.test.ts` — **5 of its 10 assertions fail against
  `main`**. The other five are deliberate "must not change" pins (the heatmap's own guard,
  `isWorkoutActive`, the `consumed` guard, `deload-toggle.tsx`) and pass on both sides, which is
  stated rather than counted as evidence.
- `e2e/deload-visible.spec.ts` + `back-dismiss-sweep.spec.ts` — **7 passed** in the browser. BF-8's
  guard holds unchanged under the union, which is the runtime confirmation that the union was right.
- The session-select card paints with no uncaught error both with the exercise library present and
  with `/api/exercise-library` aborted — the empty-diagram case BF-169 asked to be checked. Run from
  a throwaway spec, not committed: it proves the render, and a committed version would read as
  proving the stamp.
- Full suite **7508 passed**, `pnpm check:rules` **Ran 75 of 75**, lint 0 errors, build clean.

**NOT exercised.** The device, which is what all three actually need. Android's hardware back is a
Capacitor channel Playwright cannot fire, so **no harness run can touch BF-168's gesture at all** —
the tests pin the predicate and the dismissal, not the press. BF-169's `trainedToday` comes from
`readCacheSync('workout-card:<id>')`, whose web and device paths differ, so a seeded web
reproduction would prove the wrong runtime. Native SQLite, safe-area insets, drifted production data
and Samsung WebView rendering were all untouched. All three entries carry `Verify: device`.

## Also fixed in passing

`components/__tests__/bf166-back-closes-overlay.test.ts` — its ordering assertion anchored on
`indexOf('setConfirmLeaveOpen')`, and BF-168's new dismissal effects add an earlier occurrence of
that string at the top of the component, so the check would have gone on passing over a file where
the listener's guards had moved below the overlay check. Tightened to `setConfirmLeaveOpen(true)` —
the raise, which only the listener does — and the tightened form was proven red by moving the
overlay guard above the mode guards. Same trap as the import-vs-call-site one that test already
documents.

<a id="2026-09-16-lane-a-bf13-rederive-baselines"></a>

# 2026-09-16 — Lane A · BF-13/TN-6/Q-506/TN-8: a re-derivation for the zero-seeded baselines

**Branch:** `lane-a/bf13-tn6-baseline-seed` · **Batch:** `temperature-baseline` (4 entries)

## What this is

The `temperature-baseline` batch has been half-shipped since 2026-08-25. The *seed* was fixed then
(`seedOrUpdateBaseline`, Q-6): a fold that cold-starts now takes its mean from the first sample
instead of annealing toward it from zero. What that fix cannot reach is the **stored** baselines —
`computeDailySummaries` resumes from the previous night's persisted checkpoint, so the zero-folded
state is inherited forward every night, indefinitely. All four entries' pass tests were waiting on a
re-derivation that had never been run.

Measured in production before writing anything (`claude_ro`, so the owner's rows only): the
temperature baseline read **35.578 °C at n=62** and **35.658 at n=72**, still climbing toward nightly
values of 35.72–36.04, with `temp_dev_c` positive on **10 nights out of 10** and a baseline sd of
**1.41 °C** against a real spread near 0.1. That is the same defect the entries measured in August,
three weeks after the seed was fixed — which is the evidence that the seed fix does not reach stored
state.

## What shipped

`POST /api/admin/rederive-baselines` — admin-gated, rate-limited, `dryRun` by default. It reads the
nights already in `oura_daily_summary`, replays the fold cold (`seed = null`) through
`computeDailySummaries` — the same function the rollup folds with, so no formula is restated — and
rewrites the temperature baseline and `temp_dev_c` on the rows that differ.

**Only temperature is written.** That is the owner's 2026-08-24 decision: fix the seed for all six
metrics, re-derive only the ones measurably wrong. Temperature was the only one out by more than
noise (gap +2.80 nightly sd, above baseline on 100% of nights); the other five sat between −0.09 and
+0.28 sd. They are still recomputed and **reported**, so a later measurement that flips one has the
number in front of it, and they are written back unchanged — asserted on every written row.

## Why a route and not the Redecode the entries named

A full-history Redecode also re-derives: post-seed-fix it folds `seed = null` and replaces the table.
Three differences decided it.

1. It re-decodes every stored sample and rewrites the **nightly values** too. The owner's decision
   turns on the re-derivation touching a corrupted *intermediate* and leaving the raw nightly values
   alone — which is what makes it a different act from re-scoring history. This route is that act
   exactly.
2. It has **no dry run**. This one reports the full before/after per night without writing.
3. It needs the vendored decoder constants. TN-8 recorded that as the reason a Redecode "could not be
   run from a sandbox"; **that note needed a correction** — `lib/oura-models/constants/` is delivered
   at boot in production, so a Redecode *is* runnable there. The sandbox was the only blocker. This
   route needs no decoder at all, which is a smaller claim than the entry implied but still the
   reason it works where those constants are absent.

## The honest gap: illness scores are not re-stamped

Q-506's own metric does **not** move when this runs. `illness_score` / `illness_flag` live on
`oura_daily_derived` and are written by the rollup's `illness_radar` step alone — and despite a
comment in `rollup/run.ts` saying the readiness route computes illness live, `illnessFromSummaries`
has exactly one caller and it is that step. So a stored illness score keeps the z it was computed
with until a rollup pass rewrites that night, and the incremental rollup only covers the recent
window. Recorded in Q-506's `Keep:` rather than fixed here — re-stamping illness is the rollup's job,
not this route's.

## TN-8's pass test, half-converted

TN-8 asked for its premise to be asserted "in the same test that covers BF-13's re-derivation". Done
for the half a fixture can carry: against a zero-seed baseline **every** scored night's deviation is
positive, and after the cold re-fold they straddle zero with none above `TEMP_DEV_FEVER_LIMIT_C`.

The other half cannot be faked. The fixture is realistic — its zero-seed baseline lands on **35.464**,
the same value BF-13 measured in production — but its deviations peak at **0.671**, not the **1.33**
the owner's history reaches. It reproduces the sign bias, not the six nights that cross 1.0. That
measurement needs the run.

## Verification

- `pnpm test`: **924 files / 8765 tests** green (with `DATABASE_URL` set, so the DB-backed files
  actually ran rather than skipping).
- `pnpm check:rules`: **Ran 75 of 75**.
- Typecheck and lint clean (0 errors).
- **Mutation pass, 7 mutants, all killed**: write-every-row-unconditionally, push-the-recomputed-row-
  wholesale, `dryRun` failing open, warm-seed instead of cold, rate-limit removed, `nHistory`
  "repaired", and `temp_dev_c` left stale. **Equivalent control** (a wider `HISTORY_FLOOR`) stayed
  green.
  Two of those are worth naming. The control case — a history already folded with the correct seed
  must produce **zero** writes — is the only test that catches write-every-row. And the stale
  `temp_dev_c` mutant **survived the first pass**: a route that corrects the baseline but writes back
  the deviation computed against the old one fixes nothing any consumer can see, and every other
  assertion passed while it did. A test was added for it.
- `pnpm dev`: route compiles and returns 401 unauthenticated, with and without `?dryRun=false`.

**Not exercised.** The admin-authenticated path and the write itself never ran: the sandbox cannot
mint an admin session (Google OAuth), so the repository is a stand-in in every test and **no
production row was touched**. Nothing here says the owner's stored history has the shape the entries
measured — that measurement is theirs, taken through the admin read endpoint, and is not re-derived
here. No device, no native SQLite, no Oura hardware; the route is server-only and needs none.

## What is owed

The run. It is a production data write, so it was deliberately not fired from here. Recommended
order: dry-run first to read the size of the change, then `?dryRun=false`. All four entries stay in
the queue with `Keep:` lines, because every one of their pass tests is measurable only afterwards.

<a id="2026-09-16-lane-a-journal-compaction-sweep"></a>

# Journal compaction sweep — 60 foldable entries down to 30

**Lane A · branch `lane-a/journal-compaction-sweep` · docs only.**

## Why now

`check-doc-index-size` failed the RV-42 rebase: `docs/overview/entries/` held 61 foldable entries
against a limit of 60. `main` sat at exactly 60 — passing — and RV-42's own journal entry took it
over, so by BF-36's targeting rule the sweep fell to that branch.

**Doing it there would have been wrong.** RV-42 is #1098, an owner-gated security change that has
been waiting since 2026-09-11 and whose whole job is to stay minimal and mergeable. Folding forty
journal entries into it would bury a write-path ownership fix under a 44-file docs diff, in the one
PR whose diff most needs to stay readable. The chore belongs to `main`, so it ran on `main`.

It also unblocks everyone else: with `main` at exactly the limit, the *next* entry from any of the
six lanes would have failed the same way.

## What it did

`node scripts/fold-journal-entries.js`, dry-run first, per the README — the sweep has been a script
since 2026-09-10 and it repoints citations rather than refusing to fold cited entries.

- **40 entries folded** into `docs/overview/history-2026-09-16-folded-1.md`.
- **5 held back**, cited by an agent baton — the script refuses those deliberately, because
  rewriting them means one lane writing into another's live state file.
- Citations rewritten in 3 durable docs: `projectOverview.md`, `docs/implementation-backlog.md`,
  `docs/domains/nutrition/README.md`.
- **60 foldable → 30**, against a limit of 60. Thirty files of headroom.

Both link checks clean on the first pass — `check-doc-links` OK across 828 files,
`check-index-doc-paths` OK across 1,129 paths in 12 orientation docs. The README lists six traps
that broke earlier sweeps in six separate passes; the script now handles all of them, and this run
is evidence that it does.

## The cadence note is still right, and this run confirms the arithmetic

The README's LA-25 measurement says ~17 entries/day across the concurrent sessions, so a sweep
clearing 25 buys about a day and a half. This one cleared 30 from a directory that was at the limit,
which buys under two days at that rate. It is a near-daily chore, and the trigger is reliably *the
guard failing someone's PR* rather than anyone sweeping ahead of it.

The cheaper half remains the citation habit: when a durable doc needs to cite a session, cite the
review or handoff document rather than the loose journal entry. The linked floor is now 29 — those
are permanent weight that no sweep can reclaim.

## What is NOT done

Nothing in `#1098` itself. It gets re-merged onto this once it lands, which is the point.

## Failure surfaces NOT exercised

Docs only; nothing runs. `pnpm ci:local` green — **Ran 75 of 75 Custom Rules steps**, 922 files /
8,736 tests.

<a id="2026-09-16-lane-a-la110-root-cause"></a>

# LA-110's declines are a week of unprescribed logs, not a rep-range artefact

**Lane A · branch `lane-a/la110-root-cause` · docs only. No code, deliberately.**

## Why this entry was picked up at all

I had been classifying LA-110 as blocked on an owner decision. **It is not.** It carries no `Gate:`
and no `Needs:`, it is not on any standing exclusion list, and Q-52 is parked waiting on it. What the
entry says is that the *shape of the fix* is undecided — and CLAUDE.md is explicit that a choice like
that is the implementer's to make and state, not the owner's. Treating an undecided implementation
shape as an owner gate is how a startable item sat still for a day.

## What the entry says, and why it is wrong

LA-110 reads the measured declines as a rep-range signature: a 1RM estimated from a 15-rep set is
systematically lower than one from a 3.5-rep set, so the comparison needs keying like-for-like.

The mechanism is real and the conclusion does not follow, because `calculate1RM` **already** corrects
for it on any prescribed set. `prescriptionFactor(pct, targetReps) = 1 / ((pct/100) × repFactor(targetReps))`,
so when the lifter hits the prescription the estimate reduces to `weight ÷ pct` — phase-independent by
construction. Moving into accumulation should not move the estimate, and where the prescription was
recorded, it did not:

| session | set | `planned_pct` | stored estimate |
|---|---|---|---|
| 2026-08-24 Realisation | 90 kg × 3 | **88** | 103.75 ✓ |
| 2026-09-15 Accumulation | 65 kg × 7, 65 × 11 | **76** | 91.25 ✓ |
| 2026-09-07 | 60 kg × 15 | **NULL** | 82.75 ✓ |

Each figure reproduces from the formula. The third has no prescription, so `prescriptionFactor`
returns null and `amrapScaleFactor(15) = 0.88` treats a submaximal working set as a maximal AMRAP.
**That row is the entry's own "−20.2%" point.**

## It is a dated window, which is what settles it

Counting production logs with `estimated_1rm > 0` across 60 days:

- **2026-09-06 → 2026-09-12 — wholly affected.** 5 of 5 logs with `style_name` NULL, 5 of 5 sets with
  `planned_pct` NULL, and one set per exercise where every healthy day has two.
- **2026-09-13 — partial.** 2 of 10 sets lack a pct; no log lacks a style.
- **2026-09-15 — clean.** 0 of 10.
- Either side of it, 0–3 no-pct sets a day, consistent with legitimate extra sets.

Six compounds "declined at once" because six compounds were logged inside one bad week. A formula
property does not start on a Sunday and stop the following Saturday.

## Two further corrections to the entry

**`workout_sessions.phase_type` is NULL on every production row.** The entry's first proposed fix —
restrict the pair to the same phase — is not implementable as written. Phase survives only in
`exercise_logs.style_name`, which is itself NULL across the affected window.

**The table is already stale.** A session landed on 2026-09-15, so Barbell Bench Press's last two real
estimates are now 91.25 (9 reps) against 82.75 (15 reps) — **+10.3%**, not −20.2%.

## What is owed, and what I deliberately did not do

Two things, and the second is not mine:

1. **Why were seven sessions written with no prescription?** The logging path shows no relevant commit
   in the window, so this needs tracing rather than guessing. Not attempted here.
2. **Whether those stored `estimated_1rm` values get recomputed is an owner call.** It rewrites stored
   history, and PRs and `target_80` read the same column — it is not confined to a trend line.

I did not build any of the entry's proposed fixes. Each of them keys or suppresses the *comparison*,
which would hide a week of wrong stored estimates behind a rule that looks principled. The entry's own
warning against widening the trend thresholds — *"that hides a real decline as readily as a false
one"* — applies just as well to hiding one behind a rep band.

## Failure surfaces NOT exercised

Docs only; nothing runs. Every figure was read from production through the admin query endpoint and
re-derived from `calculate1RM` by hand, not taken from the entry. **The production reads are
row-scoped to the owner** (`claude_ro`), so this is the owner's data, not a system-wide statement.

<a id="2026-09-16-lane-a-la112-stress-excludes-sleep"></a>

# 2026-09-16 — Lane A · LA-112: daytime stress stops counting the night

**Branch:** `lane-a/la112-stress-excludes-sleep` · **v1.457.2**

TN-39's validation (merged earlier today) measured that **277 of 672** stress buckets fall inside a
recorded sleep session and **28 of the 140** counted as high-stress — so a fifth of the
`stress_high_minutes` the app calls *daytime* stress was recorded while the owner was asleep. This
fixes it.

## The fix is one filter, and WHERE it sits is the whole point

`buildDaytimeStressSeriesFromModel` now takes the sleep windows overlapping its range and drops those
buckets **before** `scoreStressPoints`, not after.

That ordering is the fix rather than a detail. `scoreStressPoints` calibrates against the
**day-median dHRV across whatever it is handed**. A sleeping bucket has a low heart rate, and
`hrCoef` is negative, so its imputed dHRV is *high*. Leaving sleep in raises the median — and every
waking bucket is then scored as sitting below baseline, i.e. stressed. **Filtering only the summary
would have removed the sleeping buckets from the count and left the waking ones still mis-scored.**
A test pins exactly that: the mutant that filters after scoring passes every other assertion in the
file.

## Two things found while doing it

**The sibling surface was already right.** `/api/body-battery` computes its series from
`wakeTime → now`; only the rollup used `aestMidnight(d) → aestMidnight(d+1)`. When BF-81 made the
rollup the single writer — to stop two producers disagreeing — it also adopted the rollup's
whole-day window. So this is closer to restoring semantics the app already had on one surface than to
choosing new ones. The route now passes its windows too, so the two agree *by construction* rather
than by coincidence of window: `wakeTime` falls back to the first HR reading and then to 07:00, and
either fallback can open the window before the owner actually woke.

**A day needs BOTH its nights.** Sleep rows are keyed by wake date, so filtering on
`sleepByDate.get(day)` alone would catch the night that ended this morning and miss the one starting
tonight. The owner's buckets ran densest in Brisbane 00:00–06:59 *and* 22:00–23:59 — that evening
tail is the second night. The rollup now filters on every window overlapping `[dayStart, dayEnd)`.

**The windows are read, not taken from the pass.** `sleepRows` only covers the nights the current
rollup pass reconstructed, while the stress series is recomputed over a fixed trailing 21 days — so
deriving the windows from the pass would make a day's stress depend on how wide the pass happened to
be. `RollupIO` gained `readSleepWindows(from, to)`, bound to the repository's existing
`listSleepSessions` rather than reimplemented (rollup-io's own rule for operations that aren't plain
slice calls).

## The parameter is required on purpose

`sleepWindows` has no default. A `= []` would read as "no sleep to exclude" at a call site that
simply forgot — the silent-omission shape CLAUDE.md's day-window rule already names. It worked: the
three existing tests failed loudly on the un-updated call, which is what a default would have hidden.

## What this does and does not change

**History self-heals within ~21 days.** The resilience loop recomputes the trailing
`RESILIENCE_MAX_DAYS = 21` summary rows on every rollup pass and rewrites their buckets and scalars,
so stored days inside that window are corrected by the next pass. Days older than that keep their old
values until a wide pass covers them.

**The size of the change could not be predicted before shipping.** Only `level` is persisted, never
`dhrv`, so the corrected levels cannot be recomputed from stored data — the median has to be rebuilt
from the raw inputs. The direction is certain (fewer waking buckets scored below baseline on
sleep-heavy days); the magnitude will be visible in the owner's numbers after the next rollup.

**The mechanism is read from the code, not inferred from the correlation.** Days whose buckets are
mostly sleep do flag 2.5× more of their *waking* buckets as high-stress (0.397 vs 0.158, corr
**+0.697** over 24 days) — but sleep share and waking-bucket count are **−0.95** collinear, so that
correlation cannot separate "the median is contaminated" from "fewer waking buckets, noisier share".
It is recorded as corroboration, not as the evidence. The evidence is that `scoreStressPoints` takes
a median over everything it is given.

## Verification

- `pnpm test` **924 files / 8770 tests** green (with `DATABASE_URL` set). `pnpm check:rules`
  **75 of 75**. Typecheck and lint clean (0 errors).
- **Mutation pass, 3 mutants, all killed:** filter-after-scoring, no-filter, inverted predicate.
  **Equivalent control** (hoisting the filter into a named const) stayed green. The first mutant is
  the one that matters — it is the naive version of this fix, and only the re-scoring test rejects it.
- Four new tests, including a control: a day whose recorded sleep does not overlap the window must
  come out byte-identical, which a change that merely lowered every level would fail.
- `pnpm dev`: `/api/body-battery` compiles and returns 401 unauthenticated.

**Not exercised.** The authenticated body-battery path and the rollup's own stress step never ran:
the sandbox cannot mint a session, and `daytime-stress-buckets.test.ts` records that the full rollup
pass "cannot run in this sandbox at all — it needs vendored constants". So `readSleepWindows` is
called only on a path no sandbox test reaches; what holds it is the typecheck on `RollupIO` and the
unit tests on the function it feeds. No device, no APK. Every production figure quoted is the owner's
rows only (`claude_ro` is row-scoped).

<a id="2026-09-16-lane-a-la114-bucket-mid"></a>

# 2026-09-16 — Lane A · LA-114: the rename that cannot happen, and what was done instead

**Branch:** `lane-a/la114-stress-bucket-mid` · **Migration 275 (a column comment)** · no version bump

`oura_daytime_stress_buckets.bucket_start` holds the bucket's **midpoint**, and has since the table
was created. `daytimeHrvEstimatesPerBucket` returns `t = bStart + bucketMs / 2`, `scoreStressPoints`
carries `t` through, and `run.ts` writes `new Date(p.tMs)` straight into the column, so stored
timestamps sit on a `:15`/`:45` grid. Migration 212's own header is where the mistake is written
down — *"the bucket's own start instant, from the series' `t`"*.

## The rename was written, applied, pushed, and reverted

CI's **Migration Check** rejected it, and it was right to. The job's second step replays every
migration against a schema that already has everything (LA-13). A rename fails that twice over:

1. **`ALTER TABLE ... RENAME COLUMN` is not idempotent** — on replay the old name is gone. Fixable
   with an `information_schema` guard.
2. **The one that is not fixable:** every historical `claude_ro` view migration — 213, 215, 218,
   221 … 274 — contains `SELECT ... t.bucket_start ... FROM public.oura_daytime_stress_buckets`,
   because each regenerates the **full** view set. After a rename, all of them fail on replay.

Making them pass would mean editing already-applied migrations, which `ensureSchema` makes
meaningless — it tracks by **filename**, so an edited file is skipped forever and the change never
lands.

**There is an escape hatch, and taking it would have been wrong.** `migrate.js` has a
`REPLAY_EXEMPT` map, and its single entry exists for exactly this: *"002 renamed the column its
`cardio_sessions` FK references"*. So the repo has done one rename, and it cost an exemption. Doing
it here would mean exempting **a dozen** generated view migrations from the check that just caught
this — hollowing out the check to land a cosmetic fix.

**The general rule, which is the finding worth keeping:** in this repo, a column an earlier migration
names by hand cannot be renamed without exempting every such migration from the replay check. That is
a property of the migration model, not of this column.

## What shipped instead

- **Migration 275 is a `COMMENT ON COLUMN`** — idempotent, names no column a historical migration
  would stop finding, and makes the database self-describing to `\d+` and `pg_description`. It
  carries the full reasoning above so the next person does not re-attempt the rename.
- **The Drizzle property is `bucketMid`**, mapped to the `bucket_start` column, and every TypeScript
  reader now says `bucketMid` — the slice, the adapter, the repository interface, `RollupIO`, the
  rollup, the stress-day route and the admin device-comparison route.
- Nothing is re-stamped. The stored value is not wrong: a midpoint is a legitimate representative of
  a 30-minute bucket and the chart plots it as a point in time.

## ⚠ The gap this leaves, stated plainly

**`claude_ro.oura_daytime_stress_buckets` still exposes `bucket_start`, and that read surface is
where the defect actually bit.** A join written the obvious way, against another 30-minute series on
the epoch grid, returns **zero rows** — which reads as "no overlapping data" rather than "the join is
15 minutes out". It cost an hour during TN-39's validation earlier the same day, and a TypeScript
property name does nothing for a SQL query. **Adding the 15 minutes is the caller's job.**

So **LA-114 goes back in the queue**, re-scoped: the naming defect is documented, not fixed, and the
entry now names the constraint so nobody re-attempts the rename.

**One option deliberately not taken:** teaching `generate-claude-ro-views.js` to alias the column
(`t.bucket_start AS bucket_mid`) would fix the read surface and be replay-safe, since the base table
keeps its name. It was rejected because it makes `public` and `claude_ro` disagree about a column's
name — introducing a second naming confusion to fix the first. Recorded in the entry as a live
option rather than dismissed, because it is the only idea so far that reaches the surface that
matters.

## What the rename attempt did leave behind, correctly

`bucketStart` is accurate elsewhere and was left alone: the device-comparison harness
(`lib/health/device-comparison.ts`, `lib/oura-comparison-harness*.ts`) buckets at
`floor(t / width) * width`. **One place already knew** —
`lib/oura-comparison-harness-adapters.ts:82` converts a dHRV estimate back with
`new Date(e.t - HRV_BUCKET_MS / 2)`. The harness had the semantics right the whole time; the
persistence path did not.

## Verification

- **The failure was reproduced and the fix shown passing**, on a throwaway database built the way CI
  builds one: apply all migrations (275 applied, 0 failed), `TRUNCATE schema_migrations`, replay
  (274 applied, 001 replay-exempt, **0 failed, exit 0**). That is Migration Check's two steps.
- `pnpm test` **924 files / 8770 tests** green. The DB-backed stress tests
  (`daytime-stress-buckets.test.ts`, `lb102-stress-day-read.test.ts`, **14 tests**) ran against real
  Postgres, exercising the Drizzle property against the unchanged column.
- `pnpm check:rules` **75 of 75** — it caught the backlog's migration pointer twice, first at 275
  when two migrations were added and again at 277 when they were withdrawn. Typecheck and lint clean.

**Not exercised:** no authenticated request, no rollup pass, no device. `db-snapshot-integration.test.ts`
skips locally, but with no view migration in this PR there is nothing for it to check.

## The lesson worth carrying

The first version of this was written, validated locally, and pushed — and the local validation
never replayed the migrations. `pnpm test` and `check:rules` both passed on a database where the
rename had already been applied once. **A migration is not tested until it has been applied twice to
the same database**, and this repo's CI does exactly that, which is why it caught it and the sandbox
did not.

<a id="2026-09-16-lane-a-lb110-already-shipped"></a>

# LB-110's claims were all true and its conclusion was still wrong

**Lane A · branch `lane-a/lb110-body-battery-date-param` · docs only. No code shipped, deliberately.**

## What the entry asked for

LB-110 appeared in the queue on 2026-09-15: `/api/body-battery` takes no date, so TN-3b's past-day
half is blocked on an entry (`LB-102`) that does not exist. Scope: add a `?date=` param.

It was the first genuinely startable Lane A item in days — no gate, not on any exclusion list, a
small bounded change to one route.

## Every source claim held. The conclusion did not.

Verified against `main` before writing anything, as the standing rule requires:

- `app/api/body-battery/route.ts:94` really is `export async function GET()` — no parameters. ✅
- `grep '^### .*LB-102'` really returns nothing. ✅
- The buckets really are persisted, and `stress-day-chart.tsx` really takes a plain array. ✅

All true. And the conclusion drawn from them — *therefore TN-3b is blocked and nobody will pick this
up* — is wrong, because **the work shipped on 2026-09-13 under a different path**.
`app/api/body-battery/stress-day/route.ts` serves the stored buckets for any day, takes `?date=` with
both separators, and `components/body-battery/stress-day-chart.tsx:78` fetches it — rendered from
`app/health/day/day-detail-content.tsx:260` with `date={selectedDate}`.

**LB-102 was never untracked. It was done**, which is why it left the backlog — the route and its
test both still carry its name (`lb102-stress-day-read.test.ts`). The entry searched the backlog for
the dependency and concluded from its absence that nobody would do it; absence from a queue that
removes completed entries is the signature of *finished*, not of *lost*.

## The route that shipped it rejects LB-110's design by name

Not a near-miss — a recorded decision:

> *"A sibling route rather than a `?date=` on the battery route, and the reason is not tidiness. The
> battery response is a live model anchored to `now` — the HR walk, the reserve, the label — and none
> of it can be computed for a finished day. A parameter that changed the response's SHAPE is the kind
> of thing that reads as one endpoint and behaves as two."*

So LB-110 is removed with the reasoning attached, rather than implemented to clear the queue. TN-3b's
`Keep:` now points at the shipped route instead of at a third successive phantom dependency.

## Two live hazards found before the duplicate surfaced, kept

The implementation was most of the way done when the sibling route turned up. Two findings are facts
about the live route rather than about the entry, so they are recorded on the removal note:

**`/api/body-battery` has two write side-effects on a GET.** It upserts the day's
`body_battery_daily` snapshot, and it calls `buildReadinessPayload(userId, tz)` — which takes no date
and persists **today**. Anyone who ever does date that route must make a dated read strictly
read-only: the snapshot is the *accumulated* end-of-day record (its own comment says so), and its
`hrMaxObserved` feeds `resolveBatteryHrMax` across the peak window, so a retrospective write would
propagate forward into later days' batteries.

**The entry's scope line named the wrong helper.** It said to normalise with `normalizeDateParam`,
which returns the **slash** form, in a route that is dash-keyed throughout. That is the J-8/J-9
silent-feature-death shape, and following the entry literally would have produced a route that
returned empty days without erroring.

## What is NOT done

No code. The route is untouched — `git checkout --` restored it, and the diff is markdown only.

## Failure surfaces NOT exercised

Docs only; nothing runs. `pnpm ci:local` green.

<a id="2026-09-16-lane-a-tn25-walk-band"></a>

# 2026-09-16 — Lane A · TN-25: the walk's fast target stops being unreachable

**Branch:** `lane-a/tn25-walk-band` · **v1.457.5**

The second half of TN-25, and the one the owner would notice. The engine half (#1262) added the
pattern selector; this changes what the pacer actually says.

## The defect

`walk-active.tsx` set the fast target at `hrReserveTarget(0.70, …)` — **133 bpm** for this owner —
and `classifyZone` returned `'push'` for anything under it. Measured: **0 of 44** fast blocks ever
met it, mean **98.5**, best single **115**. So the live cue read *push* on **100%** of fast intervals
across ten sessions. A cue that can only ever say one thing carries no information.

The 0.70 reserve fraction is right for the protocol and wrong for this mode: guided interval walking
is validated largely in older adults, for whom brisk walking does reach 70% of reserve. A 33-year-old
with a 168 max cannot, on flat ground.

## What shipped

`walkFastBandBpm(hrMax)` in `hr-zones.ts` → **[101, 118]** at a 168 max. `ZoneTargets` gained an
optional `fastMax`, and `classifyZone` can now return **`'ease'`** on a fast block — the half a floor
could never say.

**The band is % of MAX HR, not % of reserve, and that was the open design question.** I decided it
rather than deferring, because it is one expression, costs nothing to reverse, and produces the same
numbers today. Three reasons, in the source:

- 60–70% of max is where *"conversational aerobic"* — the words the session's own copy uses —
  actually comes from, so the threshold now matches the model the prescription is written in.
- It stays per-user. Targeting 105–118 literally, as the entry says, is a constant true of one
  33-year-old.
- It decouples the walk from the reserve anchor. That is the coupling TN-30 would otherwise move:
  `0.70 × reserve` goes 133 → 140 on re-anchoring at 178.

**⚠ It returns 101–118 where the entry quotes 105–118** — the standard 0.60 lower edge against the
entry's rounded figure, 4 bpm apart. Named in the source rather than quietly reconciled, with the
one-token change that matches the quote exactly.

**The slow ceiling is untouched** at 0.40 of reserve: it was met on 78% of blocks, so nothing in the
data says it is wrong. Changing what is not broken alongside what is would make the next measurement
unreadable — the mistake TN-25 itself flags about the 2026-09-09 session, which moved three variables
at once.

## What is still owed

**`recommendWalkPattern` still has no caller.** The selector shipped in #1262 and nothing invokes it,
so the pattern is not actually assigned yet — which is the owner's *"I'd like that to be determined
for me"*. The band fixes the **cue**; the selector fixes the **prescription**, and it is inert until
something calls it. TN-25 stays queued for that.

## Verification

- `pnpm test` **925 files / 8796 tests** green. `pnpm check:rules` **75 of 75**. Typecheck and lint
  clean.
- **Mutation pass, 4 mutants, all killed:** ceiling removed, band raised to 0.70–0.85, ceiling applied
  unconditionally (which would break every caller that supplies no `fastMax`), and the push boundary
  moved by one. **Equivalent control** (`bpm < fast` → `!(bpm >= fast)`) stayed green.
- Six new tests, including the control that matters: **a caller with no `fastMax` must behave exactly
  as before**. `fastMax` is optional precisely so this change cannot reach the pacer's other paths,
  and a test holds that rather than the comment claiming it.
- `classifyZone` has exactly two callers (`walk-pacer.ts` and the walk screen), checked before
  changing its contract rather than after.

**Not exercised.** `pnpm dev` returns **307** on `/guided-walk` — the auth redirect — so the screen
compiled but never rendered, and **nothing here was seen behaving on a real walk**. No device, no
APK. The figures (0 of 44, 98.5 mean, 115 best) are TN-25's own measurements and were not re-measured.
The first walk after this deploys is the real test, and it is the owner's.

<a id="2026-09-16-lane-a-tn25-walk-pattern-selector"></a>

# 2026-09-16 — Lane A · TN-25: the walk pattern gets assigned, and the pacer still says push

**Branch:** `lane-a/tn25-walk-pattern-selector` · engine half only · **no version bump** — nothing is
wired to a surface, so nothing user-visible changed.

The owner asked for the guided walk's fast/slow structure to be **varied and assigned** rather than
chosen by them: *"If we need more zone 2 maybe it's more fast? If we have zone 2 done maybe it's just
light interval for steps."* That is a description of `recommendRunType`, which already does exactly
this for runs — so this extends an existing deterministic selector rather than inventing a
prescription engine.

## What shipped

`packages/shared/src/walking/recommend-walk-pattern.ts` — `WALK_PATTERNS` (the owner-approved
four-row table: steady brisk, long intervals, short intervals, easy steps) and
`recommendWalkPattern(quota, opts)`. Deterministic, pure, no LLM — `recommendRunType`'s comment says
why that matters and the same rule holds here.

**Zone 2 alone drives it, and that is the point rather than a simplification.** A walk is the mode
this owner cannot push past Zone 2 in — 0 of 44 fast blocks reached the old Zone-3 target — so
grading it against the higher zones would recommend work the mode cannot deliver. Zones 3+ are what
`recommendRunType` is for.

**It picks a pattern and never an HR band.** That separation is copied from `recommendRunType`, whose
own comment calls its zone map *"not a target"*, kept apart from the one that drives the real band.
Mixing them is how an anchor change would silently move the walk.

## What this does NOT fix, and it is the half the owner would notice

**The pacer still says "push" on every fast interval.** `walk-active.tsx:67-68` still sets fast ≥ 0.70
of reserve — 133 bpm for this owner, against a measured fast-block mean of 98.5 — and `classifyZone`
still returns `'push'` for anything under it. A cue that can only ever say *push* is the reported
defect, and nothing here touches it. The selector is the prescription engine; the band is the fix.

## The band is an open design question and I did not quietly settle it

TN-25 says *"the band, not the fraction: target **105–118 bpm** directly."* Taken literally that is a
hardcoded constant true of a 33-year-old with a 168 max and wrong for anyone else.

**Recommendation, recorded in the entry: derive it from % of HRmax (0.60–0.70), not % of reserve.**
It yields exactly 105–118 for this owner, it is the model the session's own copy is written in
(*"conversational aerobic"*), it stays per-user, and it breaks the coupling the entry actually
names — which is to **reserve**: `0.70 × reserve` is what re-anchoring at 178 would move from 133 to
140. What the literal reading is better at: it cannot move under any anchor change at all. Reversal
cost is one expression either way.

I left it open rather than picking it inside an engine PR, because the choice seeds how every HR
target in the app is expressed, and it belongs with the code that sets the pacer.

## Verification

- `pnpm test` **925 files / 8790 tests** green. `pnpm check:rules` **75 of 75**. Typecheck and lint
  clean.
- **Mutation pass, 5 mutants, all killed** — and one survived the first round, which is the useful
  part. Changing `find(zoneId === 2)` to `find(zoneId >= 2 && open)` passed all ten tests, because
  every fixture had Zone 2 *open*, so both expressions found the same row. **Only a case where Zone 2
  is met or absent while a higher zone is open separates "reads Zone 2" from "reads the first open
  training zone."** The test that claimed to protect exactly this property did not. Rewritten around
  those two cases; the mutant dies now. **Equivalent control** (reordering two `&&` guards) stayed
  green.

**Not exercised:** no device, no APK, no authenticated request. The selector is a pure function with
no caller yet, so nothing ran it in anger — what the tests cover is the arithmetic, not a prescription
anyone has seen. Every production figure quoted (0 of 44, 98.5 bpm) comes from TN-25's own review and
was not re-measured here.

<a id="2026-09-16-lane-a-tn29-maintenance-ceiling"></a>

# 2026-09-16 — Lane A · TN-29: the maintenance estimate gets a ceiling it can be measured against

**Branch:** `lane-a/tn29-maintenance-ceiling` · **v1.457.4**

The app computes two independent maintenance estimates on every request and compared them never. One
comes from intake and scale weight; the other from resting rate plus measured movement. They fail in
unrelated ways, which is what makes the second a usable check on the first — and it was already in
the same function, as the fallback the calibration overrides.

For the owner on 2026-09-09: calibrated **2,245** against a measured-movement **1,895** — activity
factors of **1.67** and **1.41**. 1.67 is "hard exercise 6–7 days a week" for someone averaging 3,572
steps a day.

## The change is the mirror of a gate that already existed

`estimateMaintenance` already took the user's BMR as `minMaintenanceKcal` and **rejected** anything
below it — *a maintenance below resting burn is impossible by definition*. The same argument runs the
other way with better evidence: *a maintenance implying training the user demonstrably did not do is
impossible by measurement.*

So it now takes a `measuredMovementKcal` ceiling and rejects above it, with its own
`above_measured_movement` exclusion and message. **Rejected, never clamped** — the same rule the
floor follows, and for the same reason: clamping reports a number the data never supported, where
rejecting lets `resolveMaintenance` fall back to the formula baseline.

Keeping the reason distinct from `implausible_result` is deliberate and is pinned by a test. 2,245 is
a perfectly fine maintenance for *someone*; it is not one for this person, whose movement the app has
measured. A caller that lumped them together could not word the message honestly.

**One ordering change made it work.** `avgActiveKcal` sat *below* `resolveMaintenance` and was gated
on `source === 'calibrated'` — the very result the ceiling now bounds. It is hoisted above, ungated,
and the post-hoc `avgActiveKcal` reuses it.

## The number this entry deliberately did not settle

`MAX_MEASURED_MOVEMENT_RATIO = 1.15`. TN-29 says outright that the band width *"wants fitting against
more than one owner-month"*, so it is one exported constant with the reasoning beside it.

At the owner's 1,895 it rejects at 2,179 — so it rejects the 2,245 that prompted the entry and allows
about 15% for expenditure the step count cannot see (NEAT, thermogenesis, unlogged activity). **The
ceiling tracks the measurement rather than being a constant**, which is what stops it rejecting a
genuine training block: a real block raises the measured-movement estimate and the ceiling with it. A
test pins that — the same window refused at 1,895 is accepted at 2,400.

## BF-137: the general guard shipped, the specific fix is blocked on one date

TN-29 says to read BF-137 first and build the two together. BF-137's cause is different: the
estimator is fitting a **GLP-1 weight drop** and reading it as metabolic rate. Its recommended fix is
to exclude days after a known intervention start, keyed on `supplement_vials.opened_on`.

**Three findings, in order:**

1. **BF-137's `Needs:` says "nothing" while its body calls BF-136 "a prerequisite in fact if not in
   form".** Same prose-dependency shape as TN-31, fixed earlier today.
2. **BF-136 has shipped** (v1.446.2, 2026-09-10) — `opened_on` is user-settable now, bounded 180 days
   back and correctable in place. So the mechanism is buildable, and per the protocol an absent
   `Needs:` target counts as shipped.
3. **But the owner's data was never corrected.** Measured 2026-09-16: one vial — Retatrutide,
   `opened_on` = **2026-09-10, identical to its `created_at`**, the auto-set date BF-136 was filed
   about. BF-137's own measurement puts the first dose near **2026-09-04**. **An exclusion keyed on
   09-10 would leave the six confounded days inside the window** — the exact span driving 2,245.

So building it now would ship a filter that does not filter. BF-137 gains `Gate: owner` for a **data
correction, not a decision**: set that vial's *Opened on* to the real first dose, one edit, and the
entry is unblocked.

**What did land for BF-137:** TN-29's ceiling catches *this instance* — the 2,245 is refused because
the owner's movement cannot account for it. That is the instance, not the cause, exactly as BF-137
says, and the cause will recur on the next vial.

## Verification

- `pnpm test` **924 files / 8780 tests** green (with `DATABASE_URL` set). `pnpm check:rules`
  **75 of 75**. Typecheck and lint clean (0 errors).
- **Mutation pass, 5 mutants, all killed:** no ceiling, clamp-instead-of-reject, wrong exclusion
  reason, ratio widened to 3.0, ratio tightened to 0.9. **Equivalent control** (`>` → `>=` at the
  boundary, which these fixtures cannot distinguish) stayed green.
- Seven new tests, including two controls: an estimate *inside* the band must come out identical with
  and without the ceiling, and an absent/zero measurement must not reject everything.
- `pnpm dev`: `/api/nutrition/energy-balance` compiles and returns 401 unauthenticated.

**Not exercised.** The authenticated path never ran — the sandbox cannot mint a session — so nothing
here was observed changing a number on a real screen. No device. The production figures quoted
(2,245 / 1,895 / the vial date) are the owner's rows only (`claude_ro` is row-scoped), read through
the admin endpoint. Nothing is stored: maintenance is recomputed per request from a trailing window,
so **no history is re-scored** and the one written artefact — `nutrition_targets.calories` = 1,660 —
is untouched and still inside the honest band.

<a id="2026-09-16-lane-a-tn31-needs-field-and-baton"></a>

# 2026-09-16 — Lane A · a prose dependency at the top of READY, and a baton six PRs stale

**Branch:** `lane-a/tn31-needs-field-and-baton` · docs-only · no version bump

## TN-31 was the top of READY and was never startable

Picking it up, its own text said: *"which run type this maps to depends on TN-30's outcome. **Sequence
TN-30 first**, or the new session type gets built against an anchor that then moves."*

That is a `Needs:` written as a sentence, and `next-item.js` cannot see a sentence. TN-30 is itself
parked on `Needs: TN-25`, so the real chain is **TN-25 → TN-30 → TN-31** — three deep, with the
blocked entry sitting at position 1. It now carries `Needs: TN-30`; READY drops 14 → 13.

The entry also carried **two conflicting `Lane:` declarations** — a `**Lane:** A` field on line 2 and
a `**Lane: B**` bullet four lines later. The tooling reads the first; a human reads the last. Both
are now one declaration that states the split (engine half `packages/shared/src/running/**`, surface
half the components) and keeps Lane A per *"both → Lane A, engine half first"*.

**The general form, which the backlog README half-anticipates:** a queue position is not a work
assignment, and the file does not show which mechanism is holding an entry back. Three mechanisms can
park one, and only two of them are visible to the runner. **Read the entry for a prose dependency
before starting it — and convert it to a field in the same PR rather than just obeying it**, or the
next session pays the same cost.

## The baton was six PRs stale

`docs/agents/state/implementation-lane-a.md` still described the state before this session's six
merges. Rewritten, not appended — a baton that is half last week's is worse than none, because it
gets trusted.

What it gained is not a changelog. It is the three things that would otherwise be re-learned at cost:

- **A column rename is not available in this repo** (LA-114), with the mechanism: Migration Check
  replays every migration against the final schema, and the `claude_ro` view migrations each
  regenerate the full view set, so every one names every column.
- **A migration is not tested until it has been applied twice to the same database**, with the
  throwaway-DB recipe that reproduces CI locally. This session pushed a migration that `pnpm test`
  and `check:rules` both passed, because the local DB already had it applied once.
- **The four-entries table:** four entries this session had true measurements and wrong conclusions,
  each with its reusable form. That table is why the session re-verified before implementing, four
  times, and was right to each time.

Cut to pay for it: the old per-entry "why it is not startable" table, stale on arrival and answered
better by the runner.

## Verification

Docs-only; no code changed. `check:rules` **75 of 75**, `check-backlog-pointers` OK (53 `Needs:`, up
one), `check-doc-index-size` OK. TN-31 confirmed parked by re-running the runner rather than by
reading the diff.

**Not exercised:** nothing was run. The claim that TN-31 was unstartable is read from TN-30's own
`Needs: TN-25`, which the runner prints.

<a id="2026-09-16-lane-a-tn34-unwire-stress-override"></a>

# TN-34 — the stress deload override is unwired, and so is the notification nobody mentioned

**Lane A · branch `lane-a/tn34-unwire-stress-override`.** Owner-approved 2026-09-10 — *"yes lets do
all that."*

## What shipped

`ai-dynamic.ts`'s `stressOverride` was:

```ts
stressHighMinutes != null ? stressHighMinutes >= STRESS_HIGH_DAY_THRESHOLD_MIN : daySummary === 'very_stressful'
```

and is now `daySummary === 'very_stressful'` alone. Temperature and illness still override; the
frozen Cloud arm is untouched.

The derived arm recommended a deload on **83% of the owner's days** (15 of 18 recomputed, 7 of 10 on
stored values since the 2026-08-31 fix), off the number TN-33 measured as carrying no signal — 57%
night buckets, night systematically positive, a **+0.072** correlation with readiness over 18 days
with the two halves pointing opposite ways. A flag that fires four days in five carries no
information.

## The sibling surface was worse, and the entry did not mention it

`lib/health-alerts.ts:59` ran the **same condition on the same input**, and two things make it the
more damaging of the pair:

1. It fires a **push notification** — "High stress day" — so the owner was notified four days in five.
2. A fired stress alert sets `moreSpecificFired`, which **suppresses the readiness-low alert**. The
   signal-less flag was masking the real one.

Found by the sibling-surface rule rather than by the entry, which scopes itself to
`ai-dynamic.ts:219-225`. `stressCurrent` is kept on that path deliberately: TN-33 §8 measures strong
episode structure in the *series* (lag-1 **+0.637**, residual **+0.372** after removing day/night
means). It is the daily aggregate that carries none, not the instantaneous level.

## Verification

Four mutations, all caught; one deliberately-equivalent control, passed:

| mutation | result |
|---|---|
| Re-wire the deload override | caught |
| "Fix" the firing rate by raising the threshold to 600 instead | caught |
| Drop the `very_stressful` arm entirely | caught |
| Re-wire the notification's highMinutes arm | caught |
| *Control:* rewrite `stressTriggered`'s ternary as `&&` | passed |

The second one matters most. The entry warns that raising `STRESS_HIGH_DAY_THRESHOLD_MIN` would be
*"the fifth 'the threshold is right, the input is wrong' in this pillar"*, so the tests assert at
1000 minutes as well as 150 — this is unwired, not re-thresholded.

Full gate green — **Ran 75 of 75**, 923 files / 8,752 tests.

**Five tests pinned the old behaviour and were rewritten to pin the new one**, so a re-wire fails
loudly rather than silently restoring the 83%. One of them is worth describing, because deleting it
would have quietly lost coverage: `next-session-stress-day.test.ts` was a regression test for the
adapter reading `derivedRows[0]` — *yesterday* — so a stale prior-day spike tripped today's prompt.
**That subject is now unreachable through the recommendation**: `todayDerived` still selects today
correctly, but its only consumer is `stressHighMinutes`, which the engine now ignores. So both cases
are inverted rather than removed, a third asserts 1000 minutes, and the header says plainly not to
"restore" the old `today=high → true` assertion — doing so would not be fixing a day-selection, it
would be re-introducing the 83%.

## Failure surfaces NOT exercised — read this before trusting the dev run

`pnpm dev` was run against local Postgres with a real authenticated session and a seeded
`stress_high_minutes = 1000` day. `/api/next-session` returned 200 both before and after the change
— **but that is not a demonstration of the fix**, because the route's response does not expose
`deloadOrRestRecommended`, `deloadStrength` or `temperatureAlert` at all. The code path loads and
runs; the behaviour difference is not observable there. What proves the change is the unit tests and
the mutation pass.

Also not exercised: the notification path end to end (it needs Capacitor), Samsung WebView, and the
owner's real drifted data — every figure above is from TN-33/TN-34's production measurements, which
are **row-scoped to the owner** and so are his days, not a system-wide rate.

## What is NOT done

The **re-wire**. Options 2 and 3 in the entry both wait on TN-33's level-2 test; when the series is
validated, the threshold should be re-anchored to this user's own distribution — a percentile, not
the 120-minute constant. TN-34 stays queued with a `Keep:` for exactly that.

<a id="2026-09-16-lane-a-tn37-connector-guide"></a>

# 2026-09-16 — Lane A · TN-37: the connector guide now describes the code, and step 2 was wrong

**Branch:** `lane-a/tn37-connector-guide-invariant` · docs-only · no version bump

TN-37 said §5.4 of the connector guide states an invariant the pillars do not hold, and gave three
steps. **Step 1 shipped. Step 2 turned out to be a regression waiting to happen**, and the entry's own
instruction is what caught it.

## Step 1 — §5.4 says what is true now

It claimed *"Every calculation in §4 reads generic tables, never a device-specific one."* The
**formulas** hold that; the **assembly that feeds them** does not. `readiness-payload.ts` reads seven
stores in one `Promise.all` and four are device-specific, supplying about twenty payload fields for
which a non-Oura source is structurally invisible.

§5.4 now carries the read list and what each store contributes. §5.5 is corrected too: it called
PS-41 *"the concrete, fixable instance"* — singular — of the general rule. It is **a** concrete
instance, and now says so.

## Step 2 — corrected, and this is the part worth reading

The entry said: *"Drop the two dead Cloud reads — `getOuraDaily` and `getLatestOuraCloudVitals`
return nothing usable."* It also carried a ⚠ to **re-verify the NULL-on-recent-rows finding at the
time of the change rather than trusting the snapshot**. Doing exactly that is what caught it.

**`getOuraDaily` is not dead.** The snapshot was right about what it measured — every *Cloud-scored*
column is NULL, 35 of 35 rows since 2026-08-14: readiness, sleep, activity, temperature deviation,
VO₂ max, vascular age, stress/recovery high, day summary, bedtime. But **`non_wear_time_sec` is
populated on 35 of 35**, written by the BLE rollup's wear step — and `readiness-payload.ts:329,341`
feeds it to `excludeLowWearDays` for the **HRV and RHR baselines**. Dropping the read would have
silently disabled wear filtering on two baselines: a scoring change, and one that nothing in the
test suite would have caught.

**`getLatestOuraCloudVitals` is a deliberate stale surface**, not a dead read — it supplies `vo2Max`,
`vascularAge` and `cloudVitalsDate`, which the UI renders *"as of `cloudVitalsDate`"*. Dropping it
removes those fields outright.

So step 2 is now a ⛔ in the entry rather than a task, with the measurement attached.

**The generalisable mistake:** *"every scored column is NULL"* is not *"the table is dead"*. The
original audit read the columns it cared about and concluded the table was a shell; it has a live
writer for a column the audit wasn't looking at. **Check for a live writer before calling a read
dead.**

## Step 3 unchanged

Deciding what the derived layer *is* — app-computed and source-neutral, or genuinely Oura-only —
still needs its own plan, as the entry and `2026-08-02-de-oura-naming.md` both say. Not started.

## Verification

Docs-only: no code changed, so `pnpm test` and the gates are unchanged from the merge base.
`check:rules` **75 of 75**, `check-backlog-pointers` OK.

Every production figure is the owner's rows only (`claude_ro` is row-scoped) and comes from the admin
read endpoint. **Not exercised:** nothing was run — no device, no rollup, no authenticated request.
The claim that `excludeLowWearDays` would lose its input is read from the call sites, not observed by
removing the read.

<a id="2026-09-16-lane-a-tn39-stress-validation"></a>

# 2026-09-16 — Lane A · TN-39: the daytime-stress imputation, checked against measured HRV

**Branch:** `lane-a/tn39-daytime-stress-validation` · **Measurement only — no code changed.**

TN-39 asked for the validation TN-33 and TN-34 both had to assume. The daytime-stress signal is an
imputation (`ln(rmssd) = a + b·hr + c·temp`, fit on night data, applied to daytime), and the Polar
H10 has been writing real beat intervals to `rr_intervals` the whole time. Nobody had compared them.

Full measurement:
[`docs/reviews/2026-09-16-daytime-stress-imputation-vs-measured-hrv.md`](../reviews/2026-09-16-daytime-stress-imputation-vs-measured-hrv.md).

## The answer has three parts of very different strength, and the strongest is not about accuracy

**1. 41% of "daytime stress" is recorded while the owner is asleep.** Joined against
`sleep_sessions` directly: **277 of 672** stress buckets sit inside a recorded sleep session, and
**28 of the 140** buckets counted as high-stress. One minute in five of the `stress_high_minutes` the
app calls daytime stress happened while the owner was asleep. The series window is the whole local
calendar day and nothing restricts it to waking hours. Filed **LA-112** — a defect, not a
calibration question.

The same measurement shows the mirror problem: **11 buckets across 24 days** land in Brisbane
07:00–08:59, the owner's most active waking window, where the strap recorded **98**. That is the MET
gate doing its job — the model should not impute HRV from an activity heart rate — but the
consequence is a "daytime" series that is densest asleep and nearly empty while moving.

**2. The model's shape is validated.** `corr(HR, ln rmssd) = −0.78` on measured data across 30–37
days. The functional form is right and should not be re-investigated.

**3. A ~3.2× level gap that is real but confounded — and must not be acted on.** The model reads
×0.30 of measured RMSSD over 84 buckets / 37 days, with a spread far smaller than the bias. The
assumed temperature cannot explain it (inverting per bucket for the temperature that would make it
exact gives 67–87 °C). But the strap is chest ECG against a model fit on ring PPG, the measured
daytime values sit **above** the owner's ring night baseline, which is backwards for daytime resting
HRV, and the strap is worn while walking. Filed **LA-113**, owner-gated; the first action is a
controlled same-instrument capture, not a coefficient.

**4. `oura_daytime_stress_buckets.bucket_start` holds the bucket MIDPOINT**, so stored timestamps sit
on a `:15`/`:45` grid. This already cost something during this work: the obvious join returned zero
rows, which reads as "no overlapping data" rather than "the join is 15 minutes out". Filed
**LA-114**.

## Why the entry could be removed rather than kept

TN-39's pass test was *"a written agreement figure between imputed and measured daytime HRV over at
least ten days, with the disagreement characterised (bias, spread) rather than summarised as good or
bad"* — met at 37 days, with bias and spread separated and each confound named. Its two ⚠ constraints
were honoured: no model change, and no day-total comparison (bucket-to-bucket only, since the strap
covers ~6 waking hours).

## Method notes worth reusing

- **`rmssdFromRr` was used, not reimplemented** — including for the SQL-side temptation to compute
  successive differences with `lag()`, which would have been a second implementation of a formula the
  repo keeps in one place.
- **`oura_raw_samples.decoded` is now null on every tag** (Lever 1a), and decoding `body_hex` needs
  vendored constants absent from the sandbox. So the imputed side could not be rebuilt from the
  production path; it was evaluated arithmetically from the stored coefficients instead, with
  temperature swept rather than assumed at one value.
- **The admin db-query endpoint returned intermittent 401s** under a burst of ~48 sequential queries.
  Retrying with backoff cleared every one — worth building into any future pull rather than reading a
  401 as a permissions problem.

## Verification

`pnpm check:rules` **75 of 75**, typecheck and lint clean, `pnpm test` green. No application code
changed, so there is nothing here for CI to regress — the risk in this PR is that a number is wrong,
not that a behaviour is.

**Not exercised:** no device, no APK, no rollup run. Every production figure is the owner's rows only
(`claude_ro` is row-scoped), so none of it describes any other user. Temperature is assumed
throughout. The model was evaluated from its stored coefficients rather than by running the rollup,
so nothing here tests the rollup's own assembly of HR/temp/MET.

<a id="2026-09-16-lane-a-tn44-hc-timezone"></a>

# 2026-09-16 — Lane A · TN-44: the Health Connect timezone bug, and the wall behind the entry

**Branch:** `lane-a/tn44-hc-timezone-and-converter` · **v1.457.3**

TN-44 asked for ten Health Connect record types to be added to `HC_SYNC_READ_TYPES`. Reading the
pinned plugin's source first — as CLAUDE.md's external-API rule demands — turned that into a
different, larger finding, and the list edit turned out to be the one thing that would not have
worked.

Full read: [`docs/reviews/2026-09-16-health-connect-record-converter-gap.md`](../reviews/2026-09-16-health-connect-record-converter-gap.md).

## What shipped

**The overnight windows bucket in the user's timezone now.** `d.getHours()` at `:347`/`:369` read the
**device's** clock, and `toLocalDate` resolved `Intl.DateTimeFormat().resolvedOptions().timeZone` —
the class CLAUDE.md bans, invisible until the phone leaves the zone the data was recorded in. On a
phone set to New York a Brisbane night's HRV lands on the previous day, silently.

`toLocalDate` was also a **second implementation of `toAestDay`**, which has taken a `tz` since it was
written. It delegates now rather than keeping a copy.

The stale `hrvMs` *"SDNN"* comment is corrected — the code reads `HeartRateVariabilityRmssd`, and the
code is right. Worth fixing because this repo has shipped that exact mix-up once.

## What the source read found instead

**The pinned plugin cannot convert most of what TN-44 asks for.** `RecordConverter` has exactly seven
`is XRecord ->` branches and falls back to `else -> record.toString()`. The read path is generic — it
resolves through the SDK's own `RECORDS_TYPE_NAME_MAP` — so **conversion is the wall, not
permission**. Adding a type to the list without a converter branch returns a Kotlin string blob whose
every field reads `undefined`.

**And three types we already ask for are in that hole today:** `HeartRateVariabilityRmssd`,
`OxygenSaturation` and `HeartRateSeries`. Each sits in a `catch { /* ignore */ }` feeding a date
filter that drops everything — `new Date(undefined)` → Invalid Date → `NaN` hour → the window test is
false. No error, no log, no value. Filed as **LA-115** (device-gated: it is Kotlin in the local
patch, so it needs an APK).

**The greppable tell:** every broken call carries `as any` on its `type`. That cast is what let a type
past the plugin's `RecordType` union — and `BodyFat`/`Nutrition` carry it too and are *fine*, because
the repo's own patch added those to **both** the union and the Kotlin. The patch added
`HeartRateVariabilitySdnn` and `OxygenSaturation` to the union **only**. So `as any` marks exactly
where the type list outran the converter.

## The production check, and why it is corroboration rather than proof

The owner's `body_metrics` rows that Health Connect touched (n = 17) credit it with steps 15 and
weight 11, and **HRV 0, SpO₂ 0** — as predicted. **But resting heart rate also reads 0, and its
converter branch exists.** `source_map` records only the *winning* source under the ranked merge and
the ring outranks Health Connect for those fields, so a zero is equally consistent with "HC produced
a value and lost". The confound is sitting in the same table as the result, which is what stops the
zeros being quoted as proof.

## Lane discipline

The timezone now threads through the Lane A library with a `DEFAULT_TZ` default. **The caller is Lane
B** — `components/health-connect-provider.tsx` has the session and should pass
`session.user.timezone` — so that half is filed as **LB-113** rather than reached across the lane
boundary. Until it lands the default is correct for the owner, which is the repo's documented
default-parameter pattern, and LB-113 names the risk that a default nobody overrides is a silent one.

## Verification

- `pnpm test` **924 files / 8773 tests** green (with `DATABASE_URL` set). `pnpm check:rules`
  **75 of 75** — it caught a `Gate:` field written inline on the re-scoped TN-44, which would have
  been silently ignored and left the entry READY. Typecheck and lint clean.
- **Mutation pass, 3 mutants, all killed:** hour back to `getHours()`, date back to the device zone,
  and a 12-hour format token. **Equivalent control** (`'H'` → `'HH'`, which `Number()` parses
  identically) stayed green.
- The new tests use **fixed-offset zones** (`Etc/GMT-10`, `Etc/GMT+5`) and an explicit instant, so
  they fire on every CI run rather than only inside the window where the bug shows — the shape
  CLAUDE.md's date-arithmetic rule asks for.

**Not exercised.** No device, no APK, no Android, no Health Connect permission grant. The sync module
only runs under Capacitor (`Capacitor.isNativePlatform()` gates both entry points), so **nothing in
this file was executed** — the tests cover the two extracted pure helpers and nothing else. Every
claim about the plugin is a source read of the pinned version; every production figure is the owner's
rows only (`claude_ro` is row-scoped). Nothing was observed working or failing on hardware.

## The lesson

TN-44's claims about the *platform* were all true. Its conclusion — that this is a list edit — was
wrong, and only reading the pinned plugin's source showed it. That is the third entry this session
whose source claims held and whose conclusion did not, and the second time the answer came from
reading the dependency rather than the docs.

<a id="2026-09-16-reprioritise-the-readiness-ceiling"></a>

# 2026-09-16 — three entries to the top, on the owner's instruction

**Tuning.** Docs-only, and a **pure reorder** — `sort`ing the file before and after produces
byte-identical output, so no entry was rewritten, merged or dropped.

## Why

Yesterday's audit established that the owner cannot score 100 on any pillar and that readiness has
never reached 90 in 62 days, with the cause named: `temperature` is scored closer-better against a
baseline that is miscentred, so it cannot reach its own optimum (TN-42). The fixes for that were
already in the queue — **at positions 180 and 190 of 341.** Lane A works the queue top-down from
`next-item.js`, so at that depth they would not be reached.

**Diagnosis without priority changes nothing.** The owner set the priority; this records it.

| new | was | entry |
|---:|---:|---|
| 1 | 37 | **TN-34** — the stress-deload override, one line, September deloads 11 of 15 → 1 of 15 |
| 2 | 190 | **BF-13** — the baseline EMA seeds at zero |
| 3 | 180 | **TN-6** — the temperature baseline, 0.36 °C low |

**BF-13 above TN-6 deliberately** — TN-6's own entry names BF-13 as the line underneath it, so
fixing the symptom first means doing the work twice. The EMA seed is also shared by all six
baselines, which is why it outranks the single contributor it was found through.

TN-39 (position 7) and TN-42 (position 10) were left alone: already high enough to be reached, and
TN-39 is a measurement rather than a fix.

## Also

**PR #1098 (RV-42, Lane A's meal-plan ownership fix) has the owner's confirmation** as of today,
after five days waiting on the security carve-out. The merge was attempted and refused with merge
conflicts against head `bbfb9a5c`, despite all six checks green on that head. **The conflict was
deliberately not resolved here** — it is Lane A's branch, pushed to at 09:16 the same morning, and
resolving another agent's in-flight security work is the shape that has previously restored deleted
backlog entries and corrupted changelog entries in this repository. The approval is recorded as a
comment on the PR so Lane A can resolve and self-merge.

## Not exercised

Docs-only; no code changed, nothing run on device, and **no scoring change shipped** — the three
entries moved are Lane A's to build and the owner's to sign off. The reorder itself was verified as
content-preserving by sorted-file comparison rather than by reading the diff.

<a id="2026-09-16-the-reorder-did-not-work"></a>

# 2026-09-16 — the reorder did not work, and three of the reasons were mine

**Tuning.** Docs-only. Yesterday's reorder (#1246) put TN-34, BF-13 and TN-6 at the top of the
backlog file on the owner's instruction. **Checking `next-item.js` afterwards showed all three still
invisible to Lane A** — the tool that implementers actually start from. File position was never the
only thing standing in the way.

**Recording this because the reorder was reported as done, and it was not.** Verifying with the tool
rather than the file is what caught it.

## Three separate causes

**1. A ⛔ anywhere in an entry parks it.** `next-item.js:97` flags any line containing `⛔` as an
*unmigrated blocked marker*. In TN-6, BF-13, TN-34, TN-36 and TN-37 the ⛔ was implementer guidance —
*"do not touch the 0.3/0.5/1.0 ladder"*, *"not a redesign"* — never a statement that the entry could
not start. **33 entries queue-wide are parked for this reason alone.** Converted to ⚠ in the five
that matter here; the sweep is Orchestrator's.

**2. TN-34 carried a `Needs:` its own sentence disclaimed.** The line read *"**Needs: TN-33** — only
for the later question of what replaces it; **the unwiring does not wait**"*. The field blocks, the
prose says it does not, and the tool believes the field. Restated as `Related:` with the history
attached.

**3. ⚠ `Reference:` does not mean "here is the supporting doc" — it means "this entry is a map,
never build it".** `scripts/lib/reference.js` is explicit: *"An entry that exists to be READ by other
entries, not implemented."* **Nine Tuning entries used it to link their review doc**, which filed
them under a heading that says *Never "next"*: TN-22, TN-25, TN-29, TN-31, TN-34, TN-36, TN-37,
TN-39, TN-44. Converted to `Review:`, which is prose and claims no field. TN-21 keeps its
`Reference:` — there the field describes the entry's actual role.

**The third one is mine, and it is the worst of the three**, because an entry in REFERENCE looks
filed rather than lost. Every entry this agent wrote yesterday carried it. TN-39 and TN-44 were
reported to the owner as ready work and were not.

## Result

| | before | after |
|---|---:|---:|
| READY (lane A) | 11 | **19** |
| REFERENCE | 18 | 10 |

Lane A's list now opens: **1. TN-34 · 2. batch `temperature-baseline` (BF-13 + TN-6) · 3. TN-39 ·
4. TN-44** — which is the order the owner set.

## The rule worth carrying

**A queue position is not a work assignment. Check `next-item.js`, not the file.** Three independent
mechanisms can hold an entry back and none of them is visible when reading the backlog top to bottom.

## Not exercised

Docs-only; no code changed, nothing run on device, no scoring change shipped. The ⛔ → ⚠ conversion
changes only which section an entry prints under — the guidance text is byte-identical and every
warning it carried it still carries. **The 33-entry ⛔ sweep and any audit of whether other agents'
entries misuse `Reference:` are NOT done here**; only the nine Tuning entries and the five in the
owner's priority path were touched.

<a id="2026-09-17-bf-173-post-ship-measurement"></a>

# 2026-09-17 — re-measuring BF-173 after it shipped: the defect is gone, the answer is not

**BugFix intake.** Docs-only. BF-171, BF-172 and BF-173 all shipped overnight (#1267, #1273, #1268,
#1274) while this session's container was down. This is the post-ship look the entries were owed.

## What was verified

The provenance option the owner chose was built as specified — `mood_logs.suggested_sore_muscles`
(migration 276, `claude_ro` twin 277, local SQLite v39), only lifter-added ticks clamp, provenance
recorded at write time, and LB-116 (#1274) wires the check-in sheet to send its own suggestion list
rather than leaving the server to re-derive it. The column exists in production.

## The correction

`projectOverview.md` carried *"it flipped the pick, Lower 74/Upper 84 as shipped against Lower 85/
Upper 84 without the leg ticks"*. Both numbers are right and both are **pre-BF-171**, measured on a
replication of the old engine. Run against the shipped engine on the same rows, with every tick
recorded as a suggestion:

| | Upper | Lower | Pull | Legs | Push |
|---|---|---|---|---|---|
| double count live (provenance unknown) | **85** | 76 | 84 | 62 | 47 |
| all ticks suggested (the fixed path) | **91** | 88 | 85 | 76 | 59 |

**Lower gains 12 points from the fix and still loses by 3.** BF-171's normalisation lifts the
sore-but-recovering muscles on both sides, so removing the double count raises every session rather
than reordering them. The entry fixed the defect it described; it did not change this particular
answer. Upper wins on merit now — half back work at 95%, six days overdue.

The overview paragraph is amended rather than struck: the counterfactual is still the clearest
statement of what the double count was doing, it just needed marking as a counterfactual.

## Two things the owner should know, neither a defect

- **Today's row scores the old way.** `suggested_sore_muscles` is `NULL` on the 2026-09-17 check-in,
  which predates the column, and the implementation treats NULL as *unknown* rather than *none* —
  deliberately, so a pre-migration row is not reinterpreted. The fix takes effect on the next
  check-in, not retroactively.
- **That row was edited at 21:37, 27 minutes after it was written**, dropping Quads, Hamstrings and
  Glutes from a seven-muscle list to four. Recorded as an observation only; nothing in the row says
  who changed it or why.

## What was not exercised

Nothing on the S25. The measurement is the shared scorer run against production rows in a harness —
it proves the engine's arithmetic, not what the phone renders. Whether the next real check-in
actually populates `suggested_sore_muscles` cannot be confirmed until one is written.

<a id="2026-09-17-bf-175-assign-step-budget"></a>

# 2026-09-17 — two calorie goals on one screen, and the rule against it was already written down

**BugFix intake.** Docs-only. Owner, with two screenshots timestamped the same minute: *"2 different
calorie goals here"*. Filed as **BF-175**.

## What he saw

| surface | shows | source |
|---|---|---|
| Nutrition card | `1,355 OF 1,506` · *"1,291 resting rate + 215 earned from movement"* | `budgetProvenance(balance).total` |
| Assign-to-Meal sheet | `Today after logging 1361 / 1660` | `nutrition_targets.calories`, raw |

`nutrition_targets.calories` reads **1660** in production. The intake halves agree — 1355 plus the
6 kcal item is 1361 — so only the denominator diverges, by 154 kcal.

## Why it matters more than a cosmetic mismatch

`assign-step.tsx:159-163` colours its bar green under target and orange over, against 1660. So the
sheet paints a full green bar and implies headroom while the card two taps away says **151 kcal
left**. The wrong number is the one attached to the decision he is making at that moment — whether
to log the food.

## The part worth recording

**This is a missed surface of a bug that was already found, measured and fixed**, not a new one.
`nutrition-content.tsx:423-441` carries both the fix and the evidence: three budgets once appeared
on one screen (zone bar 2,180, Home 2,451, ring 2,001), and the comment states the rule outright —
*"`nutrition_targets.calories` is the rest-day floor, not `restingBase + targetNet`"*.
`home-nutrition-card.tsx:34` repeats it. Two comments state the rule; the sheet that logs food into
that page never got the sweep.

The repo's own sibling-surface rule is the one that would have caught it: *"when fixing a pattern on
one surface, grep for every other surface handling the same domain and update them in the same PR"*.

## Checked and cleared

`WeeklyNutritionChart` also takes `targets?.calories`, and that is correct — a seven-day reference
line has no single day's earned movement to add, which is the same reason `effectiveCalorieGoal`
falls back to the stored goal rather than composing an addend. Written into the entry so it is not
"fixed" into a fourth number.

## What was not exercised

Nothing on the S25. The numbers were traced in source and confirmed against production rows; the
bar-colour flip at the S25 width is still owed a device look, and the entry says so.

<a id="2026-09-17-bf-176-streak-window"></a>

# 2026-09-17 — the streak went down on a day he trained, and the reason is a sliding window

**BugFix intake.** Docs-only. Owner: *"My streak went from 90 -> 89? Can we check to see what it
should be and why it went down"*. Filed as **BF-176**.

## What it should be

**102 days**, starting 2026-06-08, unbroken under the app's own rule (two rest days allowed, the
third breaks). The card said 89.

## Why it went down

Two halves disagree about how far back to look:

- `app/api/streak-data/route.ts:5` — `const WINDOW_DAYS = 90`
- `session-select-content.tsx:1019` — `for (let ago = 1; ago < 365; ago++)`

The client walks back a year; the route sends 90 days. Past day 90 every lookup returns `undefined`,
which the loop reads as a rest day, so three of them break the count. Once the real streak exceeds
the window the number stops describing his training and starts describing **where the window edge
lands** — and that edge moves forward every day.

Replicating the loop against production rows:

| Brisbane day | shown | trained |
|---|---|---|
| 2026-09-16 | 90 | yes |
| **2026-09-17** | **89** | **yes** |
| 2026-09-18 | 89 | not yet |

He trained on the day it dropped. The edge slid from 2026-06-20 (a rest day) onto 2026-06-21, and
the day that fell out of the payload was a trained one. It will keep oscillating between ~88 and 90.

## Recommended fix

Return the streak computed server-side, with no horizon, beside `trainedDays`. The window then
bounds only the dots, which is what it was for. Raising `WINDOW_DAYS` to 365 also works today and is
one constant, but it leaves the mismatch implicit and re-appears at a year.

## Two things written into the entry so they are not tripped over

- **`allTimeStreak` on the friends leaderboard is the same defect wearing a louder name** —
  `leaderboard/route.ts:136` computes it over its own `STREAK_WINDOW_DAYS = 90`.
- **There are two streak implementations and they are NOT interchangeable.** `computeStreak`
  (`achievements.ts:32`) counts training days with a `maxRestGap`; the home loop counts calendar
  days spanned, rest days included. Reaching for the shared helper while moving this server-side
  would silently change what 102 means.

## What was not exercised

Nothing on the S25. The streak was recomputed from production rows in a harness that replicates the
client loop line for line — it proves the arithmetic and the transition date, not the rendering. The
payload is also cached (`streak-data`, `TTL_LONG`) and stamped optimistically on workout completion,
so a device check needs the cache cleared or a stale seed will mask it.

<a id="2026-09-17-bf100-spec-coarse-restore-assert"></a>

# 2026-09-17 — BF-100's spec can now tell cancelled from imprecise (`fix/bf100-spec-coarse-restore-assert`)

**Lane B · test-only · no version bump — nothing user-visible changed**

## What this fixes

`e2e/scroll-restoration.spec.ts` asserted `toBe(before)` — an **exact** scroll offset — in both of
its restoration cases. BF-100's entry had recorded this as a second finding and left it: *"an
exact-offset assertion cannot tell cancelled from imprecise, which is precisely the distinction
BF-100 turns on."*

Reproduced before touching it, on clean `main`: **saved 718, restored 1019**, red — while
restoration was working correctly. These screens seed from cache and then revalidate, so the content
keeps growing between the save and the restore, and the offset that was right when saved is not the
offset showing the same content a second later.

## The change

Both cases now call `expectRestoredNear`, which asserts a **floor** at 90% of the saved offset.

**The lower bound is what carries the meaning.** A cancelled restore leaves the container at 0 — a
fresh arrival starts at the top by construction, which the file's third test pins — so 0 against a
saved 718 still fails loudly. What it no longer does is fail because the page grew.

**No upper bound, deliberately.** Capping re-introduces the same flake from the other side, and
overshooting because content grew above the anchor is not a defect this file is about.

## Proven both ways

- **Content growth:** 5 passed, where the same run was 1 failed / 4 passed before the change.
- **Cancellation:** with the restore neutered (`el.scrollTop = 0` in `use-scroll-restoration.ts`),
  both cases fail naming it — *"/more: restored to 0 against a saved 879 — at or near 0 means the
  restore was CANCELLED"*. The hook was restored immediately; `git diff` on it is empty.

Without that second run this would be an assertion loosened until it stopped complaining, which is
the shape this repo forbids.

## Why it was worth doing while BF-100 itself is device-blocked

BF-100's open question is whether the S25 *cancels* the restore. The file that would answer it could
not distinguish a cancelled restore from an imprecise one, so a red run said nothing useful and a
green one said only that the numbers happened to match. It can answer now, which is what the device
pass needs.

## Not done

- **BF-100 itself is untouched and stays in the queue.** Its core is a device-only failure: the
  harness restores 840 correctly and the S25 does not. Nothing here changes that.
- **No version bump or changelog entry** — test-only, nothing user-visible.

<a id="2026-09-17-bf165-root-cause"></a>

# 2026-09-17 — BF-165: the sheet's close pops the navigation (`fix/bf165-sheet-close-eats-push`)

**Lane B · docs-only · no version bump — nothing user-visible shipped**

## What this session established

BF-165 was *"device-gated, cause unknown, three candidates open"* after its own 2026-09-15
retraction. It now has a measured root cause, and the retraction's two surviving claims both held up.

**The push never fails. It is undone.** Instrumented on `/cardio` with `history` patched from the
page:

```
+6301ms startViewTransition          ← the tap: push('/activity') begins
+6729ms history.back()               ← closeSurface, undoing the sheet's own entry
+6745ms replaceState(/cardio)
+6745ms popstate -> /cardio
```

`closeSurface` (`lib/hooks/sheet-back-stack.ts:50`) pops the entry the sheet pushed. In
`selectType` that close sits immediately before `router.push('/activity')`, so the pop lands on the
navigation instead of on the sheet. That is **candidate 3**, whose earlier "refuted" verdict rested
on a deferred-close experiment run against a cold route — which is exactly why the retraction
downgraded it to UNPROVEN rather than striking it.

It matches the owner's narrowing exactly: *"it just scrolls to the top of cardio hub."* The sheet
closes, the transition completes, the navigation is reversed, `/cardio` re-renders — and its nested
`overflow-y-auto` scroller is covered by no scroll restoration, so it lands at the top.

## The harness trap that caused three wrong answers, including nearly a fourth here

Reproducing this needs **two** conditions. Warming the destination is the known one. The new one:

**`tapCentre` does not scroll, and `page.touchscreen.tap()` has no actionability check.** At 412×915
the three modality controls sit at **y=852, 924 and 997** — so *Run* is on screen and *Guided walk*
and *Other activity* are below the fold, and their taps hit nothing. `elementFromPoint` returns
`null` for both.

That manufactures a flawless false differential — "Run works, both `/activity` ones do not" — which
reads as a routing defect and is a coordinate one. **It is what produced the struck claim that
"both failures share the `/activity` prefix", and I reproduced that same wrong conclusion here
before checking the hit-testing.** With taps proven to land, *Guided walk* navigates fine, which
confirms the retraction: not a second dead button, and no sheet is involved in it.

`tapInView` does not cover this — it filters on **x** only.

## The fix that was built, and does not work

The natural reading is *"a self-pop is in flight, so wait for it to drain"*, and the module already
tracks that (`pendingSelfPops`, module-level since BF-34). I built it — an `afterSelfPops(navigate)`
parking the push until `handlePop` drains — with four unit tests, two of which went red against the
pre-fix behaviour. **It does not fix the bug**, because its premise is false:

```
+3973 startViewTransition
+4388 history.back()          ← 415 ms later
```

`pendingSelfPops` is **0** when the navigation is issued, so the parked callback runs inline and is
eaten by a pop that has not happened yet. The close is late because `closeSurface` runs in the
`useSheetBackDismiss` effect **cleanup**, which needs a React commit — and `startViewTransition`
suspends frame production and holds that commit. **The navigation is what delays the close past
itself**, so no reordering of the three statements in `selectType` helps either.

All of it was reverted. The measurement is in the entry so the next session does not rebuild it.

## Deliberately not done

- **No fix.** A correct one has to stop the sheet's entry being popped once a navigation supersedes
  it, tied to the **surface's identity** — a bare module-level flag is the known-bad pattern that
  BF-34 is about. The surface handle lives in the hook, not the call site, so the mechanism likely
  belongs on `useSheetBackDismiss`/`SheetContent`.
- **No reproduction spec shipped.** It would assert a behaviour the app does not have, and skipping
  it to keep CI green is the shape this repo forbids. Its recipe is in the entry; it ships with the
  fix, keeping *Guided walk* as the discriminator.
- **Scope correction recorded:** the defect is any navigation issued from inside a closing sheet, not
  anything `/activity`-prefixed. The sibling sweep finds one other call site with the same shape,
  `components/cardio/time-picker-sheet.tsx:46-48`.
- **Device check still owed** — measured in the harness at one viewport; the report was on the APK.
