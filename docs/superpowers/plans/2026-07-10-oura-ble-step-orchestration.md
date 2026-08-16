# Plan — Step orchestration: gate-triggered live counting + Tier-2-wins day merge

**Goal:** turn the two proven step tiers into a self-running system. Tier 1 (col14 walk gate →
estimated steps, shipped v1.125.0) and Tier 2 (live `0x33` accel peak-counter, validated on-device
2026-07-10: 100 real → 103 counted) currently don't talk to each other — the live counter only runs
from a manual tester button and its results go nowhere. After this plan: walking triggers accurate
live counting automatically (while the app is open), and those accurate counts **override** the
estimate for the windows they cover, with Tier 1 filling the gaps.

**Branch:** `feat/oura-ble-step-orchestration`
**Status:** Chunks A and B shipped (v1.127.0 / v1.128.0, 2026-07-11, sessions 264/265) — see the
backlog entry for the full summary. Chunk A's manual-tester route accepts wall-clock time (accel
frames carry no ring ds); Chunk B's auto-orchestrator posts real ds directly (gate frames are
history events and DO carry an embedded ring ds, via `historyEventFromHex` — the route accepts
either shape). `LiveHrManager` gained an `isRunning()` getter for the radio-courtesy check, which
didn't exist before Chunk B needed it. Chunk C (native always-on) remains unstarted, gated on
Chunk B soaking on-device first per this doc's own sequencing.
**Owner directive:** 2026-07-10 — "move straight to tier 2 orchestration".

---

## 1. What already exists (all shipped, all verified)

| Piece | Where | Status |
|---|---|---|
| Walk gate (col14 ≤ 20 over paired 0x7e/0x7f) | `lib/health/step-estimate.ts`, `lib/oura-ble/step-features.ts` | ✅ calibrated on counted walks |
| Daily estimate → `body_metrics.steps` | `aggregateOuraRawSamples` (adapter.ts), max-merge | ✅ live, verified end-to-end |
| Live accel decode + peak counter | `lib/oura-ble/accel.ts` (`decodeAccelFrame`, `StepPeakCounter`, rate-aware 350 ms refractory) | ✅ validated: 100→103, 50→55 |
| Live stream plumbing | plugin `startAccel`/`stopAccel` (`SetRealtime(ACM)`, ~5-min firmware time-box); the native service bridges **all** frames to JS (`ouraFrames`), including command-tag 0x33 | ✅ proven on-device (1,709 frames/run) |
| Manual live test UI | `components/oura-ble/live-step-test.tsx` (4-min re-arm loop) | ✅ shipped |

