# Oura Direct-BLE — Remaining Work (handoff)

**Last updated:** 2026-07-08 (after v1.120.4). Written as a self-contained brief so a
fresh session/agent can pick up the direct-BLE Oura work without re-deriving context.

## How to use this doc
- Read this first, then the deeper references at the bottom.
- Items are **priority-ordered**. Each says: **what**, **why**, **where** (files),
  **server-only vs needs-APK-rebuild**, and **how to verify**.
- The canonical queue is still [`docs/implementation-backlog.md`](implementation-backlog.md)
  (follow its protocol: take the top item, one per session, remove it in the PR that
  completes it). This doc is the BLE-specific expansion of those entries + the new
  findings from session 219.
- **Runtime reality:** JS/server changes ship via Railway into the WebView with no
  rebuild. **Kotlin/native changes need an owner APK rebuild** (`npx cap sync android
  && ./gradlew assembleDebug`, or the Android CI job's `app-debug-apk` artifact) and are
  compile-gated only in the sandbox. On-device is the only real verification for BLE
  behaviour. State which half any PR touches.

---

## Current state (what works as of v1.120.4, 2026-07-08)

The ring is read directly over BLE (no Oura Cloud). Raw events land in
`oura_raw_samples`; a server-side rollup (`aggregateOuraRawSamples` in
`lib/data/postgres/adapter.ts`) derives the product metrics. All of the following are
**shipped, on-device-verified, and saving reliably**:

- **Heart rate** — 5-min binned series into `oura_heartrate` (source `'ble'`), **15-sec
  bins inside workout windows**; feeds the Home/Health HR-day charts.
- **HRV** (rMSSD), **resting HR** (5-min-binned nightly low), **SpO₂** (derived from raw
  `0x8b` R via the Oura "SpO₂ Simple" quadratic — verified 96.4 %, matches the owner's
  Cloud-era baseline, no calibration offset needed), **wear time** (on-finger signal
  density → `oura_daily.non_wear_time_sec`), **sleep sessions** (`ble:<startDs>` rows).
- **Robustness:** the rollup runs each write step (sleep / body_metrics / hr_series /
  wear) in its own try/catch (`step()` helper) so one failing step can't starve the
  others; per-step errors surface in the `/admin/oura-ble` tester log. `measured_at` is
  re-stamped from the current anchor on Redecode. Sleep + HR rows are delete-then-reinsert
  (idempotent against anchor drift).

---

## Remaining work — priority order

### 1. Workout HR chart — ✅ DONE (v1.120.5, 2026-07-08)
Shipped as an enhancement of the existing done-screen "HR Recovery" card (not a fresh
build — the card already read `getHrForWindow`, which includes BLE rows). Added
**set/rest shading**: `getSetTimestampsForSession` now returns `setStartMs`/`setEndMs`,
`/api/oura/hr-data` passes them through, and `HrRecoveryChart` shades each working-set
interval (faint green band) via a `beforeDatasetsDraw` plugin, with graceful fallback to
just the trace + per-exercise dashed lines when a session has no per-set timing. The
done-screen "Load" no longer blocks on the now-dead Oura Cloud `hr-sync` (fire-and-forget),
so it renders the already-captured BLE HR immediately. Gridlines/ticks switched to
theme-neutral gray. Verified end-to-end against the local DB (readings + set intervals
flow to the route payload); chart-band rendering + on-device BLE remain the authoritative
check. Per-session-in-history view not built (there is no per-session workout detail
surface today) — left as optional future work.

<details><summary>Original brief (for reference)</summary>

#### 1. Workout HR chart (NEW build — highest value, self-contained, server/JS only)
- **What:** a heart-rate trace across a workout session on the workout done/summary
  screen (and/or per-session in history), with set/rest shading.
- **Why:** the data is already captured and confirmed — the 2026-07-08 Legs session holds
  **~120 `green_ibi_quality` HR readings** (~1 per 30 s) correctly timestamped, and HR is
  already stored at **15-sec resolution inside workout windows** (v1.120.0). Nothing new
  needs capturing; this is purely a read + render.
- **Where:** read `oura_heartrate` (`source = 'ble'`) for the session's
  `[started_at, completed_at]` window (there's an existing `getHrForWindow` /
  `/api/oura/hr-day` / `hr-window` path to model on). Shade set vs rest from `set_logs`
  timings. Workout screens: `components/workout/done-screen.tsx`,
  `components/workout/exercise-summary-screen.tsx`. Chart primitives: `react-chartjs-2`
  (load via `next/dynamic({ ssr:false })`), or the shared sparkline.
- **Caveat to design around:** during motion the ring emits only green-LED `0x80` (no
  `0x60`), so it's a **trend line, not beat-by-beat** — rest periods are the cleanest
  signal. Expect gaps during heavy sets. Don't imply higher fidelity than exists.
- **Verify:** local dev server with a seeded workout + `ble` HR rows in its window; then
  on-device against a real logged session.
- **Needs:** a short UI plan first (per the project's plan-then-build convention), then
  the build. Server/JS only — no APK rebuild.

</details>

### 2. Ring steps — feature not enabled (reachable; needs an APK rebuild to enable + a decoder)
- **What:** get step counts from the ring.
- **Why we get none today:** prod query (2026-07-08) shows the ring emits **zero**
  `real_step_event` (`0x7e`/`0x7f`) and zero `activity_summary` (`0x51`/`0x52`) — only
  sparse `activity_information` (`0x50`). The re-key enabled only DAYTIME_HR|SPO2, and
  **REAL_STEPS (feature `0x0b`) is off by default** — gated by the server flag
  `activity/real_steps` (default false). It is **NOT** firmware-entitlement-locked.
- **`open_oura` confirms it is enable-able over BLE (this corrects an earlier pessimistic
  note):** on a *consumer Ring 5* they forced `SetFeatureMode(REAL_STEPS, AUTOMATIC)` and
  got **SUCCESS** (along with `exercise_hr`, `cva_ppg`, `experimental`). Only the
  research/raw entitlements (`research_data` 0x01, `raw_data` 0x12, `atlas` 0x15) stay
  locked — REAL_STEPS is not one of them (open_oura `docs/ring-features.md`, "What we
  enabled by hand"). The AWHR/EXERCISE_HR chain enables REAL_STEPS first as a prerequisite,
  so enabling REAL_STEPS also unblocks exercise-HR.
- **Step 1 (native, next APK rebuild — batch with item 6):** add a `feature-status` readout
  to the tester and call `SetFeatureMode(REAL_STEPS 0x0b, AUTOMATIC)` (and EXERCISE_HR 0x03)
  on connect. Wire format `2f 03 22 <feature> <mode>` (skill §6). Expectation: **should
  succeed** per open_oura; verify with `feature-status` + that `0x7e`/`0x7f` (and ideally
  `0x51`/`0x52`) events start arriving.
- **Step 2 (decode — once events arrive):** the `0x7e`/`0x7f` step-count byte field is
  **still unidentified even upstream** ("stepmotion", names TBD). Counted-walk experiment:
  owner walks exactly N steps, syncs, screenshots the tester's Decoded-fields inspector for
  `0x7e`/`0x7f` before/after; the field whose delta ≈ N is the counter. **Alternative source:**
  step counts also live in `activity_information/summary` (`0x50`/`0x51`/`0x52`) as
  "13 MET-level bins + step counts" (open_oura `docs/data-recovery-map.md`) — may be an
  easier decode than `0x7e`/`0x7f`. Then ship the decoder (`lib/oura-ble/decode.ts`) +
  Redecode backfills history.
- **Until then:** the steps chart runs on phone/Health-Connect steps (still flowing).

### 2b. Activity / MET-minutes / calories (reachable via re-derivation; NOT the cloud loss you'd assume)
- **What's available over BLE:** MET-binning happens **on the ring**, not the cloud —
  `activity_information` (`0x50`) carries the 13-level MET bins as an always-on base stream
  (we already receive it, sparsely). So the raw activity/MET signal is reachable now.
- **Daily rollups (activity score, active calories, MET-minutes) are re-derivable:** these
  were Cloud-computed originally, but `open_oura` ported the on-phone `ecore` math —
  "Activity targets / cals / MET" is marked **◐** ("VO2max/BMR/steps→m ported+tested;
  MET-class ordering + calorie/step regression best-effort"; `docs/algorithms/README.md`).
  So we can reimplement daily activity calories + MET-minutes from ring MET + the user's
  profile — **best-effort, not exact**. Fold into the Phase-5 own-scores work (item 5).
- **The ONE genuine cloud-only loss — workout auto-detection/classification:** identifying
  a workout ("32-min run") is a true cloud ML call (`POST /api/activity-tagging/v2` →
  `activity_id` + `confidence`), run on Oura's servers, **not reproducible over BLE**. The
  ring supplies raw MET + accelerometer segments; only the *classification* is gone. If we
  want auto-workout-tagging we'd build our own classifier (out of scope) — otherwise
  workouts stay user-logged (which this app already does natively).

### 3. Stable per-epoch clock anchor (root hardening — server/JS, some care)
- **What:** derive a **stable** `(ring_ds ↔ utc)` anchor per epoch instead of the current
  forward-only `(batchMaxDs ↔ ingest-time)` that advances on every drain.
- **Why:** the anchor drifts a little each sync, so **all derived timestamps wobble**
  between rollups (`measured_at`, sleep `sleep_start`, HR-series bin times). This is the
  root cause of the v1.120.4 sleep-write collision (worked around with delete-then-reinsert)
  and of the `measured_at`-collapse Redecode has to repair. A stable anchor makes timestamps
  not move at all within an epoch.
- **Where:** `insertOuraRawSamples` anchor maintenance (`lib/data/postgres/adapter.ts`);
  the ring's own `SyncTime` ack is the purer source (skill; the native plugin gets the ack).
  Also covers per-epoch anchor rows on a ring reset/re-key (currently one forward-only row).
- **Folds into** backlog item 2's per-epoch-anchor work. Server-side derivation is
  testable in-sandbox; wiring the SyncTime ack through may touch native.
- **Verify:** boundary tests that two rollups over the same data produce identical
  timestamps; on-device that measured_at stays put across successive drains.

### 4. SpO₂ calibration validation (owner-run, no code unless it drifts)
- **What:** confirm the derived SpO₂ tracks Oura's numbers over several nights.
- **State:** 07-08 came out **96.4 %**, dead-on the owner's 95–97 % Cloud-era baseline, so
  the default gen4 quadratic looks correct — **no offset applied**. But that's one night.
- **Do:** compare a few more BLE nights against the owner's pre-re-key Oura history
  screenshots. If a **systematic** offset appears, add a per-ring offset/scale constant in
  `lib/oura-ble/spo2.ts` (`SPO2_COEFFS`), calibrated on the overlap nights. Fold findings
  into the phase-3-4 results doc.

### 5. Phase 5 — our own readiness / sleep / activity scores (planned, queued)
- **What:** compute our own 0–100 readiness/sleep/activity scores in `lib/health/*` from
  the mapped BLE data (replaces the frozen Cloud-era scores, which stopped at the re-key by
  design — the phone-engine tier-2 outputs are gone). This is also the fix for the empty
  home-screen score chips (`components/oura-score-chip-row.tsx`) — the chip UI was never
  removed, it's just been unfed since the re-key.
- **Why:** user-confirmed goal is "no black box — our own scores." Skill §9 has the formula
  inventory (HRV, resting HR, temp deviation w/ personal baseline, sleep durations, our own
  score design over training load / ACWR / RPE).
- **Status:** planned and queued — see `docs/implementation-backlog.md` Queue item 3, plan
  `docs/superpowers/plans/2026-07-08-oura-ble-phase-5-own-scores.md` (added 2026-07-08).
  Sleep and Readiness chunks need no data accumulation (BLE already lands the inputs);
  Activity's base runs on Health-Connect steps/calories + training load from day one and
  improves once ring-steps (item 2 above) lands. Server/JS.

### 6. CompanionDeviceManager + bonded-device reconnect (native, APK — robustness)
- **What:** CDM association + presence-observation service for robust wake-on-advertise /
  reboot survival, plus the bonded-device reconnect experiment. From backlog item 1's
  remainder — the highest-risk blind-Kotlin piece, deferred.
- **Needs:** owner APK rebuilds; on-device verification. Batch item 2's step-feature attempt
  here since both need a rebuild.

### 7. `source` provenance column + precedence-ranked merge (server/JS)
- **What:** tag each `body_metrics`/`sleep_sessions`/`oura_daily` write with its source
  (`oura_ble` / manual / health_connect / oura_cloud) and make merge precedence explicit
  (manual > oura_ble > health_connect) instead of blind `COALESCE`-non-clobber.
- **Why:** today the rollup can't correct a day's BLE value once any value exists (COALESCE
  keeps the first writer); provenance enables "BLE overwrites prior BLE, never manual."
  Also the honest answer to "where did this number come from."
- **Where:** the upserts in `lib/data/postgres/slices/oura.ts` + adapter; the full Track-B
  sweep across every writer is the larger scope.

### 8. Lower priority / optional
- **Undecoded tags** `0x41 ring_start`, `0x5c user_information`, `0x85` (unknown) — non-metric
  boot/profile/unknown events; `0x41`/`0x5c` are named-but-not-decoded in `open_oura` too,
  `0x85` unknown upstream. Raw hex archived + re-decodable, so no urgency.
- **Sleep stages / hypnogram** — **correction (2026-07-08): the ring DOES emit its own
  hypnogram over BLE** (`open_oura` README: the history stream carries "the ring's on-device
  sleep stages"; `data-recovery-map.md`: tags `0x4b/0x4e/0x5a` = `sleep_phase_*` DEEP/LIGHT/REM/AWAKE,
  observed on a real Ring 5). The earlier "no hypnogram over BLE" was premature — drawn from an
  incomplete drain, not the source (same pattern as the REAL_STEPS correction above). The rollup
  now assembles `sleep_phase_5_min` + stage hours from these events (dormant until they arrive),
  and the Health hypnogram was redesigned into a banded ribbon. **What's left is on-device
  (backlog):** we've captured **zero** phase events so far, so we need a clean *worn-overnight →
  next-morning* drain and to confirm the forward-only sync cursor isn't advancing past the
  staging span before checking whether events land; then validate the 30 s-epoch / single-tag /
  timestamp assumptions against a real captured vector + the owner's pre-re-key Oura history, and
  Redecode-backfill. Batches with items 2/6 (already need a rebuild). Only if a genuine full-night
  drain still yields nothing is staging truly absent for this ring → fall back to a motion/HR
  model. Full findings: [`oura-ble-sleep-staging-findings.md`](oura-ble-sleep-staging-findings.md).
- **Battery time-series** (avg charging time / drain / health) — the plugin polls battery
  every 5 min but discards it; needs a POST path + APK rebuild (spec Part A).

---

## Key references
- **Canonical queue + protocol:** [`docs/implementation-backlog.md`](implementation-backlog.md)
- **Protocol knowledge base (byte layouts, GATT, auth, compute tiers):** the `oura-native-ble`
  skill (`.agents/skills/oura-native-ble/SKILL.md` / `.claude/skills/oura-native-ble/`).
- **Operations manual (failure matrix, cadence, maintenance, integrity runbook):**
  [`docs/oura-ble-operations.md`](oura-ble-operations.md).
- **Pipeline handoff / phase results:**
  `docs/superpowers/plans/2026-07-07-oura-ble-phase-3-4-results.md`.
- **Data-mapping plan (rollup design):**
  `docs/superpowers/plans/2026-07-07-oura-ble-data-mapping-and-tester.md`.
- **Extended-metrics spec (device metrics / workout timing / cross-domain):**
  `docs/superpowers/specs/2026-07-07-extended-metrics-capture-and-analysis-design.md`.
- **Session journal (full session-219 history of the recovery work):**
  `docs/overview/history-current.md`.
- **Rollup code:** `lib/data/postgres/adapter.ts` (`aggregateOuraRawSamples`,
  `redecodeOuraRawSamples`, `getOuraRawSampleSummary`); decoders `lib/oura-ble/decode.ts`;
  SpO₂ `lib/oura-ble/spo2.ts`; tester `components/oura-ble/`.

## Suggested first task for the next session
**Item 1 (workout HR chart).** It's the highest-value genuinely-new feature, fully
server/JS (no APK rebuild), the data is already captured and verified, and it's
self-contained. Write a short UI plan, then build + verify on the dev server and on-device.
