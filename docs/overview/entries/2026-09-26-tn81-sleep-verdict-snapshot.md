# 2026-09-26 — TN-81: the app's verdict on a night, with its evidence frozen beside it

**Branch:** `feat/tn81-sleep-verdict-snapshot` · **Lane A** · entry TN-81 (removed from the queue)
**Plan:** `docs/superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md` · engine half of TN-81 + TN-82

## Why this exists

Tuning has no validated outcome variable. Five validation attempts have failed for want of a
label, and asking for one has now failed three times across three affordances — 82 morning sheets,
and in each month exactly one field collects a handful of answers before decaying to zero. So the
app stops asking: it fills the sleep category itself, says what it filled and why, and the owner's
only interaction is to correct it. **A correction is a disagreement, and a disagreement is the
label.**

## What shipped

- `packages/shared/src/health/sleep-verdict.ts` — per-component rolling median/IQR over a trailing
  28 nights (duration, onset time, efficiency), a verdict of `normal | poor | good`, and **which
  components triggered it**. Plus `onsetMinutesForNight`, which reads the clock and the calendar
  day in the *user's* timezone.
- Migration **284** (`sleep_verdicts`) and its regenerated `claude_ro` twin **285**.
- `sleepVerdicts` in the Drizzle schema, `SleepVerdictRecord` in the shared types, and three
  repository methods.
- `quantile` exported once, in `daily-medians.ts` beside `median`.

## The requirement that shaped the table

**The verdict and its inputs are snapshotted, not just the outcome.** `sleep_score` is computed on
read and persisted nowhere — re-measured against production 2026-09-26, non-null on **0 of 119**
rows over the last 120 days, with `duration_hours` on all 119 and `average_hrv_ms` on 102. Every
figure in the entry checked out exactly, which is unusual enough to be worth recording.

Store only the word and a later scoring change silently rewrites what each correction was
disagreeing with. So the component values and the bands are columns, frozen at announcement time.
A correction whose paired verdict is not pinned is not evidence.

**A new table, which is the opposite of migration 282's call.** 282 put `acwr` on
`oura_daily_derived` because a second daily-metrics table splits one day across two places — right
for a metric. This is not a metric: it is an announcement with a response state. `day_checkins` was
the other candidate and is worse, because its row exists only once the sheet is **saved** while an
announcement happens when it is **opened**, so "announced, no response" would have nowhere to live.

## Three states, and the write that must never happen

`response_state` is `none | acknowledged | corrected`. Silence under correction-only feedback is
ambiguous — it means either "the app was right" or "he never looked" — and that cannot be
recovered afterwards. So `upsertSleepVerdict` deliberately **omits `response_state` from its
conflict update**: re-announcing a night must never turn an answer back into silence. There is a
DB-backed test for exactly that, and a mutant that adds the field is killed by it.

The TN-57 rule holds: an auto-fill writes `touched: false`, only a correction writes `true`. A test
asserts this path writes no touched flag at all.

## Mutation pass

11 deliberate defects, all killed; 2 deliberately equivalent controls, both survived.

One survived the first round and the test was at fault, not the code: "let a night help judge
itself" changed nothing, because a single low outlier barely moves the p25 of 28 values, so
"still poor" passed either way. It now asserts **band equality** between a run with the target in
its own history and one without — the property itself rather than a symptom of it.

## Not done, and filed rather than left implicit

- **LA-149 — nothing announces the verdict yet.** The plan ships the engine half first and the
  integration point depends on the surface TN-82 builds, so the computation and storage land inert.
  **TN-82's `Needs:` was repointed from TN-81 to LA-149** in the same edit: removing TN-81's heading
  would otherwise have made TN-82 READY while there is no data for it to announce.
- **LA-148 — four `median` implementations, and one disagrees.** Found while looking for something
  to reuse. Three average the two middles and return `null` on empty; `hr-smoothing.median` returns
  the upper middle and **`0`** on empty, which is a plausible-looking bpm. Not fixed here — it is a
  live display path and a migration ships alone.

## Not exercised

No device run, and none applicable: server-side only, with no local-SQLite mirror. The verdict
needs 28 nights and per-component medians, which makes it a server-assembled aggregate of the kind
`weekly-stats` already is, so the offline-first read rule does not bite.

**No `pnpm dev` route exercise either, and that is not an omission being glossed:** this PR adds no
route and no caller. What ran is the full suite against the local Postgres, the DB-backed
repository tests, and the two TCP `claude_ro` tests (**2 files, 27 tests, none skipped**). Nothing
here has been exercised against drifted production data, and nothing here runs in production until
LA-149 wires it.
