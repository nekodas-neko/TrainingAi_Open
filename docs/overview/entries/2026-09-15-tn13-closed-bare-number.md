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
