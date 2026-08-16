# Oura on-device + own-analysis — implementer progress & handoff (2026-07-26)

> **Updated 2026-07-30:** the D2 Tasks 2+3 device-verification gate (Full re-sync drain +
> kill-mid-drain, owner-run on the S25) has **passed**. Tasks 4+ (clock anchor, the on-device
> rollup port, neural WASM, D3 read-flip, D4 raw drop) are now unblocked — see the "🔧 D2 Tasks 2 &
> 3" section below for the evidence and two small caveats.
>
> **Task 4 (on-device clock anchor) — BUILT 2026-07-30**, branch `feat/oura-ondevice-clock-anchor`
> (pushed, no PR open). Kotlin compiles, debug APK assembles, 6 new JVM unit tests pass (pure
> epoch/reset decision logic, parity with `clock.test.ts`), full `pnpm typecheck`/`lint`/
> `npx vitest run` green. **Deviated from the plan's literal Task-4 spec**: the plan (written
> 2026-07-21) described a single mutable forward-only anchor (`advanceAnchor`); the codebase moved
> to a multi-observation, epoch-aware design in migration 161 before this session started (see
> `lib/oura-ble/clock.ts`'s own doc comment). Porting the stale single-anchor shape would have
> reintroduced the exact bug 161 fixed, so this instead ports `insertOuraRawSamples`'s current
> epoch/reset/observe logic (`adapter.ts`) to Kotlin, inside `insertBatchAndAdvance`'s existing
> durability transaction, plus a new `clock_anchors` table in `oura_raw.db` and a `getClockAnchors`
> bridge method for Task 5 to consume. **Not device-verified** — the SQLite read/write path has no
> Robolectric coverage in this project (JVM-tested logic only), so a real drain is needed to
> confirm `measured_at` lands correctly and the anchor observation matches server behavior for the
> same batches. See the branch's commit message for full detail.

**You are the implementer continuing this initiative.** Read this first, then
[`docs/oura-ondevice-hybrid-handover.md`](oura-ondevice-hybrid-handover.md) (the planning baton) and the
master plan it links. This doc tells you **exactly what's done, what's next, and how to work** so you can
start immediately.

> North star (one line): make the app **device-primary** — the phone owns raw ring `body_hex` and does all
> compute (incl. ML); Railway holds only a compact finished-form backup that never computes; the 437k-row
> raw table is eventually dropped. We own every metric except two kept Oura models (SleepNet, step_counter).
> Governing principle: **build once, build right — future-proof + safe, the good fix not the easy one**
> (owner's standing directive for every decision).

---

## ✅ DONE and on `main` (re-verified against real code 2026-07-23, not just prior doc claims)

| Phase | What shipped | PR |
|---|---|---|
| **D0** | ✅ **FULLY CLOSED.** `step_counter` is the ring's daily-steps source; the on-device column-order 0-bug was found + fixed (regression-tested); accuracy was confirmed against a counted 100-step walk (≈99.3-step match); the owner reviewed the historical-correction preview and executed it (14 days, 223,191 → 73,055 total steps, re-verified 0 remaining). **No further D0 work — do not reopen.** | #738, #755, #771, #774 |
| **D1 entry-gate review** | 3 code-grounded reviewers ran the mandatory "review before implementation" gate. Found **3 data-loss blockers**; all resolved in the plan's **"Second Review Outcome"** section (Phase-2 durability plan). **Read that section before touching D1.** | #740 |
| **D1·F1 (server)** | `getSyncDelta(userId, since, windowDays: number\|null = 90, pageLimit)` — `null` skips the 90-day floor for full-history restore. | #740 |
| **D1·F3 (server+client)** | `?mode=restore` pull-route unclamp + rate limiting; the client full-history restore driver (`restoreFromCloud` in `sync-engine.ts` — seeds cursor to epoch once, drains `pullDelta(restore=true)` to `hasMore=false`) + a "Restore from cloud" button under More → profile. | #752, #758 (v1.200.0) |
| **D1·B1 (server)** | Track-B server infra: migration **130** `oura_heartrate.updated_at` + `onConflictDoUpdate`; migration **137** `oura_bucket` server table + `upsertOuraBucket`. | #742 |
| **D1·Track B B2+B4+B5 (server)** | Dedicated single-connection, keyset-cursored Oura timeseries pull endpoint (per the F2 resolution — the keyset cursor lives ONLY here, never the shared cursor). | #754 |
| **D1·A1s/A2s/A3s/A4s (server push+pull)** | `oura_daily_summary` (full-set), `oura_daily_derived` (COALESCE + JSONB), `sleep_sessions` (source-merge + quarantine), `body_metrics` source-thread fix — all push branches + pull wiring. | #745, #747, #748 |
| **D1·A1c/A2c/A3c (client `applyDelta`)** | Local pull-apply branches for `oura_daily_summary`/`oura_daily_derived` (`sqlite-backend.ts:1020,1061`), sleep HRV/stage restore widening, and the `oura_daily` local `sync_status` column + clobber-guard. | #756, #759 |
| **D1·F4 (client push-confirm)** | `markSleepSessionSynced`/`markOuraDailySummarySynced`/`markOuraDailyDerivedSynced` added to `LocalStore` (narrow `UPDATE ... SET sync_status='synced' WHERE <key>=?`) + wired into `pushMutations`'s confirm loop for `sleep_session`/`oura_daily_summary`/`oura_daily_derived`. Unit-tested; inert until D2's local write path calls `queueMutation` for these domains. `oura_daily` excluded — it isn't in `SYNCED_MUTATION_DOMAINS` at all yet (no push branch, no envelope entry), so an arm for it would be unreachable; registering it as a real push domain is D2 work. | 2026-07-26 |
| **D6** | ✅ **Polar H10 comparison harness.** Generic comparator + ring-vs-H10 HR adapter + admin route/console. Sandbox-verified end-to-end; ⚠ real H10 spot-check (the actual D-verify gate) NOT yet run — see Known Issues. | v1.212.0 |
| **D5** | ✅ **Own daytime-HRV**, replacing Oura's `dhrv_imputation` ONNX in production. Per-user closed-form regression fit from night-time `0x5d` events; MET is an eval-time gate, not a fit feature. Throttled refit (never the live path); ONNX stays golden-tested but unreachable from production. Second D6 harness adapter + console. Sandbox end-to-end verified; ⚠ cold-start (needs real nights of ring wear) + real H10 spot-check NOT yet run — see Known Issues. | v1.218.0 |
| **D2·Tasks 2+3** | ✅ **Native `oura_raw.db` + local-commit cursor gate + WebView bridge.** `OuraRawDb.kt` (WAL + `synchronous=FULL` after open; `raw` with `UNIQUE(ring_ts, tag, body_hex)` + `sync_state`); `insertBatchAndAdvance` commits batch **and** cursor in one transaction and `postDrainBatch` gates on that, not the POST — the POST is a best-effort backup that marks only its own batch `synced=1`. Disk-full → cursor held + `lowDisk`; un-openable DB → degrades to the old server-2xx gate (never wedges). Bridge: `getUnrolledRaw`/`markRolledUp`/`markSynced`/`pruneRaw`/`rawStats` + TS interface. Kotlin **actually compiles and the debug APK builds** (an Android SDK was installed in-sandbox — the previous session's blocker is gone); 23 JVM tests pass incl. 3 new ones pinning the native frame split to vectors from the TS decoder; a cross-language parity test fails CI if the Kotlin/TS event-name maps drift; every SQL statement replayed against a real SQLite engine incl. kill-mid-drain rollback + dedup. ✅ **Device-verified 2026-07-30** — 694-batch Full re-sync drain completed clean, kill-mid-drain survived with no loss/dupes (see the "🔧 D2 Tasks 2 & 3" section below). | 2026-07-27 |
| **D2·Task 1** | ✅ **Local-store read/write accessors** for the on-device Oura tiers — `getOuraDailySummary`/`upsertOuraDailySummary`, `getOuraDailyDerived`/`upsertOuraDailyDerived`, `getOuraBuckets`/`upsertOuraBucket`, `getOuraHeartrate`/`upsertOuraHeartrate` added to `LocalStore`/`SQLiteLocalStore`. Sandbox-only (JS/server, no Android SDK needed) — the safe slice of D2 that doesn't require a device. **Inert**: nothing calls these yet, same posture as the earlier F4 mark-synced arms. Tasks 2 and 3 (native `oura_raw.db` + WebView bridge) are NOT started — see the native handoff section below. | #828 |

**Net:** every device-computed Oura form has a **server push + full pull + client pull-apply** path, plus a
working full-history restore driver. All server halves sandbox-tested; client halves NOT yet device-verified
(no owner S25 restore-proof run yet — see the owner checklist).

### ✅ F4 closed (2026-07-26) — no confirmed gaps remain in the originally-scoped client batch
All F4 mark-synced arms are shipped (see the DONE table above). Remaining Oura client work is D2-blocked:
local write helpers, the on-device rollup writer, `oura_daily`'s push-domain registration, and Track-B
push/B3 (see "Remaining tasks" below).

---

## 🚫 Pins — do NOT undo (from the reviews)

1. **F2 cursor: the shared scalar `−1ms` overlap cursor stays UNCHANGED.** Do NOT add a cross-domain
   `(updated_at,id)` tiebreak to the shared `resolveSyncCursor` — it silently skips rows (the shared cursor is
   one scalar across ~14 domains). The keyset `(updated_at,id)` cursor belongs ONLY inside Track-B's dedicated
   single-domain endpoint. Day-grained domains stay stall-free via **B4** (per-row monotonic `updated_at`).
2. **B1 write uses `onConflictDoUpdate`, not DoNothing** (already done) — a re-decoded value must reach the
   backup.
3. **B3 keeps random-UUID mutation ids + collapse-on-enqueue** — a deterministic `domain:date` id races the
   in-flight push and loses a re-rolled day (CLAUDE.md rule).
4. **Migration numbers move fast with multiple agents landing PRs in parallel — never trust a number
   written in this doc.** `ls lib/data/postgres/migrations/` against fresh `main` immediately before
   claiming one; as of 2026-07-29 the tree already has a live collision (`161_activity_log_walk_segments.sql`
   / `161_clock_anchor_epochs.sql`, both merged, neither Oura-D2-related) — same class CLAUDE.md already
   warns about (081×2, 087×2). Do not add a third.
5. **Shared write-fn per domain** (CI `check-push-mutations`): push branches call `this.upsertX(...)`, never
   `this.db.`/raw `sql`.
6. Neural port = **SleepNet + step_counter** (NOT dHRV). D5 (own daytime-HRV) lands before D2's neural port.
   H10 is a **test instrument only**.

---

## ▶ Remaining tasks — dependency order, with scope + gating

> **Re-verified 2026-07-26 against real code (grep, not doc claims).** F3-server+client, Track B B2/B4/B5,
> A1c/A2c/A3c `applyDelta`/restore-mapper/`oura_daily`-clobber-guard, and F4 mark-synced arms are **all
> confirmed done** (see the DONE table above). Nothing remains from the originally-scoped device-gated
> client batch except B3/B5 below. Always re-grep before trusting a "remaining tasks" list in this doc; it
> goes stale fast with multiple agents landing PRs in parallel.

Legend: **[S]** sandbox-buildable + CI-testable · **[D]** device-gated (implement + flag NOT-verified,
`getLocalStore` is null on web) · **[D2-blocked]** push direction needs D2's on-device rollup (no local writer
exists yet).

> **Ordering correction (2026-07-26):** an earlier revision of this list put D2 before D6→D5. That's
> backwards — the master plan's dependency graph is **D6 → D5 → D2**, specifically so dHRV is never
> WASM-ported in D2 only to be deleted right after in D5. Re-ordered below to match the graph.

### Next up
1. ✅ **D6 — Polar H10 comparison harness [S, gate is D-verify] — SHIPPED 2026-07-27 (v1.212.0).**
   `lib/oura-comparison-harness.ts` (generic comparator) + `lib/oura-comparison-harness-adapters.ts`
   (ring-vs-H10 HR adapter) + `getOuraHeartrateBySource` repo read + `GET /api/oura-ble/comparison-harness`
   + the Comparison harness admin console. Sandbox-verified end-to-end (unit tests, DB-backed repo test,
   live `pnpm dev` run against local Postgres). **⚠ D-verify gate NOT yet run** — no real H10 spot-check
   burst has happened; the ±5bpm tolerance is a first tripwire, unvalidated until the owner runs one. See
   `docs/overview/entries/2026-07-27-d6-comparison-harness.md` and the `projectOverview.md` Known Issues row.
2. ✅ **D5 — own daytime-HRV [mixed, needs D6 done] — SHIPPED 2026-07-27 (v1.218.0).**
   `lib/health/daytime-hrv-model.ts` (extraction/fit/evaluate — closed-form 3×3 OLS on this user's
   own night-time `0x5d` events; MET is an evaluation-time gate, not a fit feature) + migration 149
   (`oura_daytime_hrv_model`) + a throttled refit step in `aggregateOuraRawSamples` (never the live
   `body-battery` path) + `buildDaytimeStressSeriesFromModel` (sibling of the ONNX
   `buildDaytimeStressSeries`, which stays golden-tested but is no longer called from production) +
   a second D6 harness adapter (`dhrvVsH10Adapter`) + its own admin console. Full test coverage;
   sandbox end-to-end verified (seeded a model + real ring/H10/temp data, confirmed both the
   comparison-harness route and the live `body-battery` route produce real values). **⚠ Cold-start
   + NOT device-verified** — the model needs a few real nights of ring wear before it produces
   anything (same "not enough data" outcome as before, not a regression), and the actual H10
   spot-check validation gate hasn't run — it's gated on gate 1 clearing first. See
   `docs/superpowers/plans/2026-07-27-d5-own-daytime-hrv.md` and the `projectOverview.md` Known
   Issues row.

### Then (per the master-plan graph)
3. **D2 — Tasks 1, 2 and 3 ✅ ALL SHIPPED** (#828, #832). Native `oura_raw.db` + local-commit
   cursor + WebView bridge all landed 2026-07-27 — see the DONE table and the "🔧 D2 Tasks 2 & 3"
   section below. **✅ BLOCKING GATE CLEARED 2026-07-30** — owner ran a Full re-sync on the S25
   (694 batches, "drain complete: batches=694 bytesLeft=0") and the kill-mid-drain test (force-closed
   the app mid-drain, reopened, drain resumed cleanly with monotonically-advancing cursor and no
   errors — the app's own log shows "ingest URL configured" at the reinit point with batches
   continuing to commit "N of N" on both sides of it). **Two sub-checks from the original runbook
   were not directly confirmed and are not owner error — the admin console has no UI for them**:
   `rawStats()`'s `rawStoreOpen`/`lowDisk` fields and the `getUnrolledRaw`/`markRolledUp` bridge
   methods are wired in `lib/oura-ble/plugin.ts` but nothing in `app/admin/oura-ble/` calls or
   renders them. Treated as passed by inference — "batch committed locally: rows=N of N" only
   appears when the native raw store is open and writable (ops-doc I22: an unopenable store
   silently falls back to the old server-2xx-gated cursor, which would not produce this log line at
   all) — but the missing panel is a real gap, tracked as its own small backlog item so a future
   session builds it rather than repeating this inference. **Task 4 (clock anchor) — BUILT
   2026-07-30**, see the note at the top of this doc; not device-verified. **Task 5 (port the
   deterministic rollup to the WebView) is next** — see the "Handover — what's left" checklist in
   `docs/implementation-backlog.md`'s Oura on-device section for the full ordered list (Tasks 5-9,
   then B3/B5, D3, D4, D7). CSP prerequisite for the neural half (Task 6): add `wasm-unsafe-eval` to
   the prod `script-src` and assert WASM instantiates under the real prod CSP on the S25 before any
   neural work. Detail doc: `docs/superpowers/plans/2026-07-21-oura-raw-on-device-phase-1.md`
   (amended by the master plan's Review Outcome).
4. **B3 (Track-B replace-by-day outbox) + B5 (concurrent-pool load test)** — confirmed NOT done (grepped:
   `oura_heartrate`/`oura_bucket` are absent from `SYNCED_MUTATION_DOMAINS` in `lib/sync/mutation-schema.ts`;
   no load-test file exists). B3 is **[D]/[D2-blocked]** — no point wiring the outbox push side before D2 gives
   it something to push; when it's time, use collapse-on-enqueue keeping random-UUID ids (the F2/B3 pin above),
   and add the two domains to `SYNCED_MUTATION_DOMAINS`. B5 can run **[S]** once B2's endpoint has real traffic
   to load-test against — low priority until closer to D2/D3.
5. **D3** — silent read-flip to local-first (data-presence gate) + single-writer flip. Needs D1+D2.
6. **D4** — server-raw cutover: pull-to-device + completeness audit + **staged drop of the 437k table**.
   **⚠ DESTRUCTIVE + OWNER-CONFIRM. Do NOT drop without: six forms in SyncDelta + a device-verified
   wipe→restore artifact by SHA + `oura_raw.db` own-reconcile + a fail-closed completeness audit.** Same PR
   rewrites the CLAUDE.md "never prune body_hex" rule. **STOP and get the owner's explicit confirmation.**
7. **D7** — delete dormant oracle ONNX models + `onnxruntime-node` from serving (~T+3mo). Keeps SleepNet +
   step_counter.

---

## 🔧 D2 Tasks 2 & 3 — ✅ BUILT (2026-07-27) + ✅ DEVICE-VERIFIED (2026-07-30)

**The sandbox blocker is gone.** The earlier claim that Kotlin can't be built here was wrong in one
respect: `dl.google.com` is reachable through the proxy, so the Android SDK (cmdline-tools +
platform 36 + build-tools 36) installs fine, `/opt/gradle` already matches the wrapper's 8.14.3,
and `gradle :app:testDebugUnitTest :app:assembleDebug` produces a real debug APK. Any future
native session should install the SDK rather than assume it's impossible. What still genuinely
cannot happen here is anything involving **the ring or the phone** — no BLE radio, no device
SQLite at runtime, no drain.

**What shipped** (both tasks, one PR — see the DONE table): `OuraRawDb.kt` + the rewired
`postDrainBatch` + the five bridge methods + the TS interface.

**What was verified in-sandbox:** Kotlin compiles; debug APK assembles; 23 JVM protocol tests pass
(3 new: the native frame split is pinned to vectors generated by running the TS authority
`historyEventFromHex` over the same hex, so a native row and a server row for one frame are
byte-identical and dedup against each other); a cross-language parity test reads the Kotlin
`EVENT_NAMES` map out of the source and fails CI if it drifts from `decode.ts`; and every SQL
statement in `OuraRawDb` was replayed against a real SQLite engine (`node:sqlite`) covering the
single-transaction insert+cursor, the **kill-mid-drain rollback** (neither rows nor cursor
survive), dedup on re-drain, cursor monotonicity, the prefs/DB `min()` reconcile, the
no-split-ring_ts read, and prune eligibility.

**Owner-only checks, run 2026-07-30 on the S25 with the ring:**
1. ✅ **Full re-sync drain.** "drain complete: batches=694 bytesLeft=0", counts matched, no
   sustained upload errors (one `ingest POST failed (attempt 1/4): timeout` self-recovered on
   retry — the designed retry-with-backoff behavior, not a failure).
2. ✅ **Kill-mid-drain.** Force-closed the app partway through a second Full re-sync, reopened.
   Log shows the reinit marker ("ingest URL configured") with batches committing "N of N" cleanly
   on both sides of it and the cursor climbing monotonically with no gaps or repeats — no evidence
   of lost or duplicated rows.
3. ⚠️ **Task 3 (`getUnrolledRaw`/`markRolledUp`) — not directly confirmable.** No admin-console UI
   calls these bridge methods; `rawStats`/`getUnrolledRaw`/`markRolledUp` exist only in
   `lib/oura-ble/plugin.ts`'s type interface. **New backlog item filed** to add a status panel.
4. ⚠️ **`rawStoreOpen`/`lowDisk` — not directly confirmable, same UI gap as #3.** Inferred true:
   "batch committed locally: rows=N of N" (seen throughout both drains above) only logs when the
   native store is open and writable — ops-doc I22 says an unopenable store silently falls back to
   the old server-2xx-gated cursor, which would not produce this log line at all.

**Gate cleared — Tasks 4+** (clock anchor, rollup port, neural WASM, tier-ladder, prune, storage
readout) **may now start.** Note `measured_at` is still written NULL until Task 4's clock anchor
work completes (ring deciseconds are a counter from the ring's own epoch, not wall-clock), which
also means the prune has nothing eligible yet.

<details><summary>Original handoff spec (kept for reference)</summary>

**Task 2 — native `oura_raw.db` + local-commit cursor gate**
- Create `android/app/src/main/java/com/trainingai/app/oura/OuraRawDb.kt`: opens `oura_raw.db` via
  `android.database.sqlite.SQLiteDatabase`, `PRAGMA journal_mode=WAL` + `PRAGMA synchronous=FULL`
  set **after** open (never inside an upgrade transaction — same rule as the local SQLite migrations
  in CLAUDE.md). Two tables: `raw` (ring_ts/tag/event_name/body_hex/measured_at/rolled_up/synced,
  `UNIQUE(ring_ts, tag, body_hex)`) and `sync_state` (k/v, `k='history_cursor_ds'`).
  `insertBatchAndAdvance(rows, batchMaxDs)` inserts (`INSERT OR IGNORE`) **and** advances the cursor
  inside one transaction — the cursor and the data must live-or-die together (this is the exact bug
  class that bit the app twice before on local SQLite migrations: a durable cursor pointing past
  data that never actually landed is silent data loss).
- Rewire `OuraRingService.kt`'s `postDrainBatch` (~378-409) to gate the cursor advance on the
  **local** commit, not the server POST's 2xx — the POST becomes a best-effort backup that also
  flips `synced=1` on success (load-bearing for Task 8's prune later; the WebView never sees the
  POST's result in Phase 1, so native has to self-mark it).
- Handle `SQLITE_FULL` by returning false without advancing, and surface a low-disk flag.
- Compile-gate: `npx cap sync android`, confirm Kotlin compiles as far as this sandbox allows —
  full build is device-only.
- Device verification (the actual gate, cannot be skipped or simulated): rebuild the APK
  (`npx cap sync android && ./gradlew assembleDebug`), run the ops-doc §4 full re-sync runbook
  (drain the ring, confirm `oura_raw.db.raw` row counts match the ring's delivered per-event
  counts), then a kill-mid-drain test (force-stop the app mid-drain, reopen, confirm the
  unconfirmed tail re-drains and dedups with no loss and no dupes).

**Task 3 — WebView bridge to read/mark/prune raw rows**
- Add bridge methods to `OuraBlePlugin.kt`: `getUnrolledRaw({limit})`, `markRolledUp({ringTsList})`,
  `markSynced({ringTsList})`, `pruneRaw({olderThanMs, reserveBytes})`, `rawStats()`. The WebView
  must never open `oura_raw.db` directly — one SQLite library owns the file (avoids a two-writer
  `SQLITE_BUSY` on a shared WAL).
- Declare the matching TS interface in `lib/oura-ble/plugin.ts`, guarded so it no-ops on web where
  the plugin is absent (same pattern as every other Capacitor-only method in that file).
- Device verification: confirm `getUnrolledRaw` returns freshly-drained rows and `markRolledUp`
  makes a second call return fewer.

**What NOT to do:** don't attempt Tasks 4+ (clock anchor, rollup port, neural WASM, tier-ladder,
prune, storage readout) until 2 and 3 are device-verified and merged — they build on the raw store
this creates. Don't skip the kill-mid-drain test; it's the one that catches the exact
durability class of bug this task exists to prevent.

</details>

---

## 🧭 How to work (match what's been done)

- **Branch:** develop on `claude/oura-ondevice-hybrid-5xycdr`. **One focused PR per task.** After each merges,
  restart from fresh main: `git checkout main && git fetch origin main && git reset --hard origin/main &&
  git checkout -B claude/oura-ondevice-hybrid-5xycdr origin/main`.
- **PR → CI → merge:** open a PR to `main`; CI = Lint, Type Check(in Build), Tests, Build, Custom Rules,
  Migration Check. A **server-only, non-destructive, CI-green** change merges without asking (squash). Confirm
  base is `clean` + not drifted before merging. **Destructive/auth/secret changes → owner-confirm first.**
- **Local test loop:** `export DATABASE_URL="postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433"`
  (unset the prod `DATABASE_URL`/`DATABASE_SSL` first — the session hook does this). Then
  `pnpm exec tsc --noEmit` (expect **2 pre-existing `onnxruntime-web` errors** — that package isn't installed
  in the sandbox; not yours), `pnpm exec eslint <files>`, `node scripts/check-push-mutations.js`,
  `node scripts/check-reconcile.js`, `npx vitest run lib/data/postgres lib/sync`. DB-backed tests skip without
  `DATABASE_URL`; run migrations first with `node scripts/local-db/migrate.js`.
- **Reference-map technique (recommended for each intricate task):** before editing, dispatch ONE
  `general-purpose` research agent to produce a literal file:line implementation map (see the A1/A2/A3 maps —
  they were spot-on). Keeps the heavy reading out of your context. Then implement from the map + test.
- **Every PR keeps the journal/backlog current:** add a `docs/overview/entries/YYYY-MM-DD-<slug>.md` file
  (never prepend to a shared history file), update the D1 progress note in `docs/implementation-backlog.md`,
  add a `projectOverview.md` Known-Issues row for anything device-gated, and bump `package.json` +
  `lib/changelog.ts` only if user-visible (the server-half work is NOT user-visible → no bump).
- **Device-gated items:** implement, then STOP and give the owner exact S25 steps (`docs/device-smoke-checklist.md`
  + ops-doc §4), OR add a NOT-verified Known-Issues row and clearly flag it. Never mark device-gated "done"
  from a green sandbox.

---

## 📱 Owner's S25 checklist (the only things that need the owner)

1. ~~D0 step sanity~~ ✅ **DONE (2026-07-23)** — confirmed accurate + historical backfill executed. D0 closed.
2. **Local DB v17/v18 upgrade:** open the app once, confirm no dead-store banner + history intact.
3. **D1 restore proof — ready to run now** (the client restore driver + "Restore from cloud" button shipped
   in #758/v1.200.0): on the S25, **More → profile → "Restore from cloud"**. Confirm: (a) it drains without
   erroring, (b) sleep nights come back **with HRV/RHR/stage data intact**, not just duration (the R6 gutting
   fix from #756), (c) history isn't clipped to 90 days. This is D1's durability gate and a D4 precondition —
   worth doing soon since the client pieces are all in place now, not waiting on anything else.
4. ~~D2 Tasks 2 & 3 — built, needs the device run~~ ✅ **DONE (2026-07-30)** — Full re-sync drain
   (694 batches, clean) + kill-mid-drain (survived with no loss/dupes) both run and confirmed on
   the S25. Two sub-checks (`getUnrolledRaw`/`markRolledUp`, `rawStoreOpen`/`lowDisk`) have no
   admin-console UI to run them directly — inferred pass, tracked as a small backlog item. **Tasks
   4+ are unblocked.**

---

## 📚 Doc map
- Planning baton: [`docs/oura-ondevice-hybrid-handover.md`](oura-ondevice-hybrid-handover.md)
- Master plan (D0–D7 + graph + owner decisions): `docs/superpowers/plans/2026-07-21-oura-ondevice-hybrid-master-plan.md` (read its Review Outcome first)
- **D1 detail + the amendments you must follow:** `docs/superpowers/plans/2026-07-21-oura-raw-on-device-phase-2-durability.md` — the **"Second Review Outcome"** section supersedes the task text.
- D2 detail: `docs/superpowers/plans/2026-07-21-oura-raw-on-device-phase-1.md`
- Data-requirements matrix: `docs/superpowers/plans/2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md`
- Per-PR journal: `docs/overview/entries/2026-07-21-d1-*.md` (this session's entries)
- Backlog progress note: `docs/implementation-backlog.md` (the Oura on-device block)
- Standing rules: `CLAUDE.md` (offline-sync, cache, SQLite migrations, BLE — non-negotiable)
