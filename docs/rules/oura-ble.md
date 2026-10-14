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

- **Until the switch-over, the Oura Cloud gets no new data from this ring.** The ring is on our own
  key, so the Cloud's data ends at the 2026-07-07 re-key. Re-pairing it with the official Oura app
  re-keys it, ends the direct connection and may update the firmware (which changes the BLE event
  encoding). That is the owner's switch-over step for the Oura API (#2808), done once and on
  purpose; an agent never does it, and never does it to "fix" staleness. Going back afterwards
  means a factory reset and a fresh `open_oura` pairing.
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
  2026-08-02 retention decision — and ⚠ that window is NOT ON yet**: `pruneRaw`'s predicate needs
  `rolled_up = 1`, which since #2579 is set from the SERVER rollup's watermark (meaning "folded on the
  server" — an interim until the device rollup, retired at #2302 step 2), and its only caller runs the
  prune behind the owner's `ta_ring_raw_prune` flag, OFF by default (ops-doc I30).
  Measured on-device 2026-08-18: **209,326 rows, 0 rolled up, 31.2 MB**, growing at ~3.4 MB/day, and
  past Android Auto Backup's 25 MB quota so none of it is backed up. **Do not cite the device as a
  surviving copy of anything until that lands.** Local pruning is local-only and must never reach a
  server delete or a sync decision.
- **The saved history cursor may only advance past events that are durably committed.** Since
  2026-07-27 that means committed to the phone's own `oura_raw.db`, rows and cursor in one
  transaction; the server POST is a best-effort backup that gates nothing
  (`docs/oura-ble-operations.md`, "The cursor model"). Server 2xx gating survives only as the
  fallback when `oura_raw.db` cannot be opened. Either way the cursor never skips a gap:
  advancing on the ring's batch completion alone silently loses the drained span forever (found in
  review `docs/reviews/2026-07-07-oura-ble-system-review.md` BLE-1). Re-sends are free — the table
  dedups on `(user_id, ring_timestamp_ds, tag, body_hex)`.
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

## Oura Ring — the Oura Cloud API is the ring's source (owner, 2026-10-11, #2808)

**History.** The Cloud integration was removed on 2026-08-13, when the ring had moved to our own BLE
key and every Cloud request could only 401. What was kept then (historical Cloud data, the ranked
per-field health-write merge, the local `app/api/oura/*` routes) is still in
[`docs/oura-ble-operations.md`](../oura-ble-operations.md#6-oura-cloud-retirement--whats-gone-whats-kept-and-why-owner-2026-08-13)
§6.

**Decision.** On 2026-10-11 the owner reversed that: the ring's data source moves from direct BLE
to the **Oura Cloud API**, per user over OAuth, because that is what most users will have. It is
built as a pluggable `DataSourceConnector` (`packages/shared/src/health/source-connectors.ts`) in
parts: #2858 connects an account and stores its tokens, #2859 adds webhooks and backfill, and later
parts re-rank the sources and re-base features on API data.

**Rules for the Cloud side:**

- **Only the connector module calls Oura Cloud.** Every request to `api.ouraring.com` or
  `cloud.ouraring.com` lives in `lib/oura/cloud/`. Routes and other code import it; they never build
  an Oura URL themselves. `lib/oura/__tests__/cloud-calls-only-from-connector.test.ts` enforces it.
- **Tokens are encrypted at rest.** `oura_tokens.access_token` and `refresh_token` hold AES-256-GCM
  ciphertext (`lib/oura/cloud/token-cipher.ts`), keyed by HKDF-SHA256 from `OURA_TOKEN_KEY` and bound
  to the user and the column. Without the key, connecting and reading tokens fail closed. A value
  that does not decrypt is treated as no connection, never sent to Oura.
- **Field names and scopes come from the pinned spec** (`.claude/skills/oura-api/`), never memory.
- **The raw BLE archive on the server stays.** Never prune or mutate it, before or after the switch.
  The rule above about the archive is unchanged by the move to the API.