Key architectural fact: **spontaneous history events stream to the phone while connected** (the
service's `liveFrames` path) — so JS sees fresh `0x7e`/`0x7f` windows at their ~30 s cadence
whenever the ring is connected and the WebView is alive. That is what makes a JS-only trigger loop
possible without an APK rebuild.

## 2. The three chunks

### Chunk A — Tier-2-wins merge substrate (server; migration 119)

The bookkeeping that lets accurate counts override the estimate without double-counting.

1. **Migration 119 `step_live_windows`**: `id bigserial PK, user_id uuid NOT NULL REFERENCES
   users(id) ON DELETE CASCADE, start_ds bigint NOT NULL, end_ds bigint NOT NULL, steps int NOT
   NULL, source text NOT NULL DEFAULT 'live-accel', created_at timestamptz NOT NULL DEFAULT now(),
   UNIQUE (user_id, start_ds)`. ds-keyed (ring deciseconds) because the gate windows and the
   rollup's day-mapping already live on the ring clock; the unique key makes client retries
   idempotent. (119 claimed against the directory — 117 is highest on disk — and open plans: R4
   holds 118. Re-verify at implementation time per the CLAUDE.md migration-number rule.)
2. **`POST /api/oura-ble/live-steps`** — session auth (user-scoped, NOT admin: this is a product
   write, unlike the admin-gated spike ingest), Zod at creation (`startDs < endDs`, span ≤ 4 h,
   `steps` 0–20,000 int), standard rate limit, repo method `upsertStepLiveWindow` (ON CONFLICT
   `(user_id, start_ds)` DO UPDATE — scoped, per the write-path rules). Returns the stored row.
3. **Rollup merge** in `aggregateOuraRawSamples`: per local day,
   `steps = Σ(live windows' steps) + STEPS_PER_WINDOW × (gated walking windows NOT overlapping any
   live window)`. Overlap = the gate window's ~30 s ds span intersects a live window's
   `[start_ds, end_ds]`. The existing max-merge write stays as the outer guard. One-Formula-One-
   Place: the merge math is a pure function in `lib/health/step-estimate.ts`
   (`mergeStepSources(gateWindows, liveWindows)`) with unit tests for full/partial/no overlap and
   a live window spanning midnight (split by the day of each gate window; live steps credit the
   day containing the window's start).
4. **Immediate value, zero orchestration:** the manual **Live step test** gains a "Save result"
   action posting its window to the endpoint — the owner's manual counted walks start correcting
   the daily number on day one, before any auto-trigger exists.
5. **Offline note:** this POST is reachable offline. Full outbox-domain machinery is overkill for
   an admin-adjacent flow; instead the client keeps a small localStorage retry buffer (keyed by
   `startDs`, flushed on app open / next successful POST) and the server's unique key makes
   flushes idempotent. A visibly-pending count in the tester, never a silent `catch {}`.

### Chunk B — JS orchestrator (app-open coverage; no rebuild)

`lib/oura-ble/step-orchestrator.ts` — a small state machine, mounted once (guarded, native-only)
from `components/sync-provider.tsx`, with a status row in the tester.

- **Input:** subscribes to `ouraFrame`/`ouraFrames`; maintains a rolling buffer of `0x7e`/`0x7f`
  frames; pairs via `pairStepFeatures` as they arrive (~30 s cadence while connected).
- **Trigger:** a paired window with `col14 ≤ WALK_CADENCE_MAX` → state `counting`: call
  `startAccel()`, feed 0x33 frames to a `StepPeakCounter`, re-arm every 4 min (firmware time-box).
- **Stop:** 2 consecutive non-walking gate windows, OR 20-min burst cap, OR disconnect. On stop,
  POST `{startDs, endDs, steps}` (Chunk A endpoint) via the retry buffer, then 5-min cooldown
  before the next auto-trigger (battery).
- **Radio courtesy:** never start (and stop early) while a live-HR burst is active
  (`triggerHrBurst` — workout rest periods own the radio); resume eligibility when it ends.
- **Explicit triggers:** exported `startTrackedWalk()`/`stopTrackedWalk()` so the queued
  guided-interval-walk feature (and the workout screen, later) can force-run the counter — these
  bypass the gate but share the burst/POST machinery.
- **State machine unit tests** with synthetic frame streams: walk window → counting; two idle
  windows → stop+POST; cap; cooldown; HR-burst deferral. The tester row shows
  `idle / counting (n) / cooldown` + last posted window for on-device observability.

**Honest coverage limit:** JS runs only while the WebView is alive. Gym sessions, guided walks,
and phone-in-hand walking get accurate counts; a pocket walk with the app killed stays on Tier 1's
estimate. That is the accepted v1 trade — Chunk C is the fix, and the estimate remains the floor.

### Chunk C — Native always-on orchestration (deferred; own go/no-go)

Port the trigger loop into `OuraRingService` (Kotlin): watch spontaneous `0x7e`/`0x7f`, run the
gate natively (unpack27 + col14 port, JVM-tested like `OuraProtocol`), manage `SetRealtime`
bursts, peak-count natively, POST via the existing native ingest executor. ⚠️ APK rebuild +
on-device soak; the highest-blind-risk kind of work in this codebase (BLE inert in-sandbox).
**Do not start until Chunk B has soaked** — B proves the trigger heuristics (false-trigger rate,
burst duration, battery feel) cheaply; C then ports proven constants, not guesses. Implementer
should treat C as its own PR (or defer it back to the backlog) with the device-smoke checklist as
the merge gate.

## 3. Verification

- **Chunk A:** unit tests for `mergeStepSources` (overlaps, midnight span); DB-backed test —
  insert gate frames + a live window, run the rollup, assert the day's steps = live + non-overlap
  estimate and max-merge still holds; `pnpm dev` route smoke (Zod rejects, dedupe upsert).
- **Chunk B:** state-machine unit tests (synthetic streams); on-device: tester row transitions
  during a real walk, a counted walk auto-posts, the day's number reflects the live count.
- **Cache/UI:** no new read surfaces — `body_metrics.steps` and the existing tiles; the rollup
  already sits behind the ingest/redecode triggers. No new cache keys.
- **Not exercisable in-sandbox:** everything BLE-live (trigger timing, burst behaviour, battery) —
  on-device is the gate for Chunk B; Chunk C is owner-run entirely.

## 4. Risks & honest expectations

- **Trigger latency:** the gate reacts on a ~30 s window cadence — the first ~30–60 s of a walk
  are estimate-covered, not live-counted. Inherent; the merge math handles it (those windows fall
  outside the live span and keep their estimate credit).
- **Ring radio sleep:** worn-idle the radio sleeps; spontaneous windows only flow while connected.
  App-open coverage is the honest v1 scope (above).
- **Battery:** bursts are capped + cooldown-gated and mirror the proven live-HR pattern; the
  tester row makes burst frequency observable before Chunk C bakes it into the service.
- **Double-count safety:** the only writer of the day total remains the rollup (single write
  path); live windows change its *inputs*, never write `body_metrics` directly.
