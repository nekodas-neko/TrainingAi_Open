# 2026-09-01 — BF-99: the line said "base" and showed base minus the goal deficit

**Branch:** `fix/bf-99-base-label` · **Domain:** `nutrition` / `body` · **Lane:** B · **Version:** v1.423.0

## The bug was the word, not the arithmetic

The owner, with a Health screenshot: *"why is my base rate under the 1350 RMR value."*

`budgetProvenance().base` is `restingBaseKcal + targetNetKcal` — the resting base with the **goal
delta already folded in** — and the line printed it beside the word *base*. On a recomp that is
~200 kcal below his measured RMR, so a goal choice was presented as a metabolic fact and he went
looking for a broken calculation. **Every number on that screen reconciled.** That is what made this
worth fixing rather than explaining: correct maths described incorrectly sends someone hunting for a
bug that does not exist.

## What changed

The line separates the two and they still sum to the same budget:

- Recomp: `1,972 base − 200 for your goal + 1 earned from movement`
- Lose weight: `1,972 base − 500 for your goal + …`
- **Maintain: `1,972 base + 1 earned from movement`** — no goal clause, because the delta is zero and
  *"+ 0 for your goal"* is noise. That is also BF-99's own check: a maintain user sees the same number
  under both wordings.

Split in the component, **not in `budgetProvenance`** — that is shared, and a single combined number
is the right answer for a caller that wants one. `restingBaseKcal` and `targetNetKcal` were already
props here; nothing new is computed.

**Neither the floor nor the goal maths was touched**, as the entry warns. `restingBaseKcal` is
`Math.max(Math.round(bmr), …)` on both branches, which is what stops a base falling below measured
resting metabolism; the displayed figure was below 1,325 only because the deficit is subtracted after
the floor, which is also correct.

## The second half of his question, which was unanswered anywhere on screen

The measured RMR is **re-scaled, not used raw**: 1,325 was measured at 51.5 kg of lean mass and he
carries ~50.6 kg today, so his personalised figure is ~1,304. That is `personalRmr` doing exactly
what BF-42 built it for — and nothing told him, so a measurement he paid for looked ignored.

The measured-RMR form is the only place the number appears, so the line goes there, under the
fat-free-mass field: *"The app works from this test re-scaled onto your current lean mass, not the
number as entered, so the resting rate it uses day to day drifts a little above or below it as your
body composition changes."* The field's own hint says why the input is needed; this says what the app
then does with it.

## The guard

`components/nutrition/__tests__/base-label-reconciles.test.ts`. It pins the specific regression —
destructuring `base` off `budgetProvenance` and printing it beside the word — and, more usefully,
that **what the line prints still sums to the bar's own budget** across four goal shapes. A screen
that contradicts itself is the failure the old label was a symptom of.

**Two mutations, two failures:** restoring `budgetProvenance().base` as the printed base, and dropping
the goal-delta clause. Assertions read comment-stripped source, since the comments quote the old
wording while explaining the bug.

## Verified on `pnpm dev`

Rendered `/nutrition` with the seeded user's goal set to `recomp`, `lose_weight` and `maintain` in
turn — the three wordings above, measured rather than reasoned. The RMR copy renders on
`/more/clinical`.

## Not exercised

- **The S25.** The line is denser by a clause and Home's copy of the bar is `compact`, so whether it
  wraps at 412 dp is unchecked — insets and text metrics are the sandbox's weakest ground.
- **The owner's actual numbers.** The entry's reconstruction (1,565 · 1,264 · 163 over) is arithmetic
  against live production values and it says so; this fix relabels what the component already holds,
  which is true regardless of whether that reconstruction is right in every step. The seeded figures
  here are the local database's, not his.
