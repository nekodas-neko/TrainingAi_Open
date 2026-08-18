# Sleep — domain index

**Owns:** sleep sessions and their staging, the hypnogram, Sleep Score and its axes, nap-vs-night
resolution, sleep timing/window anchoring, and breathing during sleep (BDI).

**Does not own:** the readiness score computed *from* sleep ([`readiness`](../readiness/README.md)),
or the ring/strap hardware that measures it ([`devices`](../devices/README.md)). Sleep staging
*from raw BLE frames* is a shared border: the decoder is `devices`, the stager and its output are
`sleep`.

## Code

| Area | Where |
|---|---|
| Night selection, merging, sensing span | `lib/sleep/` — `primary-sleep.ts`, `merge-sessions.ts`, `actual-window.ts`, `sensing-span.ts` |
| Score & derived metrics | `packages/shared/src/health/` — `sleep-score.ts`, `sleep-night.ts`, `sleep-staging.ts`, `sleep-trend.ts`, `sleep-consistency.ts`, `sleep-feel-calibration.ts`, `hypnogram.ts`, `sleepnet-preprocess.ts`, `breathing-rate.ts`, `hrv-frequency.ts`, `spo2-variability.ts`, `hr-sleep-band.ts`, `night-vitals.ts` (**not** `lib/health/` — several plan docs still point there and are wrong) |
| Tables | `sleep_sessions` (+ Oura columns), `oura_daily` — see the Data Model in [`CLAUDE.md`](../../../CLAUDE.md) |
| UI | `app/health/`, `components/health/` |

Shared formulas and their single home: [`docs/module-map.md`](../../module-map.md) §6 (and its
canonical-display-source table in the same section).

## Reference docs

- [`docs/reviews/2026-08-15-comprehensive-app-review.md`](../../reviews/2026-08-15-comprehensive-app-review.md)
  — §1.9 measured the fragment-night problem across all post-re-key `sleep_sessions`: 10 of 46 rows
  under 1.5 h, three at exactly 0.00 h, and on 2026-08-11 and 2026-08-13 the fragment is the *only*
  record for the date. This is the sweep Q-225 asked for; the follow-up is **Q-274**.
- [`docs/sleep-system.md`](../../sleep-system.md) — **start here.** The system reference: what is
  measured, how the score is composed, and which sources feed it.
- [`docs/oura-ble-sleep-staging-findings.md`](../../oura-ble-sleep-staging-findings.md) — what is
  and is not recoverable for staging over direct BLE.
- [`docs/reviews/2026-07-27-night-2026-07-25-case-study.md`](../../reviews/2026-07-27-night-2026-07-25-case-study.md)
  — one real night traced end to end; the best worked example of the pipeline.
- [`docs/reviews/2026-08-05-data-analysis-opportunities.md`](../../reviews/2026-08-05-data-analysis-opportunities.md)
  — **14 of 66 sleep rows are under 4 h and every analysis consumer eats them** (Q-76, consumer side
  of Q-10) — **fixed 2026-08-05, v1.261.0**, see
  [`docs/overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md).
  Also the strongest measured relationship in the dataset: later bedtime costs 0.70 h of
  sleep per hour (Q-77) — and the midnight-wrap coding trap that makes a naive version of that
  analysis report the exact opposite. **Q-77 shipped 2026-08-05, v1.262.0** as the `bedtime-sleep`
  trends view, with a test that goes red under raw-clock-hour coding; see
  [`docs/overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md).
- [`docs/reviews/2026-08-03-cross-domain-bug-review.md`](../../reviews/2026-08-03-cross-domain-bug-review.md)
  — Q-56 (open, investigation-first, shared with `devices`/`body`): one `oura_daily` row landed
  dated 5 days in the future in the same write batch as the `body_metrics` finding. Also: a
  production sleep-integrity sweep came back clean beyond one n=1 edge case (a 45-minute nap stored
  with all sleep-stage fields zeroed — noted for awareness, not filed as a bug).
- Plans: `ls docs/superpowers/plans/*sleep*` (7 today, plus archived ones under `plans/archive/`).

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

