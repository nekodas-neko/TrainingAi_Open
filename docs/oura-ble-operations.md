# Oura Direct-BLE — Operations Manual

**Purpose: we own this integration end-to-end** — no Oura app, no Oura Cloud, a
reverse-engineered protocol, our own key on the ring. That means when anything changes or
fails, *we* are the vendor. This document is the standing reference for (1) every failure
point in the pipeline and its contingency, (2) the routine sync/drain cadence policy and
its tuning trade-offs, (3) the protocol-maintenance playbook for surviving firmware/app
changes, and (4) the data-integrity verification runbook. Keep it current: any new failure
signature observed on-device gets a row here in the same PR that handles it.

Companion docs: protocol knowledge base = `.agents/skills/oura-native-ble/SKILL.md` (byte
layouts, GATT map, compute tiers); pipeline handoff =
`docs/superpowers/plans/2026-07-07-oura-ble-phase-3-4-results.md`; standing rules =
CLAUDE.md § "Oura Direct-BLE".

**The one invariant everything below serves:** `oura_raw_samples` must end up holding
every event the ring ever recorded, exactly once, re-decodable forever (`body_hex` is
archival). The ring's finite history buffer is the only place data exists before ingest —
every contingency is ultimately about getting events off the ring before its ring-buffer
wraps.

**The cursor model (D2 Task 2, 2026-07-27):** two cursors, deliberately decoupled. The
in-memory `drainCursor` advances per batch so the drain keeps pulling at BLE speed; the
**persisted resume cursor** advances only when a batch is durably committed to the
device's own `oura_raw.db` — rows and cursor in **one transaction** under
`synchronous=FULL`, so a kill mid-drain rolls back both and the tail re-drains. Its home
is `oura_raw.db.sync_state['history_cursor_ds']`; the old SharedPreferences
`history_cursor_ds` is now a mirror kept for the status readout, and on drain start the
two are reconciled to their **minimum** (they can only disagree because one store died
independently, and only re-draining is safe). The server POST is a best-effort backup
that gates nothing — it marks its own batch's rows `synced=1` on a 2xx, which is what
later makes a row prunable. Re-draining an unconfirmed span is always loss-free:
`oura_raw.db` dedups on `(ring_ts, tag, body_hex)` and the DB on
`(user_id, ring_timestamp_ds, tag, body_hex)`.

*Before this change* the cursor advanced on the server's 2xx (v1.117.5+ / native ingest
v1.119.0+). That contract survives only as the fallback for a phone where `oura_raw.db`
cannot be opened at all (I22).

---

## 0. The ring key — the single-copy credential

**The 32-hex ring key exists in exactly one place: Android SharedPreferences on the phone.**
`OuraBlePlugin.kt` stores it under `key_hex` and its own comment states the intent — *"the key never
leaves SharedPreferences; never logged"*. It is not on the server, not in this repository, and not
in any log or crash report. That is the right design for a credential and it has one consequence
worth stating loudly:

> **Uninstalling the app destroys it.** The BLE service then logs `no key stored`, refuses to start,
> and the ring is unreachable — while the Devices screen still shows the ring as fine, because that
> card reads server data.

**Recovery is the `key.hex` file from the original `open_oura` re-key** (§ the Phase-0 runbook), on
whichever machine ran it. There is no other copy. Paste the 32 hex characters into
`/admin/oura-ble` → **Ring key** → Save → Start.

**Do not re-onboard the official Oura app to "fix" a lost key.** It re-keys the ring and can force a
firmware update that changes the BLE event encoding — the exact thing the frozen firmware protects
against. A lost credential becomes a full protocol re-validation, and the reverse-engineered
decoders may not survive it.

**Before any uninstall or device change:** confirm `key.hex` is in hand *first*. Observed
2026-08-17 — an uninstall was required to move to a stably-signed APK, the "what you lose" list
covered only the JS local store, and the ring went dark until the key file was found. Two other
things the same uninstall clears: the 14-day local raw window (harmless, the server holds the
archive and a Full re-sync re-drains) and any unsynced outbox mutation (**flush first** — pull-to-
refresh on More pushes the outbox; the Data & Sync "Sync now" button pulls only and flushes
nothing).

---

## 1. Failure-point matrix (ring → radio → link → drain → ingest → DB)

Each row: what breaks → how the system handles it automatically → the manual contingency
→ the real data-loss exposure.

### Ring / firmware layer

