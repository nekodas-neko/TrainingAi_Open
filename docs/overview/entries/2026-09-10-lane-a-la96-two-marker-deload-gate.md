# LA-96 — the two-marker deload gate, applied everywhere and de-duplicated

**Branch:** `lane-a/la96-two-marker-deload-gate` · **Lane A** · no migration, no native change.

## What the entry claimed, and what held

All of it. Six queries read `estimated_1rm` as a real max; two carried both markers
(`estimated_1rm > 0` **and** `exercise_deloaded = false`) and four carried only the first. Verified
site by site against `main` before touching anything.

The reason the second marker exists is in `getLastRealOneRmBatch`'s own comment: `> 0` alone trusts
the write-time invariant that a deload always stores 0, and production has broken that invariant.

## What shipped

`getYearReviewTopExercises`, `listRecent1rm` and `getExercise1rmHistory` now carry both markers. The
year-review filters sit on the two aggregates rather than the `WHERE` clause, because `setCount` must
still count a deload's sets — the exercise was trained, it just did not produce an estimate.

The fourth site was not a fourth site. `app/api/strength-trend` held a **byte-identical copy** of
`getExercise1rmHistory`'s 90-day query, which is how it came to miss a gate the repository was also
missing — one bug living in two places, exactly what **One Formula, One Place** predicts. The route
now delegates, so there are three sites and one place left to forget.

## The change moves nothing today, which was the point of measuring

Zero of the owner's 444 exercise logs hold `estimated_1rm > 0 AND exercise_deloaded = true`,
soft-deleted rows included. All three affected routes (`/api/strength-trend`, `/api/weights-summary`,
`/api/year-review`) return **byte-identical JSON** before and after, checked against a live `pnpm dev`
by stashing the change and re-calling each one. This is a read-time backstop for the next write-time
regression, not a fix for a visible number.

## Q-228 struck

The Known Issue that started this family is now fully resolved and moved to
`known-issues-resolved.md`. Migration `186_q228_deloaded_log_1rm_straggler.sql` zeroed the straggler —
measured today, the row still exists, un-deleted, at `estimated_1rm = 0`. Its text had gone stale in a
way worth noting: it said `getLastRealOneRmBatch` *"never filters on `exercise_deloaded`"* long after
that filter landed, and called it *"the one query in this family missing"* the filter when four others
were. An entry describing a gap outlived the gap and understated it at the same time.

## What the mutation pass caught that the tests did not

Two survivors, both the same shape — a fixture that cannot witness the rule it is aimed at:

- The deload sat in the **middle** of the series, and `getYearReviewTopExercises` picks the extremes
  by `logged_at`. Deleting its gate changed nothing. Moved the deload to the newest row, which is
  also the shape the production incident took.
- That kills the `last1rm` filter's mutant but not `first1rm`'s, since one exercise can only witness
  one end. Added a second exercise that **opens** its year on a deload.

Six mutants killed, one deliberately equivalent control (`= false` → `IS NOT TRUE`; the column is
`NOT NULL`) survived as it should. A seventh "survivor" was a bad mutant, not a blind test: `perl -0`
slurps the file as one record, so a per-line counter never reaches 2 and the edit silently no-ops.

Also worth carrying: a backtick inside a `sql` template literal **terminates the template**. Two of
these comments were written with `` `> 0` `` in them and the queries failed at runtime with
`TypeError: 0 is not a function`. Neither lint nor `tsc` says anything — it is valid JavaScript.

## Not exercised

No device path (server reads only) and no APK. The dev-server pass covered all three routes
authenticated, plus the 401. Production data was read, not written.