- [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](../../reviews/2026-08-17-failure-cells-running-the-app.md) — **the failure-cells lens, run against a live app, 2026-08-17** (Q-452 — the sleep insight card generates an LLM paragraph for an account with no sleep data). Findings Q-450…Q-455; four areas recorded **clean**.

- [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](../../reviews/2026-08-18-ingest-and-input-validation.md) — **the ingest surface and input validation, 2026-08-18** (the ingest auth model and value validation checked for this pillar and found sound; no findings specific to sleep). Findings Q-464/Q-465; **no ingest route accepts a `userId` from the body, and value validation rejects physiologically impossible input on every route reachable in the harness.**

- [`docs/reviews/2026-08-18-battery-anchor-discontinuity.md`](../../reviews/2026-08-18-battery-anchor-discontinuity.md)
  — **the audit of "did the sleep recalibration miss a consumer of the sleep scale?", 2026-08-18.**
  It did not — exactly one comparison threshold exists on that scale codebase-wide and it was
  re-anchored. The audit instead measured Body Battery's sleep→readiness anchor flip at **−17.7
  points** (sd 10.2, worst −51), and found the recalibration removed ~82% of it as a side effect
  (**Q-511**). **The sleep and readiness scales being comparable is now load-bearing** — do not lift
  sleep back toward its old mean.
## Open issues

