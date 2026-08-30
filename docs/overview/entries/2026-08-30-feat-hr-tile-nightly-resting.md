# 2026-08-30 — the Heart Rate tile shows last night, as a delta (TN-13), Lane A

**Branch:** `feat/hr-tile-nightly-resting` · **Lane A**, both halves — the entry required it · no
migration · patch version bump.

## What was wrong

`const hr = readiness.restingHr ?? readiness.hrCurrent` — the **7-day mean** of the signal that best
predicts how the owner feels (r = +0.557 against their own check-in, the best of nine), shown as a
bare bpm.

Two defects, and the second is the one that decided the design:

**The number barely moved.** Re-measured against production over **71 nights**: the nightly value
changes on **61 of 70** night-pairs, the rounded 7-day mean on **29**. Mean absolute night-to-night
change 2.50 bpm against the mean's 0.58 — **77 % of the daily movement discarded**, and the tile
standing still on nearly six days in ten.

**A bare bpm says nothing.** Against `perceived_recovery`, expressing either HR candidate as a
deviation from the owner's own baseline roughly **doubles** its correlation with felt state (+0.291
vs +0.176 for waking-rest HR; +0.278 vs +0.129 for the nightly value). Which metric you pick moves
the number far less than raw-versus-relative does. 69 means nothing without knowing the usual is 63.

## Both halves, because half fails the entry

TN-13 says it outright: *"a change that keeps the 7-day average and merely adds a cue beside it fails
this entry"* — and the payload field it needs did not exist, which is what moved the entry to Lane A
in the first place. CLAUDE.md's rule for an entry spanning both lanes is *"Lane A, engine half
first"*, so this is one PR: the field, then the tile. No Lane B PR was open in
`oura-score-chip-row.tsx`, checked before starting.

- **`restingHrLastNight` + `restingHrLastNightDate`** on the payload — the latest single night,
  bounded to 7 days so a stale reading is never presented as last night's, with the date so a
  consumer can say *when* rather than implying it is today's.
- **The tile** reads `restingHrLastNight ?? restingHr ?? hrCurrent`. `hrCurrent` stays last because
  it is a live BLE sample rather than a resting rate — a desk reading, not a night.
- **The cue renders a delta**: `50 · −7 vs usual`, `62 · +5 vs usual`, `same as usual` at zero. The
  band thresholds are unchanged; only what is *shown* changed.

## Two things the code review of my own draft caught

**Order.** The first draft took `recentRhrRows[length - 1]`, on the assumption that `bodyMetrics` is
ascending. It is not guaranteed to be — the module defines its own `asc()` helper before building any
series, which is the tell. Taking the last element would have read whatever the query returned last
and shown a plausible bpm from the wrong night, with nothing on screen to say so. Now picked by max
date, in an exported `latestRestingHrRow` so the ordering property is pinned by a test.

**Home.** `restingHrCue` lived inside `oura-score-chip-row.tsx`, where **no test can reach it** —
both vitest projects run in `node` and the component pulls in Next/React chrome. Proved by trying the
import before moving it. It is now `packages/shared/src/health/resting-hr-cue.ts`, which is where it
belongs anyway: it is domain math over `scoreBand`, and that already lives there.

## The entry's headline number had drifted, so it is restated rather than quoted

TN-13 recorded 2.11 bpm / 0.33 / **84 %** over 50 nights. Re-measured over 71: 2.50 / 0.58 /
**77 %**. Same direction, same conclusion — the figures are restated in the code comments because a
number nobody re-measures drifts, and this one is quoted in three places.

## Verified

22 tests across two files, 6 mutations, all killed: the tile back to the 7-day mean, the cue back to
a tier word, the delta computed on unrounded values, the last-element pick, a null/zero reading
counted as a night, and the empty-state guard forgetting the new field.

`pnpm dev` against the local Postgres, with three nightly readings inserted out of date order:

| | |
|---|---|
| `restingHrLastNight` | **50**, from `2026-08-30` — the newest, not the last inserted |
| `restingHr` (7-day mean, the old tile value) | 55 |
| `restingHrBaseline` | 57 |
| the tile would read | **50 · −7 vs usual** |
| change **only** last night to 62 | tile → **62 · +5 vs usual** (12 bpm) while `restingHr` → 57 (2 bpm) |

Full suite green; `pnpm check:rules` Ran 62 of 62; `tsc --noEmit` clean; eslint clean.

## Not exercised

- **The device**, which is the one thing left. The cue text grew from one word to five, and the score
  row has **20 layout styles** — several of them narrow. Check the Heart Rate tile on the S25: a
  number that moved since yesterday, a signed cue beside it, legible at the tile's type size.
  No new APK; it reaches the phone through a Railway deploy.
- **The AI routes.** `readiness-payload.ts` feeds `readiness-score`, `body-battery` and
  `ai/health-insight`. The two new fields are additive and nothing reads them there, so those
  responses are unchanged — reasoned from the diff, not observed.
- **The owner's "average awake resting HR"** stays a separate entry, deliberately. It moves 6.24 bpm
  night to night, 2.5× the nightly resting HR, which makes it the better *stress* candidate — but
  nothing computes it and it does not belong on a tile labelled Heart Rate.
