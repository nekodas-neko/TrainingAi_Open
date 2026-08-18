# Devices — domain index

**Owns:** every sensor and its transport — the Oura direct-BLE pipeline and reverse-engineered
protocol, the on-device Oura models, the Polar H10 chest strap, the Renpho scale, Health Connect
ingest, the native Kotlin plugins and foreground services, and the sync orchestration that drains
them.

**Does not own:** interpretation of what they measure. "The ring's step counter under-reports" is
here; "the Activity Score is wrong" is [`activity`](../activity/README.md). This is the largest
documentation cluster in the repo (~45 known issues, ~38 plans, 300+ model files).

## Code

| Area | Where |
|---|---|
| Oura direct BLE | `lib/oura-ble/` — `plugin.ts`, `sync.ts`, `decode.ts`, `clock.ts`, `raw-storage.ts`, `continuous-capture.ts`, `battery-soak.ts` |
| On-device models | `lib/oura-models/`, `docs/oura-models/` |
| Oura Cloud | **Removed 2026-08-13 (Q-224).** `lib/oura/` is local-only now: `ble-freshness.ts`, `cloud-freshness.ts` (the re-key constant), `contributors.ts`, `types.ts` |
| Chest strap | `lib/polar-ble/` |
| Scale | `lib/scale-ble/` |
| Native bridge | `lib/native/`, `components/oura-ble/` |
| Tables | `oura_raw_samples` (archival source of truth), `oura_daily`, `oura_daily_derived`; `oura_tokens` holds dead Cloud credentials, kept rather than dropped |

## Reference docs — read in this order

1. **[`docs/oura-ble-operations.md`](../../oura-ble-operations.md)** — the operations manual:
   failure-point matrix, sync-cadence policy, protocol-maintenance playbook, data-integrity
   runbook. **Read this before touching the pipeline**, and add a §1 matrix row for any new failure
   signature in the same PR that handles it.
2. [`docs/oura-ble-feature-playbook.md`](../../oura-ble-feature-playbook.md) — how to enable a new
   ring feature over the wire.
3. [`docs/oura-ble-remaining-work.md`](../../oura-ble-remaining-work.md) — what's left in the BLE
   programme.
4. [`docs/oura-ring-data-reference.md`](../../oura-ring-data-reference.md) — the Cloud v2 field
   reference (still the authority for field *names*).
5. [`docs/oura-ble-sleep-staging-findings.md`](../../oura-ble-sleep-staging-findings.md) ·
   [`docs/oura-ble-open-oura-audit-2026-07-08.md`](../../oura-ble-open-oura-audit-2026-07-08.md) ·
   the extracted-model inventory and bundle-provisioning docs (private archive — see
   `scripts/private-paths.json`)
6. [`docs/device-agnostic-source-architecture.md`](../../device-agnostic-source-architecture.md) —
   the raw-capable vs computed source tiers, and
   [`docs/../overview/history-2026-07-30.md`](../../overview/history-2026-07-30.md)
   for what tiers 1-2 actually landed as (Q-43): sleep has one write path with a required `source`,
   Health Connect stage intervals become a `sleep_phase_5_min` hypnogram, and the readiness
   composite runs without a ring. **Nothing in it has run against a real Health Connect provider.**
7. Reviews: [`docs/reviews/2026-07-07-oura-ble-system-review.md`](../../reviews/2026-07-07-oura-ble-system-review.md),
   [`docs/reviews/2026-08-03-cross-domain-bug-review.md`](../../reviews/2026-08-03-cross-domain-bug-review.md)
   — Q-56 (open, investigation-first): real sensor data landed on `body_metrics`/`oura_daily` rows
   dated up to 5 days in the future in production, `source_map` shows `oura_ble`/`scale_ble`
   provenance; one row is still live and wrong as of 2026-08-03. Shared with `body`/`sleep`.
7. Skills: **`oura-native-ble`** (protocol knowledge base), **`polar-h10-ble`**, **`oura-api`**
8. Scale: [`docs/scale-ble-connect-latency.md`](../../scale-ble-connect-latency.md) — the "priming"
   connect-latency investigation (open, parked 2026-08-01): what's already fixed (persistent
   connection, #972), the hardware constraint that bounds it (scale doesn't advertise while idle),
   on-device stage-timing data, and the parked Renpho-APK reverse-engineering angle.