| # | Failure | Automatic handling | Manual contingency | Loss exposure |
|---|---|---|---|---|
| R1 | **Ring radio asleep** (worn-idle, RE4) — scan finds nothing | Patient 90 s scan windows + backoff (5 s→5 min), RE6 15-min cool-down | Put the ring on its charger, or wear it and move — both wake the radio | None: the ring keeps recording to its history while unreachable |
| R2 | **Ring battery dead** | Nothing can — the ring stops *measuring* | Charge it; watch the battery % in the tester/notification (keepalive polls every 5 min) | **Real gap** — unmeasured time is unrecoverable. Also resets the ring clock → new epoch (see R6) |
| R3 | **Measurement features OFF** (post-re-key state) | `enableMeasurementSequence()` runs on **every** connect (idempotent) — DAYTIME_HR + SPO2 → AUTOMATIC | "Enable measure" / "Feature status" buttons in Advanced verify the acks | The window before the first feature-enable connect records only system/debug events (why the first day's data was debug-heavy) |
| R4 | **Ring history buffer wraps** (ring unreachable or ingest down for too long) | Hourly drains while connected keep the resident backlog near zero | Reconnect/fix ingest promptly when an upload error shows; **measure the buffer horizon** (open item — after a multi-day gap, compare oldest drained `ring_timestamp_ds` against the gap start) | **The hard loss window.** Oldest unsynced events are silently overwritten. Everything else in this doc exists to keep this window empty |
| R5 | **Firmware OTA changes the protocol** | Cannot happen on our link: OTA comes from `api.ouraring.com` via the official app's OAuth — we never run it, so **firmware is frozen** | See §3 — the only drift vector is re-onboarding the official app; treat that as a protocol re-validation event | None while we stay off the official app |
| R6 | **Ring clock epoch reset** (fully-dead battery, factory reset/re-key) | Clock anchor is persisted per user (migration 115) and only moves forward; a backwards ring clock is NOT auto-anchored | After a deliberate re-key: run the re-key flow in §3 and expect a fresh epoch — old rows keep their old anchor; per-epoch anchor rows on reset remain an open hardening item (backlog #2) | Timestamps (not samples) for post-reset rows until a fresh anchor forms |
| R7 | **Live HR — ✅ RESOLVED (verified on-device 2026-07-09, v1.122.11).** The aggressive `liveHrStartSequence` (feature-mode CONNECTED_LIVE + BLE fast-HR) acked but emitted **zero** HR. Root cause via open_ring (static RE of the official app): "measure now" is the **DHR on-demand burst** = `SetFeatureMode(DAYTIME_HR, CONNECTED_LIVE)` **then `2f 03 26 02 02`** (sub-op `0x26`, not `0x22`). We'd only ever sent the `0x22` write — it acks but never starts the burst | **Shipped & working:** `triggerHrBurst()` sends the `0x26` sequence; `OuraRingSource` re-fires it every 10 s (ring auto-reverts ~20 s → continuous engagement) and on the manual **Measure** button. Emits `0x80`/`0x60` IBI → decoder → live HR (owner saw 68→77→64, "HR decoding OK", age 2–5 s). `drainHistory` stays a fallback | Read **still, between sets** — the PPG needs ~10 s without motion. Tester "HR burst" button + the card's diagnostic toggle show `0x80`/`0x60` counts if it ever regresses | None (all HR is also recorded to history and synced) |
| R8 | **Live-HR levers left on forever.** `liveHrStartSequence()` puts EXERCISE_HR into CONNECTED_LIVE and turns on BLE fast-HR mode; only `liveHrStopSequence()` undid them. Any session that never reached it — app killed mid-workout, service killed by Samsung battery management (L9), or the tester's **Live HR** pressed without **Stop HR** — left continuous fast-HR sampling on permanently, healed by no reconnect, app restart or service restart | **Fixed (Q-388, 2026-08-23, native — needs an APK):** `enableMeasurementSequence()` now ends with `EXERCISE_HR → AUTOMATIC` and `reqBleFastHrMode(false)`. Connect is the one path guaranteed to run, so the reset happens whether or not any stop path did. Idempotent, two extra frames on a connection already sending three | "Feature status" in the tester reads the ring's real mode back. Before this shipped the only cure was pressing **Stop HR** | None — a power fault, not a data one. Production `ehr_trace_event` was zero 21:00–08:00 when it was found, so it was a trap waiting rather than the drain being investigated |

### BLE link layer

| # | Failure | Automatic handling | Manual contingency | Loss exposure |
|---|---|---|---|---|
| L1 | **Scan failure / Bluetooth off** (`onScanFailed`) | Counted as a failed attempt → backoff retry loop | Toggle Bluetooth; check BLUETOOTH_SCAN/CONNECT permission | None (ring buffers) |
| L2 | **Connect failures — status 133/147** (Android BLE folklore class) | 500 ms stop-scan settle, bounded same-device retry (×2, 800 ms), 15 s connect timeout, then full re-scan + backoff | If a *new* signature appears: capture an HCI snoop log (Developer Options) before changing code — that's the diagnostic of record | None |
| L3 | **Samsung `autoConnect=true` misbehaviour** (instant deterministic status 135) | We never use it — direct connect only (proven on-device, v1.116.4) | Do not "fix" reconnect issues by re-enabling autoConnect on this device | None |
| L4 | **Radio wedge** (repeated rapid failures) | RE6: after 6 consecutive failures, 15-min cool-down (firmware watchdog recovers) | Bluetooth off/on; reboot as the second resort | None |
| L5 | **Bond lost** (ring has a single bond slot; CCCD write → insufficient-auth) | RE8: one `createBond()` attempt, then reconnect | First bond needs the ring **awake on its charger**; if bonding loops, remove the OS bond (Settings → Bluetooth → forget) and redo on-charger | None |
| L6 | **Auth REJECTED (wrong key)** | Terminal for the attempt; service keeps retrying (will keep failing) | Re-enter the key from `key.hex` in the tester. If the key is *lost*: factory reset via the official app + re-pair = **new epoch + unsynced on-ring data lost** — sync first if at all possible. Keep `key.hex` backed up in the password manager | Unsynced on-ring buffer, only in the lost-key worst case |
| L7 | **Rotating address (RPA)** | Scan matches name + mfr-id `0x02b2`, never MAC | Never introduce an address-based scan filter | None |
| L8 | **Drop mid-drain** | Drain aborts; batches already uploaded stay confirmed, the unconfirmed tail's resume cursor is untouched → reconnect backoff → auto-drain on next READY re-requests exactly that tail | — | None |
| L9 | **Service killed by Samsung battery management** | `START_STICKY` restart; auto-start on every app open; **battery-optimization exemption** (v1.119.2): the tester shows an "Allow background" prompt when the app isn't exempt (`isBatteryExempt`/`requestBatteryExemption`) | One-time: tap **Allow** in the tester (or Settings → Battery → add TrainingAI to **Never sleeping apps**). CompanionDeviceManager presence is the remaining queued hardening (backlog #1 chunk 2) | None (ring buffers) — but a long dead stretch eats into R4's window |
| L10 | **Phone reboot** | **Boot receiver** (v1.119.2): `OuraBootReceiver` restarts the service on `BOOT_COMPLETED`/`MY_PACKAGE_REPLACED` if a key is stored. Best-effort — a `connectedDevice` FGS isn't on Android's boot-start allowlist, so on newer Android the start may be blocked (logged) and the service instead comes up on next app open (CDM presence, the robust wake, stays queued) | Open the app once after reboot if the service didn't auto-start | None, same R4 caveat |

### Ingest layer (service → server → Postgres)

Every failure below converges to the same safe end state: **resume cursor held → span
re-drains → dedup absorbs.**

> **The cursor gate moved off the server (D2 Task 2, 2026-07-27).** The history cursor now
> advances on a durable **local** commit into `oura_raw.db` — the batch rows and the cursor are
> written in one transaction under `synchronous=FULL`, so they can't die independently. The
> server POST is a best-effort backup that gates nothing; it only marks its own batch's rows
> `synced=1` on a 2xx. So I2–I6 below still hold their *loss* column (a failed POST loses
> nothing), but a failed POST no longer holds the cursor or stalls the drain — the data is
> already durable on the phone. The new cursor-holding failures are I21/I22.

| # | Failure | Automatic handling | Manual contingency | Loss exposure |
|---|---|---|---|---|
| I1 | **No ingest URL configured** (fresh install) | Native drains are **refused** (better no drain than an unstorable one); the app shell calls `setIngestUrl(window.location.origin)` on every open | Open the app once | None |
| I2 | **No/expired session cookie** (POST throws / 401) | 3 retries (2/5/10 s) → batch fails → later batches of that drain are skipped (the cursor must never jump a hole) → `lastDrainCompletedAt` zeroed → keepalive re-drains within ≤5 min; error surfaced in the tester | Open the app (refreshes the session cookie via normal auth). If expiry recurs often, the planned fallback is a long-lived device token column checked by the route | None |
| I3 | **Network down / server 5xx / Railway deploy** | Same as I2 — retries, cursor held, ≤5-min re-drain retry | Nothing usually needed | None |
| I4 | **Server 429 (rate limit)** | Shouldn't trigger (in-order batches ≈ well under 120/min); retries absorb a burst | If it recurs, raise the route limit — never remove the retry | None |
| I5 | **Server 400 (payload rejected)** | Same cursor-hold path. Only reachable via a code bug (native hex-encodes real frames; Zod accepts hex ≤2048 chars) | A persistent 400 is a **bug to fix**, not to work around — the span keeps re-draining until the fix ships, which is the correct behaviour | None while the ring still buffers the span (R4 clock ticking) |
| I6 | **Process killed mid-POST** | The in-flight batch was never confirmed; resume cursor still points at it → re-drain | — | None |
| I7 | **Spontaneous (non-drain) frames fail to flush** | Re-queued at buffer front, capped at 2000; not cursor-protected | Recorded metrics also land in ring history → the next drain gets them | Live-only frames beyond the cap in a long offline stretch (bounded, and duplicated by history for recorded metrics) |
| I8 | **Duplicate delivery** (re-drain overlap, retry after a 2xx the client missed, native + legacy JS both posting during a version-skew window) | DB unique `(user_id, ring_timestamp_ds, tag, body_hex)` + `ON CONFLICT DO NOTHING`; `confirmStored` is monotonic | — | None (this is what makes re-sends free) |
| I9 | **Cursor/prefs lost** (app data cleared, reinstall) | Cursor 0 → next drain re-sends everything on the ring; dedup absorbs | Re-enter the ring key (same prefs file) | None for data still on the ring |
| I10 | **Unknown/undecodable event tags** | Stored with `decoded: null`, raw hex kept | Add a decoder + hit **Redecode** (`POST /api/oura-ble/samples/redecode` re-runs decoders over stored `body_hex` and re-aggregates) — **never** a re-drain | None — this is the archival design working |
| I11 | **Version skew** (new Railway JS + old APK, or new APK + old JS) | Tester detects native ingest via the status fields and disables its JS loop only then; `setIngestUrl` is individually try/caught; `confirmStored` stays available to legacy JS; dedup + monotonic confirm make double-posting harmless | Rebuild the APK when convenient | None |
| I12 | **Rollup/aggregation throws after store** (e.g. `Math.min(...hr)` RangeError on a full night's IBI samples, v1.119.1 fix) | The raw rows are inserted *before* the rollup runs; the rollup is wrapped in try/catch and its failure is logged (`aggregateError` in the response) but never fails the POST — the cursor still advances | Tap **Redecode** to re-run the rollup over stored `body_hex` once the decoder/rollup bug is fixed | None — raw `body_hex` is stored; only the derived `sleep_sessions`/`body_metrics` rows lag until Redecode. Before v1.119.1 this 500'd every batch and wedged the cursor |
| I13 | **Decoded string carries a NUL byte** (` `) — Postgres `jsonb` rejects it ("unsupported Unicode escape sequence"), the insert throws uncaught → 500 (v1.119.3 fix). Real culprit: `debug_data` (0x61) treats embedded NULs as printable and ASCII-decodes them | **Structurally impossible since Lever 1 (I15):** ingest no longer writes the `decoded` column, so no jsonb value is inserted at all. (The 0x61 debug tag is also dropped at ingest by the Lever-2 whitelist.) `decodeEventBody` stays wrapped so any decoder throw returns `null` at rollup time | None needed — automatic | **Was severe before v1.119.3:** one bad frame 500'd every later batch of the drain and wedged the cursor. Now unreachable |
| I14 | **`measured_at` collapses to drain time on catch-up drains** (seen in prod 2026-07-08: 6,038 overnight sleep events all stamped inside the 09:00 drain hour). At ingest, rows are stamped with the anchor *as it stood mid-drain* — during catch-up that anchor pairs an old ring timestamp with "now", shifting the whole backlog forward by hours | The rollup never reads stored `measured_at` (it maps `ring_timestamp_ds` through the *current* anchor), so sleep/HR/wear derivations stay correct; **Redecode re-stamps every row's `measured_at` from the current anchor** (v1.120.0) | Tap **Redecode** after any large catch-up drain (or re-key recovery) to repair the column | None for derived metrics; stored `measured_at` (tester inspector, ad-hoc SQL) is wrong between the catch-up drain and the next Redecode |
| I15 | **`decoded` JSONB no longer persisted** (Lever 1 ingestion culling) — the column roughly doubled per-row cost and is fully re-derivable from `body_hex` | Ingest writes `decoded = NULL`; the rollup (`aggregateOuraRawSamples`) and the tester's summary/raw readers decode from `body_hex` in-memory, coalescing `decoded ?? decode(body_hex)` so historical rows that still carry `decoded` are unaffected. Redecode no longer touches `decoded` (only re-stamps `measured_at`/`event_name`); the re-aggregate it triggers decodes from hex | None — a decoder fix still backfills via **Redecode** (the re-aggregate reads `body_hex`) | None: `body_hex` is untouched (archival). Nulling **historical** `decoded` is a separate data-dropping step (Lever 1b), gated confirm-first |
| I16 | **Lever 1b — nulling historical `decoded`** (data-dropping, admin-triggered only, never auto-run on deploy/migration). **✅ Device-verified 2026-07-15** — owner ran it on the S25 APK against production data (306,948 rows, 282,256 carrying `decoded`); confirm dialog showed the live count, `body_hex` stayed untouched | Admin-gated `POST /api/oura-ble/samples/backfill-null-decoded` (button in the tester's ① Data section) bulk-nulls `decoded` in bounded 500-row batches, **defaults to clearing the whole backlog in one call** (owner-requested — was capped at 20k/call, raised to 1M/call after the owner asked for "all at once"), rate-limited 4/min. `body_hex` is never touched; every nulled row already redecodes from it (Lever 1a's guarantee). Idempotent — re-pressing after `remaining: 0` nulls nothing further; if a future backlog somehow exceeds the per-call ceiling, `remaining` stays non-zero and pressing again resumes | Owner presses the button in `/admin/oura-ble` § Data, watches `decodedRows`/`decodedBytes` drop via the G-2 footprint card | None: `body_hex` untouched. The confirm dialog states the row count and that it can't be undone automatically before the first press |
| I17 | **Lever 1b clears `decoded` logically but the table's on-disk size barely moves** (owner-observed 2026-07-15: `oura_raw_samples` 229 MB → 230 MB after nulling 242,256+ rows, `decoded JSONB` reclaimable dropped 42 MB → 0 B). Root cause is Postgres MVCC, not a bug: `UPDATE … SET decoded = NULL` never shrinks a row in place — it writes a new tuple and leaves the old one (JSONB payload and all) as a dead tuple occupying its page until reclaimed | `decodedBytes: 0` (from `getOuraStorageStats`, §G-2) is accurate — it sums `pg_column_size(decoded)` over *live* tuples, and every live value really is null. The **table-size** figure (`pg_total_relation_size`, the per-table list) reports the physical file including not-yet-reclaimed dead tuples — nulling 240k+ rows in one pass creates 240k+ dead tuples autovacuum hasn't caught up on yet. Autovacuum reclaims dead-tuple space for *internal reuse* (future BLE ingest can grow into it instead of extending the file) but never shrinks the file itself | To actually shrink the file and recover the ~36–42 MB as real disk space: `VACUUM FULL oura_raw_samples` — rewrites the table into a smaller file. **✅ Lever 1c (shipped):** admin-gated `POST /api/oura-ble/samples/vacuum` (`repo.vacuumOuraRawSamples`, runs `VACUUM (FULL) oura_raw_samples` on a dedicated pool connection with `statement_timeout`/`idle_in_transaction_session_timeout` lifted to 0, then `release(true)` so the pool never reuses a timeout-disabled client) + a confirm-gated button in the tester's ① Data section (`DbFootprintCard`), rate-limited 2/min, returns before/after/reclaimed bytes. Reproduced locally on a synthetic bloat cycle: seed 8000 fat rows → 10.1 MB, null `decoded` (Lever 1b) → 11.8 MB (grew — dead tuples), `VACUUM FULL` → 2.0 MB (reclaimed 9.8 MB). Requires a brief `ACCESS EXCLUSIVE` lock (seconds on ~230 MB), so it stays a deliberate, owner-pressed button like Lever 1b — never automatic | None: nulling is safe/correct regardless of when (or whether) the file is ever physically compacted. Growth *rate* going forward should already be slower — new ingest can reuse the freed internal space — even before any `VACUUM FULL` runs |
| I19 | **Inline rollup slowness saturates the DB pool → sync starved** (prod 2026-07-21, HTTP logs: `POST /api/oura-ble/samples` 499 @ 29–30 s, `NO_SOCKET`/`TCP_INVALID_SYN` to prod_DB, "Sync failed" toast on home). Two compounding faults: (a) `aggregateOuraRawSamples` fanned its tag reads out as a **10-way `Promise.all`**, so one rollup checked out all 10 pool connections (`max:10`) at once and starved every other request — incl. the outbox `/api/sync/push`+`/api/sync/pull` — of a connection; (b) the rollup ran **inline before the response**, so a slow one pushed the POST past the native client's **30 s `readTimeout` → 499**. A 499 is non-2xx, so the resume cursor held and the ring **re-drained the same batch → re-ran the same 30 s / 10-connection rollup**: a self-sustaining retry storm that kept the pool pinned (→ the `NO_SOCKET`/`TCP_INVALID_SYN` DB-refusal signatures) | **Fixed (v1.188.1, server-side JS — ships via Railway, no APK rebuild):** (a) the 10 tag reads collapse into **one query** partitioned in memory → one rollup uses **one** connection, not ten; (b) the rollup is **time-boxed** (`ROLLUP_RESPONSE_DEADLINE_MS = 10 s`, well under the 30 s `readTimeout`) — the raw rows are already durably inserted before it runs, so the POST returns **2xx** whether the rollup finishes inline (`aggregated` populated) or hits the deadline (`aggregateCoalesced: true`, rollup completes in the background). A **per-user in-flight guard** prevents overlapping runs (concurrent `delete`+`upsert` on `sleep_sessions`/`body_metrics`) when batches arrive back-to-back | Tap **Redecode** if a night's derived rollup lags after a deadline-coalesced tail batch (raw `body_hex` is stored regardless). If pool starvation recurs, check for a *new* long-running rollup or a second high-fan-out query path before raising `max` (the `max × replicas < Railway limit` ceiling is load-bearing — CLAUDE.md) | None — raw rows stored before the rollup; a deadline-coalesced rollup still completes (background) or re-runs on the next drain/Redecode. Before the fix: no data loss either (the storm was dedup-safe), but sync was intermittently unusable and the DB neared its connection ceiling |
| I18 | **A later batch confirmed past an earlier failed batch's hole** (deep-review R-1, fixed 2026-07-20) — the `drainIngestFailed` flag was set on the *main* thread inside a `main.post{}`, but the next batch's guard runs on the *ingest* thread; the flag hadn't landed yet, so a batch that POSTed successfully *after* a failed one advanced the resume cursor past the failed span → silent, permanent loss of one ≤255-event history batch per incident. The I2/I5/I6 invariant ("the cursor never jumps a hole") was documented but not actually enforced across concurrent batches | Fixed in `OuraRingService.postDrainBatch`: `drainIngestFailed` is now `@Volatile` and set **synchronously on the ingest thread** the instant a POST fails (so the very next batch's guard sees it before it POSTs), plus a re-check of the flag before `confirmStored` in the success branch (defense-in-depth at the cursor-advance site — a batch that already stored holds instead of advancing once any batch in the drain has failed). Conservative by design: it can only ever *hold* the cursor further back and re-drain (dedup-safe), never advance past a hole | **Native — needs the owner APK rebuild to take effect** (`npx cap sync android && ./gradlew assembleDebug`); on-device verify a Full re-sync per §4 after any drain that logged a `batch ingest FAILED` | None after the fix: the failed span (and any later-stored batches of the same drain) re-drain next keepalive, dedup-absorbed. Before the fix: silent permanent loss of the failed span |
| I20 | **I19 recurred after #722 added the SleepNet ONNX inference to the rollup** (prod 2026-07-22, HTTP logs: `POST /api/oura-ble/samples` 200 @ 16 s then 499 @ 30 s, `POST /api/sync/push` 502, `/` 499, "Sync failed" toast — AND the sleep hypnogram vanished on recent nights). The I19 fix time-boxed the rollup to 10 s but still **awaited** that race inline; #722 made the rollup much heavier (neural sleep-stage inference, `sleepNetStages5Min`, runs inside `aggregateOuraRawSamples`), so under the concurrent read-herd from Home/Health (~15 aggregate GETs, each fanning 6–7 queries) the POST's own raw-insert + the up-to-10 s rollup wait pushed it past the 30 s `readTimeout` → 499 → cursor-hold → re-drain. The stalled rollup also never finished the sleep-staging write, so `sleep_phase_5_min` stayed null → **no hypnogram** | **Fixed (v1.195.5, server/client JS — ships via Railway, no APK rebuild):** (a) the rollup is now **fully backgrounded** — the POST returns as soon as the raw insert is durable and **never awaits** the rollup (the 10 s inline wait is gone); the run stays referenced via `rollupInFlight` (with its `.catch`/`.finally`) so it and the sleep-staging write still land. (b) the Home/Health aggregate-fetch burst is **concurrency-capped** (`runWithConcurrency(..., 4)` in `health-content.tsx`) so it can't starve the 10-connection pool the ingest insert needs. Cold-start piece already covered by the boot-time schema warm-up (v1.195.4, `instrumentation.ts`) | Tap **Redecode** if a night's hypnogram/derived rollup still lags after a drain (raw `body_hex` is stored regardless — the rollup re-runs over it). If it recurs, profile the rollup (is SleepNet inference the tail?) and consider moving inference off the ingest path or onto a queue before touching `max` | None — raw rows stored before the (now fully background) rollup; the sleep-staging write lands once the background run completes or on the next drain/Redecode. Before the fix: no data loss, but sync was intermittently unusable and recent nights showed no hypnogram until the rollup caught up |
| I21 | **Local commit fails** (`SQLITE_FULL` on a full phone, or any `oura_raw.db` write error) — D2 Task 2 | `insertBatchAndAdvance` returns false without advancing: rows and cursor are one transaction, so the batch rolls back whole. `drainIngestFailed` is set synchronously on the ingest thread (same ordering fix as I18) so later batches of that drain don't commit past the hole; `lastDrainCompletedAt` is zeroed → keepalive re-drains within ≤5 min. `lowDisk` is surfaced in the plugin status + `rawStats()`. The best-effort POST **still fires**, so Railway keeps receiving the span even while the local disk is unusable | Free space on the phone. Once Task 8's pruner exists it reserves headroom so a full phone can delete rolled-up raw to recover; until then it's a manual clear | None while the ring still buffers the span (R4 clock ticking) — and the server copy is unaffected |
| I22 | **`oura_raw.db` cannot be opened at all** (corrupt file, no space to create it) | The service logs `oura_raw.db unavailable`, reports `rawStoreOpen: false` in status, and **degrades to the pre-D2 contract** — cursor gated on the server's 2xx (I2–I6 semantics exactly as before). A broken local store must not wedge the drain, and it must not silently look healthy either | Check the tester status for `rawStoreOpen: false`. Clearing app data recreates the file (cursor → 0, everything the ring still holds re-drains, dedup absorbs) | None: the phone syncs with exactly the durability it had before D2 |
| I23 | **An asymmetric interruption dropped the earlier real sleep bout** (owner-reported 2026-08-03/04: phone calls woke the owner mid-night; `sleep_sessions.sleep_start` recorded 00:59 instead of the real ~22:32 onset. Verified against the actual decoded raw beats: a real ~130-min dense-sleep bout 22:32–00:42, a 15-min gap during the calls, then a ~6h40m bout from 00:57. `denseSensingSpan`'s `minNeighborRatio` (0.5) comparable-length test in `lib/sleep/sensing-span.ts` dropped the first bout outright — ~0.33x the second, below the ratio floor — reading as a later bedtime with abnormally little awake time instead of an interrupted night) | **Fixed:** `denseSensingSpan` now also bridges a substantial run into the kept span when it's separated from an already-kept run by a gap ≤`maxBridgeGapEpochs` (12 epochs / 1h), regardless of length ratio — a real interruption sits far under the 2h night-split threshold (`GAP_DS` in `adapter.ts`), so proximity alone proves it's the same interrupted night rather than a distant evening-activity burst (which the ratio test still correctly rejects, e.g. 07-21's 4h-distant burst). Re-run against the 08-03/04 raw beats: the fix correctly re-includes the 22:32 bout | Historical nights truncated this way before the fix keep their wrong `sleep_start` until reprocessed — re-running the rollup over stored `body_hex` (Redecode / a targeted backfill) re-derives them correctly, since `body_hex` is archival | None going forward once shipped. Historical nights stay wrong until backfilled — `body_hex` is untouched, so nothing is unrecoverable |
| I24 | **Step counts filed on days that have not happened** (prod 2026-07-30: five `body_metrics` rows carrying real ring step counts, dated up to **5 days ahead**; all five self-healed as their dates arrived, so the symptom expires by construction while the writer stays). Mechanism confirmed against production anchor rows 2026-08-04: `oura_ble_clock_anchors` re-stamps **mid-drain** with ring time running ~15 min ahead of wall time per step (e.g. `anchor_ds` +9,016 = 15.0 min of ring time in 4.6 real seconds), and the step path converted every frame with `measuredAtMs(ds, newestAnchorDs, newestAnchorUtc)` — bare linear extrapolation, unbounded in both directions. A frame sitting above a stale pre-drain anchor maps forward by the whole ds gap; over a drain replaying days of the ring's history buffer that is days into the future | **Fixed (v1.255.1, server JS — ships via Railway, no APK)**, description below is what shipped at the time. **⚑ `resolveDsToMs`'s semantics changed again under Q-139 (2026-08-08) — this row's "interpolate between bracketing anchors" description is stale, see I25.** Original fix: the step path now resolves a ds with `resolveDsToMs` (interpolate between the anchors bracketing the frame, else extrapolate from the **nearest**), and any frame still resolving past `now + INGEST_FUTURE_TOLERANCE_MS` (60 s) is **dropped, not clamped** — `body_hex` is archival and the rollup re-runs, so it is placed correctly on the next pass once a nearer anchor exists. Clamping to today would fold a future day's steps into today permanently. `runStepCounterPipeline` now takes a `toMs` resolver so it holds no second opinion on anchor policy | At rest the exposure is zero (0 frames above the newest anchor, 0 future rows) — the window exists only *during* a drain, so a static snapshot will never reproduce it. To check: `select count(*) from oura_raw_samples where ring_timestamp_ds > (select anchor_ds from oura_ble_clock_anchors order by created_at desc limit 1)`. **`toDate` in `aggregateOuraRawSamples` (adapter.ts:4655) is still single-anchor** and feeds sleep/HR/temperature — tracked as Q-71 | None. Affected days self-correct; the raw frames are never discarded, only skipped for that pass |
| I25 | **Sleep bed/wake times drift by tens of minutes, differently every time the rollup re-runs** (owner-reported 2026-08-12: one night's displayed bedtime read three different values — 23:46:54, 23:30:05, 22:50:07 — across three rollup runs over ~2.5 hours, each using whichever clock anchor happened to be newest). Root cause traced to `insertOuraRawSamples` (`adapter.ts:4655`): `anchorUtc = new Date()` stamps **server batch-receive time**, not true ring-capture time. The plugin drains a backlog in ~255-event sequential POSTs (§2), so during any drain several batches spanning very different `ds` ranges land within seconds of each other — each minted as its own anchor, all carrying an unknown, non-constant lag. `toDate`/`measuredAtMs` (single-newest-anchor extrapolation, still used for sleep/HR/temperature) has no way to distinguish a fresh, low-lag anchor from a stale, high-lag one, so the resolved time keeps changing as new anchors of varying quality arrive. **Naive bracket interpolation is NOT the fix** — tested against the 9 most recent real nights, every one moved *later* by 10–48 minutes (one by 79), because "bracketing" anchors are frequently from the same burst and don't bracket anything meaningful; this independently reproduces Q-139's original interpolation-compression finding | **✅ Fixed for sleep 2026-08-12 (Q-71) — future rollups only.** `aggregateOuraRawSamples`'s `toDate` now resolves every ds via `resolveDsToMs` (Q-139's p10-of-lag robust offset per epoch) over the full anchor list, not `measuredAtMs` off a single newest anchor. Tested against all 2,844 real epoch-2 anchors and the 9 most recent real nights before shipping: a uniform, stable **−3 minutes** on both edges — a real transport-lag correction, not noise, and structurally can't reproduce the 16–79 min swings (those came from swapping which single anchor was "newest"; a percentile over the whole epoch can't move that fast). Owner decided to also rewrite stored history, conditional on seeing this evidence first — done. Full writeup: [`docs/overview/overview/history-2026-08-12.md`](overview/history-2026-08-12.md) | **Tap Redecode** (full, not `dump`) in the admin oura-ble tester to rewrite historical `sleep_sessions` rows with the corrected clock math — session-auth-gated, only the owner can trigger it | None to raw data — `body_hex` is archival and untouched throughout. Historical `sleep_sessions.sleep_start`/`sleep_end` stay off by whatever the old single-anchor extrapolation produced until Redecode runs |
| I26 | **A rollup on the request thread starves the request landing beside it** — the residual of I19/I20 after Q-213 Stage 1. Narrowing the window took a real sync from 15–30 min to 2 min, and at 2026-08-13 15:47:33 a concurrent `POST /api/oura-ble/samples` still returned **500 after 27.6 s**, `getNewestOuraClockAnchorByUtc` failing with `Connection terminated due to connection timeout` while that rollup held the thread. `pg`'s connect timeout is a JS `setTimeout`: on a blocked loop it fires late and kills healthy connections while the DB answers in milliseconds. Backgrounding (the I20 fix) never addressed this — it stops the rollup holding its *own* response, not starving the next one | **Fixed (Q-213 Stage 2, server-side JS — ships via Railway, no APK rebuild):** the rollup runs in a `worker_threads` realm (`lib/oura-ble/rollup-worker.ts` → `.rollup-worker/rollup-worker.cjs`, esbuilt by `pnpm build`/`pnpm dev`) with its own `pg` pool at `PG_POOL_MAX=2`. Measured main-thread lag during a rollup: **185 ms of a 262 ms in-process run → 4 ms of a 439 ms worker run**. A missing or unstartable bundle **falls back to in-process**, i.e. to the I20 behaviour | Watch for `[oura-ble] rollup worker ready` once per process in the Railway log — its absence means the fallback is running, and the warn line above it says why. Railway CPU should stop showing sustained 1.0–1.6 plateaus; `/api/version` is the cheapest ongoing probe | None — raw rows are still stored before the rollup, and the worker's failures are reported through the same `.catch`/`reportServerError` path |
| I27 | **The rollup coalescing predicate meant "any batch"** — `isFinalOrSmallBatch` was `frames.length < 255`, written to mean "the drain's LAST batch". Per §2 a routine drain is 1–2 batches and almost always under 255 frames, so it read as "any batch" and bypassed the 8 s window nearly every time, running one rollup per batch instead of one per drain | **Fixed (Q-213 Stage 3, server-side JS — ships via Railway, no APK rebuild):** a trailing-edge debounce with a max-wait (`lib/oura-ble/rollup-debounce.ts`, 3 s after the batches stop, at least every 20 s during a stream that never pauses). The timer is `unref`'d so a pending run can never hold the process open | Nothing routine. If a night's derived rollup seems to lag by a few seconds after a drain, that is the debounce and is intended; tap **Redecode** only if it never lands | None — a skipped run is safe because `oura_rollup_state` persists the watermark and the next run starts from it, the same guarantee that lets a coalesced batch be skipped rather than dropped |

## 2. Routine sync & drain cadence policy (performance vs upload speed)

Current policy, encoded in `OuraRingService` (constants at the top):

| Event | Action | Why |
|---|---|---|
| Connect → READY | SyncTime → notifications → battery → feature-enable, then **auto-drain 3 s later** | Freshness costs nothing: the connection is already paid for; 3 s lets the feature-mode acks clear the write queue |
| Every 5 min connected (keepalive) | Battery poll + flush spontaneous frames + **re-drain if >60 min since last completed drain** | The battery poll doubles as link-liveness; hourly drains keep the ring-buffer backlog (R4) near zero |
| Drain running | `CONNECTION_PRIORITY_HIGH` (7.5–15 ms interval), back to `BALANCED` on completion; the drain loop pulls at BLE speed while batches upload behind it in order | Several-× faster drain; idle hold stays cheap |
| Batch upload fails | Later batches of that drain are skipped (cursor never jumps a hole); `lastDrainCompletedAt` zeroed → retry within ≤5 min | Bounded staleness without a tight retry loop |
| Batching | 255 events/GetHistory (ring-fixed) → one POST per batch, in-order single-threaded, 3 retries (2/5/10 s) | Ordered confirms, bounded memory, well under the route's 120/min limit |

**Tuning trade-offs** (change the constants, not the structure):

- **Fresher data:** lower `DRAIN_INTERVAL_MS` (60 → 15 min). Cost: negligible on the phone
  (a 15-min backlog is 1–2 batches), slightly more ring radio time. The ring measures on
  its own schedule regardless — draining more often does not produce more data.
- **Faster bulk upload** (first sync / post-gap recovery): the HIGH connection priority is
  the big lever (already automatic), and uploads already overlap the drain (pipelined
  behind it in order). Next lever if ever needed: parallel POSTs — deliberately not done;
  in-order confirmation is what makes the cursor math trivially safe.
- **Lower battery:** raise `DRAIN_INTERVAL_MS`, and/or drop the idle priority to
  `CONNECTION_PRIORITY_LOW_POWER` — accept slower first-command latency. Don't touch the
  5-min keepalive: it's the drop detector.
- **Never** trade away: the confirm-before-advance cursor rule, the dedup key, in-order
  batch confirmation, or the cool-down/backoff ladder (each encodes a lesson already paid
  for on-device).

## 3. Protocol-maintenance playbook — surviving change

We are the vendor now. The protocol can only change through a handful of doors, all of
which we control or can detect:

1. **Firmware is frozen while we stay off the official app.** OTA updates are delivered by
   the official app from Oura's cloud — never over our BLE link, and the ring-resident
   firmware key means nobody (including us) can flash it client-side. **Standing rule
   (CLAUDE.md): never re-onboard the official Oura app to "fix" anything.**
2. **If re-onboarding ever becomes unavoidable** (warranty, ring swap, deliberate
   decision): treat it as a protocol re-validation event. Before: **Full re-sync** and
   verify counts (§4) so nothing on-ring is unsynced. After: assume event encodings may
   have changed — reconnect with our key (re-key if the reset wiped it), drain a fresh
   sample, and check (a) unknown-tag share, (b) decode nulls on previously-known tags,
   (c) physiological plausibility of HR/temp. Any drift is fixed **in the decoders**
   (`lib/oura-ble/decode.ts` + a captured vector test), then **Redecode** back-fills from
   stored `body_hex` — never a re-architecture, never a re-drain.
3. **A new/replacement ring** = the full Phase-0 flow, documented in
   `docs/superpowers/plans/2026-07-07-oura-direct-ble-phase-0-results.md` +
   `…-phase-0-runbook.md`: onboard once in the official app (activates the ring) → sync →
   factory-reset from the app (no key needed) → `pair` installs our key → enable
   measurement features → verify with §4. New key, new clock epoch — back up the new
   `key.hex` immediately (password manager).
4. **Upstream knowledge sources:** the load-bearing bytes are already transcribed into our
   own code (`OuraProtocol.kt`, `decode.ts`) with pinned vector tests and the
   `oura-native-ble` skill — we do not *depend* on `Th0rgal/open_oura` staying available.
   It remains the richest reference for undecoded tags, so: keep a local clone/fork
   archived (owner task, one-time), and check it for community-found deltas when adding
   decoders.
5. **Drift monitoring is built into the tester:** rising unknown-tag counts, decode nulls,
   or implausible values are the early-warning signals (the data-mapping plan's remaining
   tester work makes unknowns explicitly visible per tag). If a *connect-layer* signature
   ever changes, the HCI snoop log (Developer Options) is the diagnostic of record —
   protocol-level evidence before code changes.
6. **This document is part of the product.** New failure signature → new row in §1, in the
   same PR that handles it. That is how the "we own it" promise stays true a year from now.

## 4. Data-integrity verification runbook (the 1:1 check)

Run after any recovery, re-key, decoder change, or protocol-touching PR — and once after
the native-ingest APK is first installed (to recover the spans the original design
skipped):

1. `/admin/oura-ble` → Advanced → **Full re-sync** (drains the ring's entire buffer from
   cursor 0). Loss-free and idempotent: the server dedups on
   `(user, ring_ts, tag, body)`.
2. **The drain does not need the screen — or the app — open, and it now tells you when it is
   done.** `OuraRingService` is a foreground service that drains on connect, re-drains hourly, and
   POSTs each batch itself (v1.119.0+). A full re-sync of a months-old backlog is thousands of
   events at 255/batch and takes a while; put the phone down. A full re-sync posts a notification
   when it finishes (Q-533) — *"Ring re-sync complete · N batches pulled and saved"*, or *"finished
   with errors"* if any batch failed to commit. It fires after the uploads settle, not when the BLE
   loop ends, so it is a statement about stored data rather than about pulled frames. If you do
   watch, the same facts are the `drain complete` line with **no upload-error line** and the
   "service uploaded N (M new)" counter settling. On an error the cursor held — fix the cause, tap
   Sync now (or wait ≤5 min for the automatic retry).
3. **Compare delivered vs stored:** the Advanced frame counter (what the ring delivered
   this session) against the summary's per-event counts (what the DB holds). They should
   agree for every biometric type — `green_ibi_quality`, `ibi_and_amplitude`, `hrv_event`,
   `spo2_r_pi`/`spo2`, temp — not just debug/system tags. (The original failure mode:
   counter said `green_ibi_quality×1520`, DB had 12 — that mismatch is the thing this
   check exists to catch.)
3b. **Compare delivered vs *locally* stored** (since D2 Task 2 the device is the primary
   store, so this is now the check that matters most): `rawStats()` on the plugin bridge
   reports `totalRows`/`unrolledRows`/`bytes` for `oura_raw.db`, and its per-event counts
   must match the ring's delivered counts for the same biometric types as step 3 —
   `green_ibi_quality`, `ibi_and_amplitude`, `hrv_event`, `spo2_r_pi`, temp. Then confirm
   `sync_state['history_cursor_ds']` advanced (the status readout's `cursorDs` mirrors it).
   Also confirm `rawStoreOpen: true` and `lowDisk: false` in the status — `rawStoreOpen:
   false` means the phone silently fell back to the old server-gated cursor (I22).
   **Kill-mid-drain check** (run once per native change to this path): force-stop the app
   partway through a drain, reopen it, let the drain resume, and confirm the tail re-drains
   with no loss and no duplicate rows — the local commit is transactional, so a killed batch
   must leave neither rows nor an advanced cursor behind.
4. **Span check:** "Data spans" should cover the whole expected window (e.g. last night's
   sleep) and the per-metric cadences should be physiological (HR every few s–min asleep,
   temp every ~1 min, HRV every 5 min).
5. **Rollup check:** after the drain, the post-ingest aggregation writes
   `sleep_sessions`/`body_metrics` rows (or tap **Redecode** to force a re-aggregate) —
   confirm the Health screens show the night's sleep/HRV/RHR, the SpO₂ card fills (an
   estimate derived from the ring's raw R via the Oura "SpO₂ Simple" quadratic — the
   Ring 5 never sends a firmware-computed %), the Home "Heart rate · today" chart plots
   the 5-min binned series (`oura_heartrate`, source `ble`), and the Health wear-time
   trend has a value for the day (`oura_daily.non_wear_time_sec`, derived from
   on-finger-only signal density in 15-min bins; skin-range temps ≥31 °C count,
   ambient-range temps don't).
6. Deep spot-check when it matters (SQL against prod):
   `SELECT event_name, count(*) FROM oura_raw_samples GROUP BY 1 ORDER BY 2 DESC;` and
   confirm biometric rows dominate over `debug_*` for a worn day; check
   `max(ring_timestamp_ds)` advances across two drains.

**Honest limit:** events the ring's buffer already overwrote before the first successful
ingest are gone — no procedure recovers what the ring no longer holds (R4). Everything
since the last wrap is recoverable at any time by Full re-sync.
