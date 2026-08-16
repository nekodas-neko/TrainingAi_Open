# 2026-08-07 — Morning Check-in stops score-based pre-filling; Motivation replaced with an illness/context flag

**Domain:** readiness — v1.267.11, JS-only (no APK rebuild) + one additive migration

## The report

Q-113 (owner UI-bug batch): the owner questioned why "Recovery" on the Morning Check-in felt
redundant with Readiness and why they kept leaving it at the default — traced to source rather than
dismissed as a UX opinion. Separately asked to replace "Motivation to train," which they'd noted
felt equally hard to answer meaningfully first thing, still in bed.

## Root cause

`prefillMorningScales()` (`packages/shared/src/nutrition/day-checkin-prefill.ts`) seeded
`perceivedRecovery` from `scoreToScale(readiness)` and `sleepQualityFeel` from
`scoreToScale(sleepScore)`, read directly into `MorningCheckinSheet`'s initial state. The sheet
opened already positioned at a score-derived guess before the owner had looked at the screen — an
unedited Save stored that guess as if it were independent self-report. This is almost certainly why
Recovery felt redundant with Readiness (it literally started as a function of Readiness), and it
compromised an already-published statistic: `battery-recovery-calibration.ts` documents
`r = −0.414, p = 0.010, n = 39` between Body Battery and `perceivedRecovery`, used as evidence the
model tracks genuine felt recovery — some unknown share of that data was the unedited prefill, and
Body Battery itself anchors from Readiness each morning, risking partial circularity.

## The fix

- **Neutral default, not score-derived.** `MorningCheckinSheet` now defaults `perceivedRecovery`/
  `sleepQualityFeel` to a flat 3 regardless of Readiness/Sleep score. `prefillMorningScales()` and
  its `scoreToScale()` helper are fully removed (no longer used anywhere) — deleted along with the
  test file's `describe('prefillMorningScales', …)` block.
- **Persisted touched flags**, not just a neutral default. Migration 169 adds
  `perceived_recovery_touched`/`sleep_quality_feel_touched` (boolean, default false) to
  `day_checkins`. The sheet marks a scale touched the moment the lifter taps it, and only that —
  loading a saved-but-unedited checkin doesn't retroactively mark it touched. This is what actually
  unblocks calibration work: `battery-recovery-calibration.ts` (or any future correlation study) can
  now filter to `perceived_recovery_touched = true` rows instead of guessing which historical values
  were real self-report vs. an accepted prefill. Re-running the calibration itself is left as a
  follow-up (not enough genuinely-touched rows exist yet to be worth re-running immediately).
- **Motivation replaced with `illnessContext`.** Confirmed via grep that `motivation` had zero
  calibration or gating use anywhere (only reached the AI-periodization LLM prompt as free text).
  `motivation` itself is retired in place — same pattern as `wakeMood`/`restingSoreness` before it:
  the column stays for historical rows, new saves always write null. The new
  `illness_context` column (migration 169) holds one of `sick | alcohol | poor_sleep | null`,
  rendered via a new `IllnessContextPicker` component (`components/checkin/illness-context-picker.tsx`)
  — single-select, exclusive, no separate "None" chip (tapping the selected chip clears it back to
  null), matching `sore-muscle-picker.tsx`'s pill visual language.
- **Ties into the existing self-reported-sick signal, not a new parallel one.** `illnessContext
  === 'sick'` now feeds the same deterministic `selfReportedSick` boolean the mood check-in's
  `bodyState` already fed. Extracted the OR into one shared `resolveSelfReportedSick()`
  (`packages/shared/src/ai-periodization/signals.ts`) — there were three independent call sites
  computing this (the full `aggregateSignals` prescription-generation path, the ai_dynamic
  home-recommendation path in `adapter.ts`, and the same-day `reevaluatePrescriptionForToday` path
  in `workout-data/route.ts`), all now sharing one implementation instead of three copies that could
  drift ("One Formula, One Place").
- **`reevaluationKey()` fingerprint gap.** The same-day reevaluation path skips its (more expensive)
  work when a cached fingerprint says nothing changed. That fingerprint only covered the mood log —
  filling in the Morning Check-in's illness flag mid-day, after the mood log was already
  fingerprinted, would never have re-triggered the reevaluation that's supposed to catch exactly
  this. `reevaluationKey()` now also folds in the Morning Check-in's own `updatedAt`/
  `illnessContext`, with a regression test proving the key changes when only the checkin changes.

## Offline-first plumbing

Per the sync-mirroring rule, the two new touched-flag columns and `illnessContext` were threaded
through the full chain in one pass: `lib/data/postgres/schema.ts`, `adapter.ts`'s
`getDayCheckin`/`listDayCheckins`/`saveDayCheckin`/`pushMutations` day_checkins branch, the
`app/api/day-checkin` route, the local SQLite reconcile-delivered columns (`lib/sqlite/migrations.ts`
— no version bump needed, this table's additive columns have always shipped via the reconcile path,
not a versioned `ALTER`), `lib/local-store/sqlite-backend.ts`'s `getDayCheckin`/`upsertDayCheckin`/
`applyDeltaBody`, `lib/local-store/types.ts`'s `LocalDayCheckin`, and `sync-engine.ts`'s pull-delta
mapping (day_checkins turns out not to actually be sent by `getSyncDelta`'s return object today —
a pre-existing, separate gap, out of scope here — but the client-side mapping code exists and stays
consistent for when that's fixed). The evening check-in's own `upsertDayCheckin` call site
(`end-of-day-review.tsx`) needed the three new required fields added too (all `null`/`false` — none
of this is meaningful for an evening row).

## Verification

Typecheck and lint clean across all touched files (one pre-existing unrelated `voice-log-button.tsx`
error confirmed via diff). Full suite: 403 files / 3,187 tests green, including new regression tests
for `resolveSelfReportedSick` (`self-reported-sick.test.ts`) and the extended `reevaluationKey`.

Ran `pnpm dev` against the local seeded DB and exercised the real write/read path directly:
`POST /api/day-checkin` with `perceivedRecovery: 2, sleepQualityFeel: 4, perceivedRecoveryTouched:
true, sleepQualityFeelTouched: false, illnessContext: "sick"` round-tripped correctly through
`GET /api/day-checkin` and was confirmed in Postgres directly via `psql`.

**Not exercised:** the actual Morning Check-in sheet UI (neutral sliders, the new chip picker)
couldn't be visually confirmed via Playwright — its auto-open-on-first-visit-of-the-day trigger
didn't fire in this sandbox. Confirmed via a stash-and-retest against unmodified `main` that this
same non-firing behaviour exists there too, so it's a pre-existing sandbox/dev-server limitation,
not a regression introduced here — but it means the actual on-screen rendering was verified by code
review and the underlying API/data-flow test above, not a live screenshot. No on-device S25
verification — this change has no native, safe-area, or gesture surface.

## Remaining scope

- Re-running `battery-recovery-calibration.ts` against only genuinely-touched rows, once enough
  exist, was explicitly left as a follow-up rather than done in this PR.
- Q-102 (wire `sleepQualityFeel` into the live Sleep Score) stays owner-declined regardless of this
  fix — its backlog entry's prefill-contamination caveat is now historically accurate context, not a
  live blocker, since Q-102 itself is not being reopened.
