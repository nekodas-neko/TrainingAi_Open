# 2026-08-02 — readiness without a ring: Health Connect as a first-class source (Q-43)

**Branch:** `feat/health-connect-source-tier` · **Version:** 1.250.0 · Run-list item 1 of the
[batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md).

## What was wrong

A friend has an account and every score surface reads blank for them. Two separate causes.

**The composite could only be reached through the ring.** `computeReadinessComposite` takes plain
z-scores and sub-scores — nothing about it needs a ring. But `/api/readiness-score` gated it on
`oura_daily_summary`, the BLE rollup's table, which only exists for the owner. Without that row the
route fell to `sleepComponent + hrvScore + rhrScore + loadScore` and then refused to *display* it
unless a 5-day HRV or RHR baseline existed. So: no composite, no contributors, and usually no
number. Nothing was persisted to `oura_daily_derived` either, so `/api/health/trends` read null for
every day, forever.

**`saveSleepSession` was the one health write that skipped provenance.** A bare
`onConflictDoNothing` with no `source_map`, while every sibling goes through `mergeSet`. Health
Connect sleep therefore landed rank-0 first-write-wins — harmless while HC is off, a silent
data-quality bug the moment it isn't. This is the Q-43 half that was already documented in
`CLAUDE.md` as a known exception.

## What shipped

**Sleep now has one write path.** `saveSleepSession` delegates to `upsertOuraSleep` with a
**required** `source`, so both sleep writers share a function and the same per-field rank merge.
`source` is not optional: a caller left on a default would silently write rank-0 and beat the ring
forever. `OuraSleepUpsertRow.ouraId` is now optional — a Health Connect night has no vendor id and
dedups on `(user_id, sleep_start)` like everything else.

**The composite runs from the generic tables when there's no rollup.** `body_metrics` HRV and
resting HR and `sleep_sessions` durations are folded into baselines with the *same* `updateBaseline`
the ring's rollup uses, so a phone-only user's contributors are on one scale with a ring user's.
Temperature and recovery index have no generic source and stay null rather than being approximated.
The result is persisted under today with `readiness_source: 'generic-derived'`, which is what stops
the trend surfaces reading empty from here on.

**Two routes were missing the derived fallback entirely.** `/api/day-timeline` read readiness from
`oura_daily` only — null for anyone off Oura Cloud *and* for the owner since the BLE re-key.
`/api/health-trends`'s subjective-recovery correlation had the same gap. Both now read
derived-first, matching `/api/health/trends`.

**Health Connect's hypnogram is kept.** The plugin hands us a full stage-interval array and we were
reducing it to four totals. `intervalsToPhase5Min` rasterises those intervals onto the same 5-min
grid the ring writes.

**The score says what it's built on.** `limited` / `scoreConfidence` / `inputsAvailable` /
`inputsMissing` come from one helper (`lib/health/score-availability.ts`), and the Readiness
breakdown renders a sentence naming the missing signals. Icon plus text, never colour alone.

## Decisions worth not re-litigating

**The hypnogram refuses partial coverage rather than filling gaps.** `sleep_phase_5_min` is
positional and has four codes — no way to say "unstaged". Health Connect can emit
`SLEEP_STAGE_SLEEPING` and `SLEEP_STAGE_UNKNOWN`, which mean "asleep, stage undetermined". Skipping
those buckets shifts the whole night; filling them invents a stage. So the rasteriser returns null
unless every bucket is covered by a staged interval, and the caller keeps its four honest totals.
A tracker that only reports generic sleep gets no hypnogram — deliberately.

**A cold baseline is refused, not used.** Two samples of a steady 50 bpm fold to mean 25 / dev 3.1
and produce z = 8, which the composite would read as a flawless resting-HR day. `trailingBaselineZ`
holds out until `BASELINE_MIN_NIGHTS` priors have accrued. This was found by a test written to
assert the opposite, and it is the one behaviour here most likely to be "simplified" back out.

**`SLEEP_STAGE_OUT_OF_BED` counts as awake** in both the totals and the hypnogram. It plainly isn't
sleep, and having the two representations disagree would be worse than the small change in awake
time. The stage strings were read out of the pinned plugin source (`RecordConverter.kt:390-400`),
not from memory — note `AWAKE_IN_BED` has no branch in that `when` and arrives as `UNKNOWN`.

**Scope held at the owner's cap.** No re-tuning of what readiness *means* on reduced inputs — the
weights are untouched and missing contributors fall back to the composite's own neutral. Re-banding
needs real multi-user data.

## Verified

- Full suite green (369 files / 2855 tests), lint clean, typecheck clean, custom rules pass.
- `pnpm dev` against the seeded local user, who has no Oura data at all — i.e. the exact shape this
  fixes. Readiness went from blank to 54 (`source: custom`, `limited: true`, `confidence: partial`,
  missing temperature), `oura_daily_derived` gained a `generic-derived` row, and `/api/health/trends`
  went from null on every day to a real value for today.
- `/api/day-timeline` proven with a seeded derived row: wake-up event readiness went from null to
  the derived value. Both `YYYY-MM-DD` and `YYYY/MM/DD` params exercised.
- `/api/sync-health` POSTed a real sleep payload: row lands with `source_map` stamped
  `health_connect` per field and the hypnogram persisted; a malformed hypnogram string is a 400.
- Readiness screen rendered headless at 412px — the qualifier displays with its icon.

## ⚠️ Not verified — the actual Health Connect ingest

The owner has Health Connect switched off and there is no second device in the sandbox, so **no
part of this ran against a real Health Connect provider**. Specifically unexercised: the Capacitor
plugin read path, the real stage strings a real provider emits, and whether any provider stages a
whole night cleanly enough to produce a hypnogram at all. Everything above is proven against
fixtures and the seeded local database. A `projectOverview.md` Known-Issues row says so, and a
device check is on the owner checklist in the batch handoff.