- [`docs/reviews/2026-08-19-partial-night-manual-bedtime.md`](../../reviews/2026-08-19-partial-night-manual-bedtime.md) — **an owner report: the ring was not worn until 4 am, 2026-08-19** (Q-519/Q-520 — the night holds *wrong* duration data and *right* physiology, so neither deleting it nor keeping it as-is is correct. A 4:23 start drags the 14-day bedtime estimate **~23 minutes later**. Fix: manual bedtime writing **only `sleep_start`** at source `manual`, which the **per-field** health-source merge leaves the ring's duration/HRV/HR untouched by — safe *only* because `duration_hours`/`efficiency` are stored columns, not derived from the span).

```bash
grep -n '^### .*\[sleep\]' projectOverview.md      # 13 entries today
grep -n '\[sleep\]' docs/implementation-backlog.md # 3 queue items today
```

Live at the time of writing (2026-07-30) — always re-run the grep rather than trusting this list:

- 🟠 **Sleep/HRV/breathing metrics changed scale at the BLE re-key** with no conversion, so
  history spans two incommensurable eras — open, shared with `devices`.
- 🟡 **Displayed bed/wake times drifting tens of minutes across rollup re-runs — code fix SHIPPED
  2026-08-12 (Q-71, v1.292.1), historical redecode still owed.** `aggregateOuraRawSamples`'s `toDate`
  now uses Q-139's robust per-epoch offset instead of single-newest-anchor extrapolation. Only future
  rollups get the fix; existing stored nights need an owner-triggered Redecode. See
  [`docs/oura-ble-operations.md`](../../oura-ble-operations.md) I25 and
  [`docs/overview/history-2026-08-12.md`](../../overview/history-2026-08-12.md).
- 🟠 **A sleep session can get stuck on a stale, narrower window with no self-heal (Q-225, found
  2026-08-13/14)** — a different bug from the above: verified via a full local reproduction that
  `aggregateOuraRawSamples` computes the *correct* window from real raw data, but a production row
  didn't match it. Leading theory ties it to `platform`'s DB-pool-contention fault (Q-107), not
  confirmed. See
  [`docs/overview/history-2026-08-12.md`](../../overview/history-2026-08-12.md).
- 🟠 **`respiratory_rate` is persisted from an estimator its own docs call uncalibrated** — queue
  item Q-4.
- 🟡 ~~Degenerate sleep rows are stored~~ **fixed 2026-08-02 (v1.250.8)**; what is left of Q-10 is only the nice-to-have of persisting a session `type`.
- ~~Sleep list/detail/card showed onset-trimmed time as "bedtime"~~ **fixed 2026-08-05 (Q-101,
  v1.266.2)** — those 3 sites now show raw `sleepStart` with latency called out separately, matching
  the Hypnogram ribbon and day-timeline "Fell asleep" card.
- ⚠️ Only **12 of 57 nights** have a persisted derived score; the tooling shipped but has not
  been run against prod.
- ~~`sleep_sessions.oura_id` is globally unique but stores a per-ring id~~ **fixed 2026-08-02 (v1.250.7, migration 166)** — now `UNIQUE (user_id, oura_id)`.
- 🟢 **Q-34 — sleep-staging Phase 1b** — item 1 (LF/HF) was already on `main`; items 3 (SpO₂
  variability, v1.251.0) and 2 (ultradian ~95-min cycle prior, v1.251.1) shipped 2026-08-02, both
  awaiting the same device Redecode for their verdict; item 4 (offline clustering fit) remains and
  is correctly sequenced last.
- ✅ **Q-91 — the hypnogram "going missing" was a reactivity gap, not a data gap** — fixed
  2026-08-06 (v1.266.11). Measured production data first: no recent night was actually missing
  `sleep_phase_5_min`. `sleep-content.tsx`, `health-content.tsx`, and
  `session-select-content.tsx` all now refetch `'sleep-sessions'` when a BLE drain settles or an
  admin Redecode completes, while already mounted — previously only a fresh navigate/remount
  would show the update. See
  [`docs/overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md).
  **Deferred, filed separately:** the BLE ingest route's own background rollup still emits no
  invalidation signal at all for the ordinary (non-manual) flow — `docs/implementation-backlog.md`
  Q-91-followup.
- ✅ **Q-90 — the sleep screen gained phase-hours/bedtime/wake-time 14-day trend charts + a skin
  temperature card** — shipped 2026-08-06 (v1.267.1). The owner's "toggle between, or combine"
  request was resolved as a segmented control (`SegmentedTabs`) over one shared chart area, per
  the plan's explicit "don't guess silently" flag. Bedtime plots on the noon-shifted axis
  (`minutesFromNoon`) to avoid the midnight-wrap trap this domain has hit before. See
  [`docs/overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md).

The nap-scored-instead-of-the-night bug (F-1/Q-1/Q-18) **is fixed** — v1.217.1 gave every consumer
one answer to "which row is the night?". A duplicate "OPEN" row
describing the same bug survived in `projectOverview.md` until it was struck on 2026-07-30; if you
see it referenced as open anywhere else, that reference is stale.

**That one answer is `nightSessions()` in `packages/shared/src/health/sleep-night.ts`** — circadian
nap/night classification, then gap-merge, then one aggregated session per night. Q-76 (v1.261.0)
found eleven read sites that had never been converted to it and routed them all through; four sites
stay on raw rows on purpose and say so in comments (day timeline, sleep list, `oura/hr-day`, and the
daytime-HRV sleep-exclusion windows, which need naps *included* to exclude them from a daytime
curve). **Before writing anything that treats one row as one night, call the helper.**

## History

- Handoffs: `ls docs/handoff-*-sleep-*.md` — most recent:
  [`2026-08-03-sleep-asymmetric-interruption-window-fix.md`](../../handoff-2026-08-03-sleep-asymmetric-interruption-window-fix.md)
  (a real mid-night interruption could get its earlier sleep bout silently dropped, reading as a
  much later bedtime; fixed in `lib/sleep/sensing-span.ts`, PR #1043)
- Journal: `grep -rl 'sleep' docs/overview/entries/`

## Gotchas specific to this domain

- **A ring re-pair can silently re-time every night in history.** `aggregateOuraRawSamples`'s
  `toDate` resolves each `ds` against `currentEpoch(anchors)`, so whichever clock epoch is newest
  governs *all* history — and a history re-drain after a re-pair opens a spurious epoch whose offset
  is estimated from backlog-laden anchors. On 2026-08-17 that shifted 43 nights by **+14.16 h** into
  midday bedtimes, and the full redecode is what applied it. Diagnosis, with the measurements:
  [`entries/2026-08-17-q536-clock-epoch-diagnosis.md`](../../overview/entries/2026-08-17-q536-clock-epoch-diagnosis.md)
  (Q-536 to repair, Q-314 for the detection defect). Two things to carry: a bimodal bedtime
  histogram means **one constant offset**, so measure the shift before theorising about timezones;
  and `oura_raw_samples.epoch` existing does **not** mean resolving per-row is safe, because the
  labels themselves can be wrong.


- **`sleep_sessions.oura_id` is unique PER USER, not globally** (migration 166). The BLE rollup
  derives it as `ble:<startDs>` from the ring counter with no user component, so a global unique
  collided the moment a second person wore a ring — and the collision surfaced as a swallowed
  `stepErrors` entry, not an exception. Any future synthetic id on this table must assume the same.
  (`oura_tags.oura_id` stays globally unique — those are real Cloud ids.)
- **A zero-duration row is a non-night, not a short night.** Production carries bed periods the
  recorder never resolved into sleep (`duration_hours = 0.00`, all stages 0). `groupSleepPeriods`
  drops them, because `computeSleepScore` returns null for `duration <= 0` and a null last-night
  renormalises `previousNight` out of the readiness composite. The bar is deliberately **zero, not
  a 20-minute floor** — short windows are real and get merged into fragmented nights on purpose.
- **A day can hold both a nap and a night.** Any new sleep read must resolve which session it
  means via `lib/sleep/primary-sleep.ts` — this has been the root cause of four separate bugs
  (score, trend, weekly digest, Body Battery).
- **`ring_timestamp_ds` is not wall-clock.** BLE-sourced sleep timing needs the ring↔UTC anchor;
  see [`docs/oura-ble-operations.md`](../../oura-ble-operations.md).
- **The displayed sleep window's END is the end of the RECORDED session, not the moment you woke.**
  `lib/sleep/actual-window.ts` trims leading awake blocks off the start but deliberately does not
  trim the trailing ones — a stretch of lying in bed after waking is still part of the session, and
  the stage totals and ribbon axis both span the full window. Trimming only the header caused the
  07-08 "lost 15 minutes" bug. Expect the shown wake time to sit later than when the user says they
  woke; that is by design, and whether it *should* be is a product question.
- **Clock times render via `formatTimeOfDay` (`@trainingai/shared/date-utils`), never
  `toLocaleTimeString`** — the latter uses the *device's* zone. Three of the six sites found on
  2026-08-03 were on this pillar (the sleep list, the hypnogram axis, the sleep card).
- **Oura's v2 onset field is `latency`, not `onset_latency`** — the wrong name left the column
  NULL for months.
- **A short, real sleep bout before a mid-night interruption can get silently dropped if it's much
  shorter than the bout after.** `denseSensingSpan` (`lib/sleep/sensing-span.ts`) used to only keep
  a secondary dense-HR run if it was *comparable in length* to the longest one — a real but
  asymmetric interruption (a 130-min bout, a 15-min gap, then a 6h40m bout) failed that test and
  read as a much later bedtime with implausibly little awake time (found 2026-08-03, PR #1043).
  Fixed: a run within ~1h of an already-kept run is now bridged in regardless of length ratio. If a
  reported bedtime looks too late with too little awake time, decode the raw `oura_raw_samples` IBI
  beats for that night directly (see the 2026-08-03 handoff) before assuming it's a new bug class.
- **The night's HRV and resting HR have exact definitions, and they live in `night-vitals.ts`.**
  HRV is a gated **median of the ring's own `0x5d` rmssd_ms** — recomputing it from per-beat IBI
  gives a different, un-comparable number. Resting HR is the **lowest 5-minute bin average**, never
  a per-beat minimum: the decoder caps an interval at 2000 ms, i.e. exactly 30 bpm, so one missed
  beat looks like a plausible record low. Both gate on the *same* MET windows. Never re-derive
  these — call the module.
  ([`2026-08-03-night-vitals-extraction.md`](../../overview/history-2026-07-30.md))
