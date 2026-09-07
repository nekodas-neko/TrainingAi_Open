# 2026-09-07 — the planner charged a rest nobody takes (BF-128)

**Branch:** `fix/planner-trailing-rest` · **Lane A**

## What the owner saw

*"also its given 4 excercises for a 60min session is this right?"* — on a generated powerbuilding
program. It was not right, and the app's own history said so: over 90 days the owner completed **65
sessions with a median of 5 exercises** (mean 4.75, max 5) in a median 55.3 minutes.

## What was wrong

`styleWorkSec` charged `restSec` for **every** set including the last. The walk to the next station
is charged separately as `transitionSecForEquipment`, so the gap after the final set was counted
twice. On a 60-minute powerbuilding session that made the blended per-exercise estimate 694 s and
`floor(3060 / 694)` = **4**.

## The measurement, because the entry asked for one

The claim that the final rest is not taken is now measured rather than argued. Over the same window,
309 exercises and 826 sets:

| | sets | NULL rest | zero rest | mean rest | median |
|---|---|---|---|---|---|
| non-final sets | 517 | 0 | 0 | 126.4 s | 124 s |
| **final sets** | 309 | 148 | 141 | **1.7 s** | **0** |

**289 of 309 final sets — 93.5% — record no rest at all**, against zero of 517 non-final sets. The
split is about as clean as production data gets.

Validated against the 36 sessions that stamp `warmup_ended_at` (so the working window is real rather
than anchored to `started_at`): the median error moves from **+5.1 min over** (29/36 over-estimates)
to **−3.6 min** (14/36). Smaller in magnitude and much less biased.

## What shipped

- `styleWorkSec` no longer charges the trailing rest. All three consumers — the budget blend in
  `generate-program` and `builder-chat`, and the per-style minutes shown in the prompt — are
  planning-time and none wants it.
- The comment on `estimateExerciseDurationSec` is corrected. It read *"Rest is charged for EVERY
  set, not `sets - 1`"* on the strength of one session's arithmetic — but that arithmetic summed
  **recorded** rests, where the trailing rest is already 0, so it reads the same either way and never
  established the point it claimed. That function is **deliberately unchanged**; see below.

Before → after, exercises prescribed:

| goal | 45 min | 60 min | 75 min | 90 min |
|---|---|---|---|---|
| hypertrophy | 3 → 4 | **4 → 5** | 6 → 6 | 7 → 8 |
| strength+hypertrophy | 3 → 4 | 5 → 5 | 6 → 7 | 7 → 8 |
| powerbuilding | 3 → 3 | **4 → 5** | 5 → 6 | 6 → 7 |
| strength | 3 → 3 | **3 → 4** | 4 → 5 | 5 → 6 |

At most +1 per cell — the entry warned that "a planner that suddenly fits more work everywhere is a
worse failure", and this is bounded.

> **AMENDED 2026-09-07 (LA-65).** The section below explains the deferral by saying the transition
> term "came back contradictory". It did not: the +20.8 min figure was a double-count in my own
> measurement — `prep_time_sec` is a sub-interval of `inter_exercise_rest_sec`, not additive to it
> (median 0.05 s error for `inter` alone against the independent set-timestamp clock, +136 s when
> prep is added). The deferral still stands, on a better reason: the transition is charged per
> exercise while a session has one fewer gap than exercises, so 5 × 240 s and 4 × 300 s both come to
> 1200 s and the errors cancel at exactly the owner's five. See
> [the LA-65 entry](2026-09-07-transition-clock-semantics.md).

## What was deliberately not done

`estimateExerciseDurationSec` almost certainly wants the same fix — its `measuredRestSec` comes from
a `time-audit.ts` median that filters `> 0`, so it excludes exactly the trailing zeros and then
multiplies by `sets`. It was left alone because its validation **flips sign** depending on the
transition term, which came back contradictory: `TRANSITION_SEC_BARBELL = 240 s` reads as 249 s
counting unstamped rows as zero, 316 s where actually recorded, and feeding the recorded value in
makes the model over-predict the working window by a median +20.8 min (36/36 over). So the recorded
transition is not purely additive, and the constant cannot be retuned until that is understood.
Filed as **LA-65** with the numbers and a starting method (compare the field against the gap implied
by neighbouring `set_end_ms`/`set_start_ms`, an independent clock).

The entry also said `time-audit.ts` and `signals.ts:508` consume `styleWorkSec`. They do not —
they use `transitionSecForEquipment` and `workingBudgetMin`. Only the two API routes and one display
helper call it, which is what made the fix safe to make inside the function.

## Verification

- **Unit + mutation.** Four tests pin the behaviour; restoring the defect fails all four including
  the owner-facing count assertion. A second mutation — dropping the *first* rest instead of the
  last — is caught only by the unequal-rests test, which is why that test exists.
- **Full suite:** 6643 passed | 86 skipped. `tsc` clean, test-typecheck none above baseline,
  Custom Rules **68 of 68**.
- **`pnpm dev`, both changed routes, authenticated against the local DB.** `POST
  /api/generate-program` (60-min powerbuilding) returned **5 exercises in every one of the four
  sessions**; `POST /api/builder-chat` returned 200 on a swap against that program.

**Not exercised:** anything on-device. This is server-side planning arithmetic reached through the
WebView with no native path, so a Railway deploy delivers it — but the generated-program *screens*
were not opened on the S25, and no device smoke run was possible in-session.
