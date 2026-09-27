# RV-217 — three contributors rendering their own key, and the third time this class has shipped

**Branch:** `feat/rv217-contributor-labels` · **Lane A** · no migration

## What the entry said, and it is all true

Of the Sleep score's ten contributors, seven render a label and a chevron and three render the
internal key, lowercase, with nothing to tap: `hrv`, `hr`, `schedule`. Verified against `main`
rather than taken on trust — the model emits exactly ten keys
(`totalSleep efficiency rem deep latency timing hrv hr schedule restfulness`), `CONTRIBUTOR_KEYS`
maps seven, and `labelFor`'s fallback is `key.replace(/_/g, ' ')`, so an unmapped single-word key
comes back as itself.

**The fall-through is correct and stays.** `CONTRIBUTOR_KEYS` translates the model's keys into
Oura's vocabulary, and Oura's `daily_sleep` set is *exactly* those seven — `hrv`, `hr` and
`schedule` are the app's own additions with no Oura counterpart, so passing them through unchanged
is the right behaviour. What was missing is a label and a guide entry for what comes out.

## The sibling sweep found the same defect one step along

RV-217 asks to check Readiness for the same thing. Its labels are fine — RV-201 fixed them. Its
**guide** is not: of the nine contributors in `READINESS_WEIGHTS`, `checkin` is the only one with
no `contributor-guide` entry. So it was the one row on "What goes into this score" that reads
correctly and then does nothing when tapped. A label without a guide is the same defect with a
later symptom, and it is fixed here under the sibling-surface rule.

This is the **third** appearance of the class: RV-201 found `hrvBalance` rendering raw in the
readiness insight, and the same entry found `checkin`/`temperature`/`prevDayActivity`.

## So the test derives the keys rather than listing them

A list is exactly what let the next component arrive unlabelled. The sleep half runs
`computeSleepScore` against a night that fires every optional branch and asserts over whatever
comes back; the readiness half keys off `READINESS_WEIGHTS` directly. Both assert a label *and* a
guide entry, and the sleep half carries a vacuity guard — it fails if the fixture stops producing
all ten, which is the way a test like this quietly stops testing anything.

The label assertion rejects two things, not one: the raw key, and the de-underscored fallback
(`total_sleep` → "total sleep"), which is still the raw key wearing a space.

## Copy written from the curves, not from the names

- **HRV** — overnight average as a ratio to your own baseline; higher scores better; opt-in, so it
  is absent on nights without a baseline rather than fabricated.
- **Heart rate** — the same shape mirrored: `HR_RATIO` rewards at-or-below baseline and falls away
  fast above it.
- **Sleep schedule** — `Math.max(0, lateBed, earlyWake)`, so only the *worse* end counts and only
  in the penalised direction. An early night or a lie-in costs nothing, which is worth saying on
  the card because it is not what "schedule" suggests.

## Verification

Custom Rules **80 of 80**; lint 0 errors; `tsc` clean; `check-test-typecheck` at baseline; full
suite **1,108 files, 10,358 passed / 87 skipped, EXIT=0**.

5 tests. Mutation pass, 4 mutants + 1 control:

| mutation | killed |
|---|---|
| remove the `hrv` label | 1 |
| remove the `schedule` guide | 1 |
| remove the `checkin` guide (the sibling) | 1 |
| sleep model stops emitting `hrv` (the vacuity guard) | 1 |
| **control:** reorder the three new labels | **0 — survived, as intended** |

## Not exercised

**No screen was rendered and no device was used.** `labelFor` and `guideFor` are pure functions
and are covered by test; what is *not* covered is that the Sleep list actually draws the new
labels and chevrons. The routes that load these modules were driven on `pnpm dev`
(`/api/readiness-score` and `/api/body-battery` both 200); `/api/ai/health-insight`, which uses
`labelFor` server-side, is POST-only and was not driven.

**The third item of the entry is not done.** "Find what renders the empty gaps" is a layout
question the screenshot cannot settle — the two candidate causes look identical in source — so it
is filed as **LA-157**, `Lane: B`, to be reproduced at the 384 px dark viewport. The label and
chevron halves, which are what made the list look broken, are done.
