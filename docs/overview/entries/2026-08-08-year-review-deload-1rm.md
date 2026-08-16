# 2026-08-08 — The Year Review reported a deload as a lift dropping to zero

**Domain:** workouts / platform — v1.270.24, JS-only (no APK rebuild)

Found by accident, which is worth recording: this session was running Q-52's outstanding
"re-measure once blocks cycle" audit against production, and four exercises in the 2026-08-06 Upper
session came back as **−100%** trends. Two wrong hypotheses later (a `useFor1rm` style-index bug,
then a submaximal-set guard), the code said it plainly: `estimateOneRm` returns
`{ estimated1rm: 0 }` when `deloaded` (`packages/shared/src/1rm.ts:158`). Those four exercises were
per-exercise deloads. **Storing 0 is correct and deliberate** — deload work must never enter an
estimate.

## The actual bug is in one reader

A stored `0` is a perfectly valid non-NULL value, so any reader guarding on `IS NOT NULL` treats a
deload as a real measurement of zero:

```
first1rm: (array_agg(estimated_1rm ORDER BY logged_at ASC)  FILTER (WHERE estimated_1rm IS NOT NULL))[1]
last1rm:  (array_agg(estimated_1rm ORDER BY logged_at DESC) FILTER (WHERE estimated_1rm IS NOT NULL))[1]
```

`getYearReviewTopExercises` (`adapter.ts:1326-1327`) feeds `app/year-review/year-review-content.tsx`,
which renders `first1rm → last1rm` verbatim under "Most trained". A deload landing on the most recent
session of the year's most-trained lift therefore prints **"92.75 → 0 kg"**.

**Every sibling reader already guards correctly**, which is what makes this a single-site miss rather
than a design question: `getExercise1rmHistory` (`periodization.ts:388`) filters `estimated_1rm > 0`,
and `reconcilePersonalRecord` (`adapter.ts:2909-2914`) filters `> 0` *and* `exercise_deloaded = false`
with a comment explaining why. So PRs, prescriptions and the strength history were never affected —
only the Year Review.

## The fix

Both FILTER clauses become `> 0`. `> 0` alone is sufficient: a deloaded row stores exactly 0 by
construction, so the value guard subsumes the flag, and it matches the sibling that reads the same
column for the same purpose.

## Verification

`tsc --noEmit` clean · `eslint` matches the pre-existing baseline (11 warnings on `adapter.ts`,
before and after) · full suite **411 files / 3246 tests, all green** (the long-standing
`scale-ble-multi-reading` failure was fixed by Q-146 in the meantime, so the suite is clean for the
first time this session).

New DB-backed test builds the exact production shape — two real logs (80, then 92.75) followed by a
deloaded log storing 0 — and asserts `first1rm = 80`, `last1rm = 92.75`. **Against the pre-fix
adapter it fails with `expected +0 to be 92.75`**, which is the bug reproduced literally.

**Not exercised:** the Year Review screen itself was not opened — the assertion is at the repository
boundary, where the defect is, and the component does nothing but render the two numbers it is
handed. No on-device verification (server-side query change). No production backfill needed: the
stored `0`s are correct data, and this changes only how they are read.

## Filed, not fixed

The audit that turned this up also produced two things that are **not** bugs and are recorded so
nobody re-investigates: `estimated_1rm = 0` appears 4 times in 328 logs, all from that one deloaded
session; and `intensity_pct ≈ 50` against a style prescribing 80 is what a per-exercise deload looks
like, not a mis-prescription.
