# Oura direct-BLE

> Moved verbatim from `CLAUDE.md` on 2026-10-05, when it was cut from 121 KB to the short form (release train, Phase 4). `CLAUDE.md` keeps each rule as one line pointing here; **this file keeps the reasons and the incidents behind them**, which is what makes a rule hold. Some passages describe the retired seven-agent process (lanes, batons, the backlog file) — where they do, the rule they carry still stands and the mechanism around it is history.

## Oura Direct-BLE — the ring is on our key; the pipeline has hard rules

Since 2026-07-07 the Oura Ring 5 is read **directly over BLE** (Kotlin foreground service →
native HTTP ingest → `/api/oura-ble/samples` → `oura_raw_samples`), re-keyed onto our own auth
key (Option A). Pipeline handoff: `docs/superpowers/plans/2026-07-07-oura-ble-phase-3-4-results.md`;
the protocol knowledge base — the `oura-native-ble` skill — **is no longer in this repository**
(Q-49 A4b removed it with the rest of Oura's material; it survives in the archived private repo, and
`scripts/private-paths.json` records why). **Failure-point matrix, sync-cadence
policy, protocol-maintenance playbook, and the data-integrity runbook live in
[`docs/oura-ble-operations.md`](../oura-ble-operations.md)** — read it before touching the
pipeline, and add a row to its §1 matrix for any new failure signature in the same PR that
handles it. Consequences and rules:

- **The Oura Cloud gets no new data from this ring, ever.** `/api/oura/sync` succeeding is
  not freshness — its data ends at the re-key. Never "fix" staleness by re-onboarding the
  official Oura app: it can force a firmware update that changes the BLE event encoding
  (the frozen firmware is what keeps our reverse-engineered protocol stable). Treat any
  re-onboard as a full protocol re-validation.
- **Byte layouts come from the `open_oura` Rust source — never memory, never Oura's public
  docs** (they don't cover the BLE protocol). The `oura-native-ble` skill was the second source
  and is gone from this repo; where a code comment still cites it, the Rust source is the one to
  reach for. Every ported builder/decoder is pinned to a captured test vector.
- **The raw bytes on the SERVER are the archival source of truth — but they are in
  `oura_raw_packed.blob` now, not `oura_raw_samples.body_hex`.** ⚠ This line named `body_hex` until
  2026-09-23 and had been wrong since the packer shipped (Q-541 Task 4); the correction is OR-126's,
  measured against production. **`oura_raw_samples` is a 7-day HOT WINDOW** (`HOT_WINDOW_DS`) —
  189,263 rows across an 8-day span holding **4.5 MB** of hex — and the packer moves each sealed
  bucket into one compressed blob, **verifying by read-back and unpack before it deletes anything**.
  The archive is **1,467 rows, 1,811,765 frames, 25 MB**. Readers
  (`lib/data/postgres/slices/oura-raw-frames.ts`) span both tiers, so nothing outside the packer
  needs to know which side a frame is on. **The consequence for anyone reasoning about retention:
  "drop `body_hex`" now means "drop a week of scratch", and "drop the archive" means
  `oura_raw_packed`.** The full measurement, and the case for keeping it, is
  [`docs/oura-raw-archive-retention-brief.md`](../oura-raw-archive-retention-brief.md).
  The ring's history buffer is finite and the sync cursor only moves forward — a decoder added later
  can only back-fill by re-decoding stored bytes, never by re-draining. Never prune or mutate the
  **server** archive; protocol fixes ship as decoder changes + a redecode pass. (Until D4's
  owner-confirmed cutover moves that archive to the device, at which point this PR rewrites the
  rule.) **The device-local copy is MEANT to be transient — a 14-day rolling window, per the owner's
  2026-08-02 retention decision — and ⚠ that window HAS NOT SHIPPED** (`projectOverview.md`):
  `pruneRaw` has no caller, and its predicate needs `rolled_up = 1`, which only D2 Task 5 sets.
  Measured on-device 2026-08-18: **209,326 rows, 0 rolled up, 31.2 MB**, growing at ~3.4 MB/day, and
  past Android Auto Backup's 25 MB quota so none of it is backed up. **Do not cite the device as a
  surviving copy of anything until that lands.** Local pruning is local-only and must never reach a
  server delete or a sync decision.
- **The history cursor may only advance past events that are durably ingested (server 2xx).**
  Advancing on the ring's batch completion alone silently loses the drained span forever
  (found in review `docs/reviews/2026-07-07-oura-ble-system-review.md` BLE-1). Re-sends are
  free — the table dedups on `(user_id, ring_timestamp_ds, tag, body_hex)`.
- **Decoders are infallible:** unknown/malformed bodies return `null` and the raw row still
  stores — never throw, never drop. `ring_timestamp_ds` is a monotonic deciseconds counter
  since the ring's own epoch (resets on re-key/dead battery), not UTC — wall-clock time
  comes from a `(ringDs ↔ utc)` anchor; never treat it as an absolute timestamp.
- **The ring radio/PPG sleeps when worn-idle** (wakes on charger, worn+moving, or during
  sleep) — live HR showing nothing at a desk is firmware power-gating, not a bug. Scan by
  name/manufacturer-id `0x02b2`, never MAC (rotating RPA). Samsung's stack does not honour
  `autoConnect=true` (proven on-device, v1.116.4) — direct connect + bounded same-device
  retry is the pattern.
- **Kotlin changes are compile-gated only in the sandbox** (no Android SDK; Gradle download
  is proxy-blocked) and **require a new APK — which CI builds and publishes**, see
  [`docs/canonical-runtime-android.md`](../canonical-runtime-android.md) "Getting a new APK"
  (download `apk-latest`; a local Gradle build is the fallback, not the default). JS/server changes
  ship via Railway into the WebView with no rebuild at all. State which half a PR touches.
  On-device is the only real verification for any BLE behaviour.

---

## Oura Ring — the Cloud integration is GONE (owner, 2026-08-13)

The user wears an **Oura Ring 5**, read directly over BLE — see **Oura Direct-BLE** above, the live
pipeline and the only one. The Oura *Cloud* integration was removed on 2026-08-13 and must never be
re-added (it can't succeed — the ring is on our key — and re-onboarding the official app risks a
firmware update that breaks the reverse-engineered protocol). What's deliberately kept (historical
Cloud data, the ranked per-field health-write merge, the six still-local `app/api/oura/*` routes)
and the full reasoning now live in
[`docs/oura-ble-operations.md`](../oura-ble-operations.md#6-oura-cloud-retirement--whats-gone-whats-kept-and-why-owner-2026-08-13)
§6, merged there with the rest of the Oura pipeline's standing rules.