9. Chest strap: [`docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md`](../../superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md)
   — Workstream E: why the pairing card reads "Connecting…" permanently (the label is derived from
   two booleans, and `active` is true all day because ambient mode runs all day), and why the
   native service's `stopSelf()` after ~4 min of failed attempts is invisible to the WebView
   (backlog Q-40). Task E3 is Kotlin — owner APK rebuild required.

**The Oura on-device + own-analysis program (D0–D7, owner-directed 2026-07-21) is live, not
historical — corrected 2026-07-30**, it was previously mislisted below as superseded alongside a
genuinely-dead doc it itself supersedes. Entry point:
[`docs/oura-ondevice-hybrid-handover.md`](../../oura-ondevice-hybrid-handover.md) (planning baton) →
[`docs/oura-ondevice-hybrid-implementer-progress.md`](../../oura-ondevice-hybrid-implementer-progress.md)
(live state, exact next tasks) →
[`2026-07-21-oura-ondevice-hybrid-master-plan.md`](../../superpowers/plans/2026-07-21-oura-ondevice-hybrid-master-plan.md).
~40% shipped (D0, D1, D5, D6, D2 Tasks 1–3); blocked on one owner action (on-device APK
verification of D2 Tasks 2–3) since 2026-07-27. Also the load-bearing piece of
[`docs/offline-first-target-architecture.md`](../../offline-first-target-architecture.md) — backlog
Q-29.

Genuinely superseded, kept for the trail only: `docs/oura-on-device-handover.md` (the *audit* baton
— superseded by the hybrid-handover doc above once the audit finished).

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

- [`docs/overview/entries/2026-08-18-ble-rekey-declared-not-inferred.md`](../../overview/entries/2026-08-18-ble-rekey-declared-not-inferred.md)
  — **Q-314, shipped 2026-08-18.** A ring re-key is now **declared** (`POST /api/oura-ble/rekey`),
  not inferred from a ds regression — a history re-drain produces the same shape, and reading it as a
  reset re-timed the whole sleep history twice (+12.17 h, +14.16 h). `EPOCH_RESTART_RATIO = 0.05`
  remains as a net for an undeclared re-key, validated only against the two re-drains it must not
  fire on, because there is no observed true reset in the data. No button yet — Q-317, Lane B.

- [`docs/superpowers/plans/2026-08-18-device-primary-compute.md`](../../superpowers/plans/2026-08-18-device-primary-compute.md)
  — **closing D2 Task 5/6 and D3 (2026-08-18, owner-directed focus).** The phone drains, stores and
  cursors correctly and then **nothing consumes it** — a repo-wide grep finds no caller for
  `getUnrolledRaw` or `markRolledUp`. Measured: `aggregateOuraRawSamples` is 1,110 lines with only **17
  DB-coupled lines**, so the device rollup is a port behind a `RollupIO` interface, not a rewrite.
  Two blockers verified today: production `script-src` has **no `wasm-unsafe-eval`**, so WASM cannot
  instantiate on the device at all; and the app's 0.22 vCPU is **unexplained** after three refuted
  hypotheses. Backlog Q-545 / Q-546 / Q-547.

- [`docs/superpowers/plans/2026-08-17-oura-raw-frame-packing.md`](../../superpowers/plans/2026-08-17-oura-raw-frame-packing.md)
  — **Q-541 implementation plan (2026-08-17).** Two tiers: `oura_raw_samples` stays exactly as it is
  for a 7-day hot window, a new `oura_raw_packed` holds everything older as sealed `bytea` blobs keyed
  `(user_id, epoch, tag, ds/864000)` — **ds, never a calendar day**, because wall time is derived
  through anchors and that derivation changes. **968 blobs replace 1,098,956 rows**; projected steady
  state ~70 MB against ~7.5 MB/day today. Ingest is untouched, so the cursor path takes no new failure
  mode, and the packer deletes a hot row only after re-reading its blob and proving the frames equal.
  **Tasks 0–3 have shipped** (v1.318.11 / v1.318.12): migrations 191–192, the codec
  `lib/oura-ble/frame-pack.ts`, and the two-tier reader
  `lib/data/postgres/slices/oura-raw-frames.ts` — which every raw-frame read now goes through,
  because a hot-only read silently returns a 7-day history and looks like data loss. Still inert in
  production: nothing writes a blob. Tasks 4–7 (packer, backfill, prune, `measured_at` sweep) remain,
  and the packer's delete is the only destructive statement in the plan.

