## 2026-07-21 — Oura raw-on-device architecture: Phase 0 spec (docs-only)

**Branch:** `claude/oura-raw-device-architecture-7taq90` · **Type:** planning (docs-only, no code).

Answered the owner's Phase-0 brief
([`docs/superpowers/specs/2026-07-21-oura-raw-on-device-architecture-brief.md`](../../superpowers/specs/2026-07-21-oura-raw-on-device-architecture-brief.md),
PR #715) with a full design/plan:
[`docs/superpowers/plans/2026-07-21-oura-raw-on-device-architecture.md`](../../superpowers/plans/2026-07-21-oura-raw-on-device-architecture.md).

**What the spec decides:**
- **"Calculated data" + tier ladder (§5 of the brief):** per-tag → bucket-field map; a unified
  `oura_bucket` table at per-field native resolution climbing `10s→1min→5min→30min→1hr→12hr→24hr`;
  raw `body_hex` kept device-only in `oura_raw_local` for a bounded ~30-day re-decode window (opaque,
  can't be averaged — only decoded numbers roll up). **HRV rMSSD is recomputed from IBI intervals at the
  5-min tier, never averaged upward** (preserves the existing `medianGated` rollup semantics). Sleep
  stored as finished 5-min hypnogram, not raw events.
- **Durability model:** raw + fine tiers are device-only (acceptable to lose); ≥5-min tier + finished
  daily/nightly forms mirror to Railway via the outbox (backup). A device wipe loses re-decode ability,
  never the derived metrics — the Railway derived-push is the disaster-recovery net and must never be
  dropped.
- **Cursor-contract change (highest risk):** `history_cursor_ds` advances on **local SQLite commit**
  instead of server 2xx. Recommends a **native-owned `oura_raw.db`** (headless Kotlin service writes it
  and gates the cursor on that commit; the WebView is reader/rollup/pruner) — the only option that keeps
  drain durable with the app closed. All hole-safety/monotonic/dedup invariants (`@Volatile
  drainIngestFailed`, R-1/I18 fix) are preserved, repurposed from POST-failure to local-write-failure.
- **Silent cutover:** dual-accept during transition, seed local via the existing Full re-sync (dedup-safe),
  backfill Railway from the device, flip Oura surfaces to local-first, retire server raw ingest last.
- **437k Railway rows:** pull-to-device (preserve re-decode where raw now lives) → ensure finished forms
  complete server-side → **drop `oura_raw_samples`** (data-dropping → owner-confirm; rewrites the "never
  prune `body_hex`" rule in that PR).

Refined the brief's phasing into Phases 0–4 and added a **Phase-1 backlog entry** (⛔ device-blocked —
native/SQLite/BLE unverifiable in the sandbox; needs the S25 + APK rebuild).

**Reviewed & hardened (same session):** ran four independent adversarial reviewers (cursor-contract/data-loss,
durability/cutover, tier-ladder/rollup fidelity, rule-compliance). They confirmed the core inversion and the
§4 cursor-on-local-commit direction are sound, but caught one plan-shaping premise error and a cluster of
permanent-loss holes — folded into a prominent **"Review Outcome"** section + a full findings appendix (§11):
- **D1 (premise error, owner decision):** the rollup is not just the decoders — it runs 8 native ONNX models
  (SleepNet staging + BDI, dHRV→resilience) that can't run in a WebView. "Roll up on-device" forks into
  WASM-on-device vs a hybrid (device deterministic rollup + server neural enhancement — recommended) vs
  heuristic-only (nightly quality regression). Reframes "Railway redundant" to mean *raw* is gone, not that
  the server is idle.
- **D2 (durability overstatement, owner decision):** "restore from Railway" doesn't exist for
  `oura_daily_summary`/`_derived`/`oura_heartrate` today and is 90-day-clamped by `getSyncDelta`; the cursor
  advancing on *raw* commit doesn't make *derived* durable. Requires: never prune raw until derived is
  `sync_status='synced'`; don't ship the cursor gate before the derived→Railway backup is proven; build the
  full offline chain for 4–6 finished forms.
- **Pinned engineering rules:** cursor co-located in `oura_raw.db` (same txn, not SharedPreferences),
  `synchronous=FULL`, native-bridge single SQLite owner, prune predicate `rolled_up AND synced AND age`,
  disk-full alarm, HRV = `0x5d`-median (not IBI recompute), no two-sources-of-truth for HR/HRV, device writer
  mirrors `body_metrics` source-merge, staged §6 drop gated on a per-day completeness audit.

**Verification:** docs-only — no runtime surface touched. Nothing to smoke. The design rests on
source-verified anchors (native cursor contract in `OuraRingService.kt:378-568`, rollup in
`adapter.ts:4033-5003`, local-store machinery in `lib/sqlite/`) gathered this session; the load-bearing
native/local-commit behaviour is explicitly **device-gated** and called out for on-device validation in
Phase 1.

**No version bump** — planning docs only, no user-visible change.
