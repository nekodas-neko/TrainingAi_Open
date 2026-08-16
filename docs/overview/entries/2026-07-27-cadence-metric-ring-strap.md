# 2026-07-27 — Cadence metric (ring + strap)

**Branch:** `claude/cadence-metric-ring-strap-6whk16` · **Version:** v1.211.0

Owner-directed session: build the cadence metric for both the Oura ring and the Polar H10,
with the two cross-validating each other, and a treadmill available for calibration.

## What shipped

**One canonical module — `lib/health/cadence.ts`.** Both sources land as steps/min in one
place. Ring cadence is a unit conversion of the already-decoded `stride_frequency`; strap
cadence is our own DSP (band-limited autocorrelation of accelerometer magnitude), because the
H10 exposes no cadence over BLE at all. Also holds the accumulator that produces the persisted
average/series, and `compareCadence` for ring-vs-strap agreement.

Two refinements in the shared autocorrelation, both load-bearing:
- **Sub-sample parabolic interpolation.** Integer lag quantizes to ~11 spm steps at 50 Hz — far
  coarser than a metric whose accuracy target is a few spm. This is what makes a low, battery-cheap
  sample rate viable at all.
- **Octave correction.** Torso acceleration peaks harder at the *stride* than the *step*
  (left/right asymmetry), so a naive argmax reports half the true cadence. A double-frequency
  peak within 0.8× of the winner is preferred. Tested both ways: it fixes asymmetric gait and
  provably does not double a correct symmetric reading.

`gaitBandAutocorr` (`lib/oura-ble/gait-step-count.ts`) now **delegates** to the same primitive
with both refinements disabled, so there is one autocorrelation implementation. Its calibrated
walk-30/handwave-0 real-capture fixtures still pass unchanged — that is the proof the refactor
preserved behaviour, not an assertion.

**Native strap accelerometer (Kotlin).** The 2026-07-17 spike plan assumed a JS `PmdAccelStream`
could piggyback on the strap connection; that is now **wrong** — since v1.180.0 the native
`PolarStrapService` owns the H10 GATT connection, so a JS-side BleClient connect would fight it.
PMD therefore lives in Kotlin: UUIDs + control-point builders + an infallible raw/delta ACC frame
decoder in `PolarProtocol.kt` (10 new JVM tests, which the Android CI job actually runs), streaming
in `PolarGattClient`, and batching in `PolarStrapService`.

The service forwards **magnitudes**, not 3-axis samples — that is what the DSP consumes, it is
orientation-independent, and it cuts bridge traffic by two thirds. Batched to ~1 call/second
(at 50 Hz the bridge would struggle long before the radio would). The DSP stays in TypeScript so
ring and strap share one implementation rather than growing a Kotlin copy.

Streaming is **opt-in and bounded to an activity, never all-day** — unlike the 1 Hz HR
notifications it is real drain on both devices. HR streaming is untouched whether the cadence
stream starts, fails, or is absent.

**Live fusion — `lib/activity/cadence-tracker.ts`.** Strap leads when fresh (~1 reading/s), ring
covers the rest (~1 per 30 s window). Staleness is a pure, tested reducer: a stale strap must
never win, or a dropped BLE stream freezes the display at the last pace seen, which reads as a
working number rather than a missing one. Both readings stay on the snapshot for cross-validation
even though only the winner is recorded.

**Persistence.** Migration **140** adds `cadence_spm` / `cadence_series` / `cadence_source` to
`activity_logs`, wired through schema, both row mappers, the shared Zod body (so the web route and
the outbox replay validate identically), local SQLite via `RECONCILE_COLUMNS`, and both local write
paths. Source is stored because the two derivations are independent — a value without provenance
can't be interpreted or compared later.

**Surfaces.** Live readout on the activity screen and the guided walk (a leaf owning its own
subscription, so a 1 Hz reading doesn't re-render the map); average + series sparkline on the
activity detail sheet, reusing the shared `Sparkline` primitive; and a new **Admin → Cadence
calibration** console.

## Two design calls worth recording

**Gated on foot-based activity types, NOT `activity_types.is_distance_based`.** That obvious key is
wrong in both directions: `treadmill` is not distance-based (no GPS indoors) yet is pure foot
cadence — and is where cadence matters *most*, since nothing else measures movement there — while
`cycle`/`swim` are distance-based with no step rate. Pedal cadence (60–100 rpm) sits partly inside
the search band, so a cyclist would otherwise get a confident, meaningless number.

**The ring's `stride_frequency` units are still unresolved (the open D-2 question)** and were
deliberately not guessed. The conversion is one of two principled values (×60 if steps/s, ×120 if
strides/s) and the calibration console renders **both** against the treadmill's displayed cadence,
so one counted walk decides it. `compareCadence` flags a ~2× ring/strap split explicitly as a
units/octave error rather than as noise.

## Verified in-sandbox

- `tsc` clean, lint 0 errors, **2035 tests passing**, `check-reconcile` + `check-push-mutations` OK.
- Migration 140 applied to the local dev DB; columns confirmed present.
- Dev-server round trip: `POST /api/activity-logs` with cadence → 201 → correct row in Postgres →
  returned by `GET`. An implausible `cadenceSpm: 9999` is rejected 400 by the shared schema.
- Playwright at the 412×915 S25 viewport: the detail sheet paints "CADENCE · 168 spm avg · strap"
  with the sparkline and min/max labels; the admin console renders both unit interpretations and
  correctly shows its "no readings yet" state on web. No page errors.
- A round-trip test asserts cadence survives **both** local write paths — a column added to only
  one fails silently as "the save didn't persist".

## NOT verified — device-gated

Everything that actually produces a cadence number is BLE-bound and inert in the sandbox. **The
strap half needs an APK rebuild**; CI publishes one to the rolling `apk-latest` release on merge,
so no local Gradle build is required. Specifically unproven until the treadmill run:

1. Whether the H10 delivers a PMD stream at all, and in which frame encoding. Both conventions
   decode and the observed frame type is surfaced in the console — a silent zero otherwise looks
   identical to standing still.
2. Real cadence accuracy vs the treadmill, for either source.
3. The ring units question (the console is built to answer it).
4. Battery cost of a sustained 50 Hz stream over a full run, and that HR is unaffected.
5. Safe-area/Samsung-WebView rendering of the new readouts.

## Follow-up found, not fixed

`localToActivityLog` in `components/health/activity-history-card.tsx` is a second row mapper that
silently drops display fields. Cadence was added to it, but it **still drops** `routePolyline`,
`splits`, `bestEfforts`, `paceSeries`, `avgPaceSecPerKm`, `elevationGainM/LossM` and `notes`, so a
pending (unsynced) activity opened from that card shows a detail sheet missing its route, splits and
elevation until the server copy lands. Pre-existing and out of scope here — filed as a Known-Issues
row rather than fixed blind.