- [`docs/superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md`](../../superpowers/plans/2026-08-17-db-storage-raw-samples-retention.md)
  — **where the 464 MB actually is, and what each way of shrinking it forecloses (2026-08-17).** The
  headline: `body_hex` — the thing the archival rule protects — is **26 MB of the 360 MB
  `oura_raw_samples` table (7.3%)**; 208 MB is indexes and ~106 MB is row overhead. Also establishes
  that the device's "14-day rolling window" **has not shipped** (`pruneRaw` has no caller and
  `rolled_up` is never set, so `oura_raw.db` is unbounded), and that it has **no working backup**
  (Auto Backup's 25 MB quota). Five options costed, two of them irreversible; the owner chose the
  three non-destructive ones (**A+B+C**) and declined both one-way doors. Backlog **Q-538…Q-542**,
  plus an amendment to Q-534 — these were renumbered from Q-530…Q-536 on merge, after a concurrent
  planning session turned out to hold the same block unmerged.

- [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](../../reviews/2026-08-17-failure-cells-running-the-app.md) — **the failure-cells lens, run against a live app, 2026-08-17** (Q-455 — a bodiless 500 from `/api/oura-ble/decoder-constants` when the constants read throws). Findings Q-450…Q-455; four areas recorded **clean**.

- [`docs/reviews/2026-08-17-repo-migration-architecture.md`](../../reviews/2026-08-17-repo-migration-architecture.md) — **the repo migration reviewed as an architecture change, 2026-08-17** (Q-459 — the rolling `apk-latest` release is delete-then-recreate, so the advertised APK download URL 404s during every native merge). Findings Q-456…Q-459; **no credentials leaked and the public-repo CI posture is correct**, plus five more clean results.

- [`docs/reviews/2026-08-18-health-connect-ingest.md`](../../reviews/2026-08-18-health-connect-ingest.md) — **the secret-gated Health Connect ingest route, driven for real, 2026-08-18** (Q-493 — the SEC-I3 brute-force gate keys on `x-forwarded-for`'s **leftmost, client-supplied** hop, so rotating one header bypassed it: fixed header → 1 limiter key at count 20, rotating → **30 keys at count 1, all reaching the secret compare**; 7 sites share the pattern. Q-494 — `{"date":"9999/12/30","weightKg":499}` took `getMostRecentConfirmedWeightKg` from **81 kg to 499 kg permanently**, and the ranked source merge is orthogonal to it because ranking is per column *per date*. Q-495/Q-496 — coercion laundering and a 500-on-invalid-date). **What the route gets right is stated first** — the gate precedes the compare, `safeCompare` is length-safe, the date regex takes both separators.
- [`docs/reviews/2026-08-18-write-surface-not-found.md`](../../reviews/2026-08-18-write-surface-not-found.md) — **nutrition/cardio/activity writes probed cross-user, and the whole write surface measured for the not-found answer, 2026-08-18** (Q-463 — `DELETE /api/phase-sets/[id]` answers a missing row with a 500 while `PUT` on the same resource answers 400). Finding Q-463; **cross-user protection holds across all four write pillars**, and the idempotent `DELETE` pattern is recorded as clean rather than filed.

- [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](../../reviews/2026-08-18-ingest-and-input-validation.md) — **the ingest surface and input validation, 2026-08-18** (the scale/ring ingest routes reject malformed frames and take no `userId` from the body; two sit behind `requireAdmin`). Findings Q-464/Q-465; **no ingest route accepts a `userId` from the body, and value validation rejects physiologically impossible input on every route reachable in the harness.**

- [`docs/reviews/2026-08-18-tier-a-enqueue-silence.md`](../../reviews/2026-08-18-tier-a-enqueue-silence.md) — **swallowed failures on write paths, 2026-08-18** (Q-486 — the four `queueMutation` calls in `workout-screen.tsx` are the only ones in the app that swallow, and all four are Tier-A; the surrounding layering is good and the last layer is silent). **Not reproduced** — needs a broken local SQLite on a device.
- [`docs/reviews/2026-08-18-implausible-value-silent-drop.md`](../../reviews/2026-08-18-implausible-value-silent-drop.md) — **the same out-of-range value sent down both write paths, 2026-08-18** (Q-485 — web refuses it with a message, sync-push writes the row, drops the field and reports `errors: []`, with no log and no `error_events` row; 12 of 14 value checks in `pushMutations` coerce silently while 2 throw). **The bounds themselves mirror correctly** — both paths share one validation module.
- [`docs/reviews/2026-08-18-outbox-under-failure.md`](../../reviews/2026-08-18-outbox-under-failure.md) — **the outbox pushed for real, including with the database stopped, 2026-08-18** (Q-475 — a DB outage returns HTTP 200 with per-item errors, so the client resets its 5xx backoff and dead-letters every queued mutation after ~43 minutes of downtime, leaving a per-item-only retry UI; Q-476 — a schema-rejected mutation is deleted with no badge, toast or retry). **The poison-pill rule itself holds** — poison isolated by outbox id, all four siblings written.

- [`docs/reviews/2026-08-18-illness-radar-calibration.md`](../../reviews/2026-08-18-illness-radar-calibration.md)
  — **the illness radar measured over 46 days: it has never produced an action-bearing flag**, peaking
  at 38 against a `watch` threshold of 40. The cause is not the thresholds — the temperature baseline's
  stored deviation is **253.7 against a true nightly sd of 13.5 (18.7×)**, a cold start the EMA is
  still digesting 40 nights on, and temperature carries **40%** of the weight. `FEVER_TEMP_Z = 2.5` is
  unreachable (it would need ~5 °C above baseline). The same `tempZ` makes **readiness's temperature
  contributor near-constant** (0 of 33 days with |z| ≥ 1.2). Filed **Q-506**: fix the baseline, do not
  touch the thresholds.

- [`docs/reviews/2026-08-18-ble-era-input-drift.md`](../../reviews/2026-08-18-ble-era-input-drift.md) — **the BLE-only Recovery Index refit, run on 42 nights, 2026-08-18** (Q-509 — the refit lands at 3.31 h against a shipped anchor of 5, and the anchor must **not** move: it and the input shrank by the same factor, so the hours estimator carries a multiplicative bias from the ~2× noisier BLE series. Q-510 — resilience is starved by the daytime-stress coverage check, which is persisted nowhere, and `worn_hours_ble` is NULL on all 96 rows).

## Open issues

```bash
grep -n '^### .*\[devices\]' projectOverview.md   # 45 entries today
grep -n '\[devices\]' docs/implementation-backlog.md   # 5 queue items today
```

Live at the time of writing (2026-07-30):

- ⚠️ **Chest-strap auto-reconnect (v1.257.0) is not device-verified** — both strap paths give up on
  an unreachable strap by design and nothing re-armed them, so a strap put on after launch needed
  an app restart. Fixed via `retryAmbient()` + a foreground tick; the BLE half cannot be exercised
  in the sandbox. See
  [`docs/../overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md).
- 🟠 **Sleep/HRV/breathing metrics changed scale at the BLE re-key** with no conversion — open.
- 🟢 **Clock anchors are stamped at server batch-receive time, not ring-capture time (Q-71,
  unblocked 2026-08-12)** — traced to `insertOuraRawSamples`'s `anchorUtc = new Date()`; the
  already-shipped `resolveDsToMs` robust-offset fix (Q-139) tests clean against real sleep history
  (uniform −3min) and just needs wiring to the sleep/HR/temperature converter. See
  [`docs/oura-ble-operations.md`](../../oura-ble-operations.md) I25 and
  [`docs/../overview/history-2026-08-12.md`](../../overview/history-2026-08-12.md).
- 🟡 **Eight device-owned `oura_daily_derived` columns have no producer** (Q-7b) — open.
- ⏳ **Ring clock anchors are append-only observations** — phase 1 of 2, currently inert.
- The D1/D2 on-device restore and raw-store tracks are largely **shipped server-side but
  device-gated**; most of this pillar's entries are unverified-on-device by nature.
- **Chest-strap pairing card now shows a live link-status dot** (v1.246.4,
  `components/settings/chest-strap-pairing.tsx` + `lib/live-hr/chest-strap-source.ts`'s
  `getChestStrapLinkStatus()`, 1 Hz poll) — not yet confirmed on-device.

## History

- [`docs/handoff-2026-08-18-platform-db-storage-and-device-primary-compute.md`](../../handoff-2026-08-18-platform-db-storage-and-device-primary-compute.md)
  — **the storage decision, the `disk_full` recovery (805 MB → 171 MB), and the D-track pivot.** Filed
  under `platform` because it spans the bill and the pipeline, so the `devices` glob below misses it.
  Carries the three refuted CPU hypotheses and the measured portability of the rollup (1,110 lines,
  17 DB-coupled) — both expensive to re-derive.

- Handoffs: `ls docs/handoff-*-devices-*.md` — plus
  [`docs/handoff-2026-08-02-cross-owner-bug-batch-investigation.md`](../../handoff-2026-08-02-cross-owner-bug-batch-investigation.md)
  (Q-40 — the chest-strap card stuck on "Connecting…"), filed under `cross` because it spans five pillars and so is not matched by the glob above.
  Also [`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](../../handoff-2026-08-03-cross-owner-bug-batch-triage.md)
  (Q-64 — voice logging needs native STT on Android; Q-68 — ring-cadence auto-detection false positives),
  same reason.
- Journal: `grep -rl 'BLE\|oura\|strap\|scale' docs/overview/entries/`

## Gotchas specific to this domain — all load-bearing


- **A native service that stops must announce it.** `PolarStrapService` gave up after ~4 minutes
  and called `stopSelf()` without emitting a status, so the WebView held its last-seen state
  forever and the card claimed it was still connecting (Q-40, #997). Any foreground service with a
  JS-facing state machine needs a final emit on every teardown path, including `onDestroy()`.
- **Never derive a link label from `active` + `connected`.** Ambient mode keeps `active` true all
  day, so that pair cannot tell "connecting" from "gave up". The label lives in
  `lib/live-hr/strap-link-label.ts` and reads the service's own state.
- **`measured_at` is indexed, so re-stamping it is never a HOT update.** `redecodeOuraRawSamples`
  re-writes it unguarded per page, which is where `oura_raw_samples`' 306 MB of indexes came from
  (740k rows, 1.3M updates, 19 HOT — measured against production 2026-08-02, backlog Q-46). Guard
  any re-stamp with `IS DISTINCT FROM`, and never assume a no-op UPDATE is free on this table.
- **The ring is on our own auth key; the Oura Cloud gets no new data from it, ever.** Never "fix"
  staleness by re-onboarding the official Oura app — it can force a firmware update that changes
  the BLE event encoding. Treat any re-onboard as a full protocol re-validation.
- **Byte layouts come from the `open_oura` Rust source / the `oura-native-ble` skill** — never
  memory, never Oura's public docs.
- **`oura_raw_samples.body_hex` is the archival source of truth.** Never prune or mutate it;
  protocol fixes ship as decoder changes plus a redecode pass.
- **The history cursor may only advance past events that are durably ingested (server 2xx).**
  Advancing on the ring's batch completion alone loses the drained span forever.
- **Decoders are infallible** — unknown bodies return `null` and the raw row still stores.
- **Kotlin changes need an owner APK rebuild** (`npx cap sync android && ./gradlew assembleDebug`)
  and are compile-gated only in the sandbox. JS/server changes ship via Railway with no rebuild —
  **state which half your PR touches.**
- **Scan by name/manufacturer-id `0x02b2`, never MAC** (rotating RPA), and Samsung's stack does not
  honour `autoConnect=true`.
