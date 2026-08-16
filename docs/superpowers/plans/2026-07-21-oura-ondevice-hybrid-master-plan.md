# Oura On-Device + Own-Analysis — Master Implementation Plan

**Date:** 2026-07-21 · **Type:** master sequencing / orchestration plan (docs-only; planning session).
**Branch (implementers):** `feat/oura-ondevice-hybrid` (per-phase branches fork from it / from `main`).
**Foundation (read first):**
[`2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md`](2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md)
— the keep/cull/calculate/backup matrix; **this plan is only correct where that map is correct.**

> **What this doc is.** The owner asked to combine two threads — (1) move raw data + calculation
> **on-device** with only pre-calculated fields backed to Railway, and (2) move to the **best system**
> (own our metric interpretation; keep Oura only as a temporary oracle + 2 kept models) — into **one**
> build. This is the dependency-ordered sequence that does that. It does **not** re-derive the two detailed
> plans that already exist (Phase-1 native store + rollup port; Phase-2 durability chain) — it **references
> and sequences** them, and adds the net-new own-analysis phases (step_counter, dHRV retirement, Polar H10,
> oracle deprecation) + the server-raw cutover that were unplanned.
>
> **Governing principle (owner):** *build it once, build it right — best future-proof + performance, no
> easy fixes.* Every fork below resolves toward the durable option, not the quick one.

---

## Review Outcome (2026-07-21) — READ THIS FIRST; four adversarial reviews; corrects §1/§2/§4 below

Four independent code-grounded reviews (metric/model parity · offline-first & performance · data-loss &
durability · rule-compliance & sequencing) were run against this plan + the matrix. **No CRITICAL
data-loss finding — the destructive step (D4) is properly gated and the architecture is sound.** But the
reviews found the plan was **not yet correctly sequenced** for "build once, build right." The corrections
below **supersede** the affected phase text; the phases §2 are kept for context but read them through this.

### The headline: a neural-port inversion (fix before any implementer forks the branch)
Phase-1's neural port (the plan D2 references) does the **opposite** of this plan's own strategy: it ports
**dHRV** to on-device WASM (a model D5 then *deletes*) and **omits step_counter** (the model D7 *keeps*).
Two real consequences the first draft missed:
1. **step_counter is never given a WASM parity gate or wired into the device rollup → after D3 flips reads
   local-first, steps regress to the flat-30 heuristic over-count that D0 fixed.** D0 fixes it *server-side*
   only; the device path never gets the fix. **Latent production regression.**
2. **dHRV gets WASM-ported in D2, then deleted in D5 — build-twice**, violating the governing principle.

**Correction (reorders the plan):**
- **D5 (own daytime-HRV) moves BEFORE D2's neural port.** Build + validate our own daytime-HRV first, so
  D2 never WASM-ports a model it will delete. After D5, **D2's neural port = SleepNet + step_counter only**
  (dHRV gone from the device path entirely).
- **step_counter joins the D2 WASM parity gate + device-rollup step path** as a hard consequence of keeping
  it (O3). Amend Phase-1 Task 0/5/6 accordingly (Phase-1 is superseded on this point).
- **D5 is a genuine build, not a wiring task** (see the parity finding below), and its validation gate is
  the **Polar H10 spot-check, not dHRV** (validating against dHRV re-anchors us to the Oura opinion we're
  escaping). **H10 is an intermittent test reference only — not a data source, not the primary source of
  truth, not a longitudinal record** (owner-clarified): the ring stays the continuous source of truth and
  our own math carries longevity. So the real order is **D6 (harness + H10 spot-check) → D5 (own
  daytime-HRV) → D2 (SleepNet+step WASM)**.

### Parity (owner concern #2 — "do we own everything before we deprecate?"): SAFE as sequenced, one gap
- **Verified own + wired on equivalent inputs:** body-temp/deviation, HRV (nightly), RHR, respiratory,
  chronic-stress, energy, and **illness** (`computeIllnessRadar` — temp+HRV+RHR+breath z-scores, temp
  weighted highest; live at `readiness-score:308` + persisted, one shared z-source so the two paths can't
  diverge). Every **dormant** Oura ONNX (illness_detection, energy, awhr, awhr-selector, sleepnet-bdi,
  cva/atlas) **never fed a displayed value** — deleting them at D7 loses **zero live capability**. BDI/apnea
  rides SleepNet's apnea head (a kept model) — no hidden dropped-model dependency.
- **The one real gap — dHRV.** dHRV *imputes* daytime HRV from temp+MET+HR because the ring measures HRV
  sparsely when awake. The first draft wrongly said `daytime-hrv.ts`/`hrv-frequency.ts` "already do this" —
  they don't (`daytime-hrv.ts` only *filters* measured `0x5d` samples; `hrv-frequency.ts` is a sleep-stage
  discriminator). D5 is net-new: build our own daytime-HRV, validate the ring's daytime `0x5d` density is
  sufficient (or build our own imputation), gate on **H10**, keep dHRV until it passes. **Deprecation is
  safe because D7 cannot delete dHRV until D5+D6 prove parity** — the owner's "validate before deprecate"
  gate is respected in sequencing even though the draft oversold the replacement's readiness.
- **Illness is a coarser heuristic than Oura's CNN** (4 nightly z-scores vs an 8-channel×30-step series) —
  but the CNN never ran, so this is the already-shipped design, not a regression. **Awake-HR gap-filling**
  (`awhr_imputation`) is a capability we are **declining, not replacing** — state it so future "why are
  there HR holes" isn't mistaken for a regression.

### Performance & timing (owner concern #1 — "is now the time / how does it perform without API calls?")
- **Not a from-scratch pivot — the completion of an existing direction.** 24 sync domains, the outbox,
  pull/apply, RECONCILE, and local SQLite v18 already exist and are proven for every hand-logged domain.
  Only the **Oura biometric read path + the ML rollup** are still server-only. Lower risk than "rebuild
  sync."
- **It will NOT make screens faster.** Health screens already instant-paint from the client cache
  (`readCacheSync` seed + background revalidate) — the network was never on the paint path. Local-first
  removes a *background* cost, not a *visible* one. **Reframe the win: Railway cost/volume (the 437k-row
  raw drop, 91% of the DB), data ownership + reprocessability, and true offline biometric screens** — not
  UI speed. New on-device ML compute (WASM SleepNet nightly) is net cost, budgeted but unproven on the S25.
- **CRITICAL prerequisite (perf review):** production CSP (`next.config.ts:10`) has **no `wasm-unsafe-eval`**
  → `onnxruntime-web` (SleepNet/step on-device) will be **blocked in the WebView**, and the parity test runs
  under Node (no CSP) so it passes in the sandbox and breaks on device. **Add `'wasm-unsafe-eval'` to the
  production `script-src` as a D2 Task-0 prerequisite, and assert WASM *instantiates under the real prod CSP
  header on the S25* before any neural-half work.** If it can't clear the bar, the deterministic rollup +
  durability chain still deliver ~all the cost/ownership value with the two models left server-computed —
  graceful degradation.

### Durability / storage (owner concern #3): design right, but make the ordering ENFORCEABLE
- **The D1→D4 ordering is prose-only.** Backlog-driven implementers work top-down in separate sessions;
  nothing physically stops a session reaching the D4 `DROP` before D1's restore is device-proven — the exact
  way 437k single-copy rows get lost. **The D4 backlog entry must encode a hard precondition:** (a) all six
  forms present in `SyncDelta`, (b) F1/F3/F4 landed, (c) a **device-verified wipe→restore round-trip
  artifact referenced by commit SHA** in the D4 PR; the drop PR is refused without it. "Confirm-first" is
  necessary but not sufficient — the owner can't eyeball whether restore actually drained full history.
- **`oura_raw.db` needs its own reconcile authority + CI gate as a NAMED D4 precondition** — it's the
  single-copy archival store, outside the `check-reconcile.js` safety net that CLAUDE.md says is the real
  schema authority after the local DB's two silent deaths.
- **The completeness audit must be full-date-range coverage + a re-derive hash check, fail-closed** — an
  audit that passes because a day was never backfilled is a false green on the drop gate.
- **Honest framing:** single-copy exposure starts at **D2** (when the local rollup first writes a finished
  form), not just at D4 — the raw drop is the *last* exposure, not the first. Every derived form is
  single-copy on the APK from first local write until its sync arm lands.

### Hard-dependency + numbering fixes (supersede §1/§2/§4)
- **Migration numbers: NOT 136.** Defer to Phase-2's allocation — **130** (`oura_heartrate.updated_at`) +
  **137** (`oura_bucket` server table + the `oura_device_authoritative` flag). The draft's "136 / claim
  forward past 135" re-introduces the exact collision Phase-2's R7 already fixed. Re-verify against the tree
  AND open PRs at pickup.
- **D1 ∥ D2 is only half true:** D1's *server infra* (F1–F4, Track A/B tables + push branches) runs parallel
  to D2, but **D1's device-verification gate (push→pull→restore proof) has a hard D2→D1 edge** — it can't
  sign off against a device with no rollup writing the tables. Add the edge; don't sign off D1 durability
  against empty tables.
- **D4 needs D1 + D2 + D3 (D3 is a HARD precondition, not "(+D3)"):** D3's single-writer flip must demote
  the server rollup to reader/off **before** raw is dropped, or the server rollup errors reading the dropped
  table on the next cold-start pass.
- **D3 read-flip gate = a data-PRESENCE check, not just plugin-availability:** a freshly-rebuilt APK has the
  plugin but an empty store (before the first drain/rollup) → blank Oura screens. Gate on "local
  `oura_daily_derived` has recent rows / a rollup watermark exists," else fall through to the logic-free
  server read. **State a D3 rollback posture** (flip reads back to server-first while raw still dual-writes)
  and make explicit that **D4 forecloses that rollback** — soak D3 until both paths agree before D4.

### Smaller pins (fold into §4 guardrails)
- New heavy routes ship the **standard rate limit + per-request row budget at creation** — explicitly the
  D4 admin 437k-row pull and D0's redecode backfill (admin-gating ≠ rate-limiting).
- **Timezone midnight-boundary test (23:59/00:01 user-local)** for the `oura_bucket` day-bucketing AND the
  D4 per-day completeness audit — an off-by-one there wrongly passes/fails the drop gate.
- **Phase-1 Task 1 is superseded** on table *existence* (v17 created the mirror tables; v18 corrected three)
  — the real remaining work there is **sync-wiring**, not schema creation. Re-verify against the matrix §5.
- Lazy-load `onnxruntime-web` + models from the rollup module only (never a static import into a health
  screen — bundle bloat). New full-screen admin/storage views use the floored safe-area utilities.
- **Out of scope (explicit):** GPS / live-activity capture (strategy §6) — a phone-sensor/running-plan
  track, not Oura-BLE; noted so its absence is deliberate, not an oversight.

**Net:** proceed **now on the low-risk spine** — D0 (steps fix), D1 server infra + durability chain,
D6→D5 (own daytime-HRV validated on H10), then D2 (SleepNet+step WASM, dHRV-free) — with the CSP fix and
the enforceable D1→D4 gate landed first. The destructive drop stays last, gated, confirm-first.

---

## 0. The end-state (what "done" looks like)

A **device-primary** health app on the Garmin / Apple-Health / Samsung-Health pattern:
- The **phone owns raw `body_hex`** (native `oura_raw.db`, single copy, storage-aware retention) and does
  **all** compute including ML (SleepNet + step_counter in the WebView via `onnxruntime-web`).
- **Railway holds only the calculated finished forms** as a full-history backup that **never computes** —
  its Oura footprint drops from raw-dominated + unbounded (~200 MB, +50 MB/wk) to a bounded finished-form
  set (~tens of MB). The 437k-row `oura_raw_samples` table is **gone**.
- We **own every metric's interpretation** except the two kept Oura models (SleepNet hypnogram,
  step_counter). Oura's cloud and other proprietary models are out of the live path — an **observe-never-
  feed oracle** deleted at ~T+3 months. A **Polar H10** chest strap is the non-circular cardiac truth
  reference so we validate against ground truth, not against Oura's own opinion.
- The app can **reprocess its entire history** from archived raw the day we ship a better decoder or model
  version — the definition of future-proof.

---

## 1. The dependency graph (why the order is what it is)

```
        ┌── D0 step_counter (own steps) ─────────────────────────┐  (ships value early)
        │                                                        │
  main ─┼── D1 server infra ∥ ─────┐   (D1 device gate ◀─ D2)    ├─▶ D4 server-raw cutover ──▶ D7 oracle
        │   durability chain       ├─▶ D3 silent  ───────────────┤      (437k drop, THE         deprecation
        │   (Phase-2: 130+137)     │   cutover (read-flip;        │      space win; needs         (delete
        └── D6 H10+harness ─▶ D5 ─▶ D2 native raw + ──────────────┘      D1+D2+D3, confirm-1st)   dormant
            (ground truth)  (own    rollup port: SleepNet                                          ONNX +
                            daytime  + step_counter WASM                              D7 needs D6 ◀── dHRV)
                            HRV)     (dHRV-free, +CSP fix)
```
**Reordered from the draft (Review Outcome):** D6→D5 lands **before** D2's neural port so dHRV is never
WASM-ported then deleted, and step_counter is added to the neural port so the D0 steps fix survives the D3
read-flip. D1's *server infra* is parallel to D2; D1's *device gate* needs D2. D4 needs D1+D2+**D3**.

- **D1 (durability) is the linchpin.** The server raw drop (D4 — the whole reason this project exists) is
  **unsafe** until the six finished forms are backed up to Railway **and** a full-history restore exists.
  Today only `ouraDaily` (reduced) + `sleepSessions` are sync-wired; `oura_daily_summary`,
  `oura_daily_derived`, `oura_heartrate`, `oura_bucket` have **no pull-delta domain** (map §4.3). Until that
  closes, dropping server raw would leave every derived metric single-copy on the fragile local store.
- **D2 (native raw) is highest-risk** (the ring cursor advancing on local commit — a botched gate silently
  loses drained spans forever) but runs **in parallel with the server backstop** (raw keeps dual-writing to
  Railway) so it never risks data during transition.
- **D0 goes first** because it is pure server-JS + redecode (no native, no device-storage risk), fixes a
  live user-visible bug (step over-count), and de-risks the "keep step_counter" decision early.

---

## 2. Phase-by-phase

Each phase names **which half is native** (needs an owner APK rebuild) vs **JS/server** (ships via Railway
into the WebView), and its **gate**. Native/BLE/SQLite/WASM behaviour is unverifiable in the sandbox — the
merge gate there is `docs/device-smoke-checklist.md` or a NOT-verified Known-Issues row (Canonical Runtime).

### D0 — step_counter as primary steps (own-analysis; JS/server + redecode) — **do first**
**Why first:** fixes the live over-count (flat 30-steps/window heuristic, map §2 #15), is fully
server-side + sandbox/redecode-testable, and proves the "keep step_counter" model end-to-end before the big
migration leans on it.
- Wire `steps_motion_decoder` → `step_counter` (`step-counter-pipeline.ts` exists; currently reachable only
  from the admin `step-counter-export` route) into the **rollup step path** as the primary daily-steps
  source; retire `estimateSteps`'s flat-30 credit; keep the periodicity-gated live counter for realtime.
- **Backfill the entire step history** via the redecode lever (`POST /api/oura-ble/samples/redecode`) — raw
  `0x7e/0x7f` (+ `0x47` motion, the model's soft input, map §3a) are archived, so no re-walking/re-sync.
- **Gate:** sandbox golden (`step_counter_1_3_0.golden.npz`) + a redecode-idempotency test; **on-device
  sanity** that daily totals are physiologically sane vs the old inflated number (owner S25 — the
  over-count is only *provable* on-device). Owner decision **O3** (adopt as primary) confirmed by this.

### D1 — Durability foundation + six-form backup chain + full-history restore (JS/server + client)
**This is the existing Phase-2 plan, revised.** See
[`2026-07-21-oura-raw-on-device-phase-2-durability.md`](2026-07-21-oura-raw-on-device-phase-2-durability.md)
(F1–F4 foundation → Track A day-grained forms → Track B dedicated HR/bucket path → cutover → restore).
**Do not re-plan it here.** Its Review Outcome (R1–R7) is resolved in the revised breakdown; per owner
directive that revised breakdown is **pending one more adversarial review before any code** — that review
is the entry gate to D1.
- Delivers: the 8-link offline chain (local table + `sync_status` + clobber-guard = payload = shared write
  fn in `pushMutations` = `getSyncDelta` = `pullDelta` = `applyDelta` + mark-synced arm) for
  `oura_daily_summary`, `oura_daily_derived`, `sleep_sessions` (fix restore gutting + source-merge),
  `body_metrics` Oura fields + `oura_daily`; a dedicated single-connection timestamp-cursored endpoint for
  `oura_heartrate` + coarse `oura_bucket` tiers; the `(updated_at,id)` cursor tiebreak; `getSyncDelta`
  full-history unclamp + a restore drain-loop (`hasMore` to exhaustion, past the 90-day clamp + 20-page cap).
- **Multi-source guard (map §4.2):** `body_metrics`/`oura_daily` device push **must mirror** the per-column
  `sourceMap` COALESCE merge or it clobbers manual weight/body-fat + Health-Connect steps.
- **Gate:** `check-push-mutations`/`check-reconcile` green; field-coverage test for `oura_daily_derived`;
  **device-verified** push→pull round-trip (a pushed rollup row ends `synced` and survives a later pull) +
  a full-history restore onto a wiped store (the durability proof). **Migrations 130** (`oura_heartrate.updated_at`)
  **+ 137** (`oura_bucket` server table + `oura_device_authoritative` flag) per Phase-2's allocation — **NOT
  136** (see Review Outcome); local SQLite already **v18**. **Server infra ∥ D2; the device-verified gate has
  a hard D2→D1 edge** (can't prove restore against a device with no rollup writing the tables).

### D2 — Native `oura_raw.db` + local-commit cursor + WebView rollup port (NATIVE + JS) — server-infra ∥ D1
**This is the existing Phase-1 plan** — but **amended by the Review Outcome**, see
[`2026-07-21-oura-raw-on-device-phase-1.md`](2026-07-21-oura-raw-on-device-phase-1.md) (Task 0 WASM parity
spike → native raw store + cursor gate → native bridge → on-device clock anchor → port deterministic rollup
→ neural models in WASM → tier-ladder promotion → storage-aware prune → device-storage readout). **Do not
re-plan it here.**
- **⚠ Neural-port amendment (Review Outcome):** the device neural half is **SleepNet + step_counter** — NOT
  dHRV (D5 retires it first, so it's never WASM-ported). **step_counter joins the Task-0 WASM parity gate**
  and the device-rollup step path (else steps regress to the flat-30 heuristic after D3). **CSP prerequisite:
  add `wasm-unsafe-eval` to the production `script-src` and assert WASM instantiates under the real prod CSP
  on the S25** before any neural-half work — the parity test runs under Node (no CSP) and would false-green.
  Phase-1 Task 1 is **superseded** on table existence (v17/v18 already created + corrected them — the real
  work there is sync-wiring, not schema creation).
- The retained-raw set this stores is **map §3a** (all rollup-consumed biometric tags + `0x47` for
  step_counter); the tier ladder is **supplementary trend resolution** (map §4.1) — finished forms stay
  authoritative for displayed values (RHR, nightly HRV, steps, intraday HR via `oura_heartrate`).
- **Non-negotiables (Phase-0 pinned):** cursor lives **inside** `oura_raw.db`, advanced in the **same
  transaction** as the batch insert; `PRAGMA synchronous=FULL`; single SQLite owner (WebView reads/prunes
  via native bridge); prune predicate `rolled_up=1 AND synced=1 AND age>window` (never age alone);
  disk-full alarm + reserved headroom; `oura_raw.db` gets its own idempotent-`ADD COLUMN` + reconcile pass
  (it sits outside `check-reconcile.js`).
- **Gate:** WASM neural parity (Task 0, already passed #722) + **on-device** cursor-hold / hole-safety /
  dedup verification across several real nights (ops-doc §4 1:1 check). Raw **keeps dual-writing to
  Railway** throughout (the backstop) — no read-flip, no drop, until D3.

### D3 — Silent cutover: read-flip to local-first + single-writer flip (JS/server) — needs **D1 + D2**
- Flip the Oura-fed read surfaces to **local-first** (offline-first rule: a domain that writes locally must
  read locally), gated on a **data-presence check — NOT just a plugin-availability probe** (a freshly-rebuilt
  APK has the plugin but an empty store before the first drain/rollup → blank Oura screens): gate on "local
  `oura_daily_derived` has recent rows / a rollup watermark exists," else fall through to the logic-free
  server read (Canonical Runtime).
- **Rollback posture:** if the device rollup is found wrong in production, flip reads back to server-first
  while raw still dual-writes. **Soak D3 until both paths agree before D4** — D4 (the raw drop) **forecloses
  this rollback** (no server raw left to re-derive from).
- **Single-writer flip:** stop the server rollup writing the finished tables once the device rollup is
  proven — `COALESCE(EXCLUDED,existing)` first-writer-wins otherwise masks decoder-port divergence.
- **Gate:** on-device that every Oura screen paints local-first offline and matches the server values pre-flip.

### D4 — Server raw cutover: pull-to-device + completeness audit + staged drop (JS/server + 1 migration) — needs **D1 + D2 + D3** (D3 is a HARD precondition — the single-writer flip must demote the server rollup before raw is dropped, or the rollup errors reading the dropped table); **CONFIRM-FIRST + enforceable gate** (see Review Outcome: six forms in `SyncDelta` + a device-verified restore-proof artifact by SHA + `oura_raw.db` own-reconcile + full-date-range completeness audit, fail-closed)
**The space win** (map §3d). Sequence: (1) admin-gated paginated pull of the 437k `oura_raw_samples` rows
into `oura_raw.db` (dedup-safe) — raw *moves*, not deletes; (2) **per-day finished-form completeness audit**
+ a **batched** backfill (the normal rollup is 35-day-windowed and `fullHistory` times out at the gateway —
a single call won't do it); (3) **staged rename-then-drop** (not a hard `DROP`) + the existing admin
`VACUUM FULL` reclaim.
- **Owner decision O1:** this **supersedes** the `body_hex`→`bytea` migration (`db-volume-cleanup-handover.md`
  §5a) — do not do both. Recommend the drop.
- **This is data-dropping → owner confirms before the drop**, and the same PR **rewrites the CLAUDE.md
  "never prune `body_hex`" rule** (the archival home moves from the server table to `oura_raw.db`) and
  re-scopes the `oura-ble-operations.md` §16 invariant. **Gate:** owner confirmation + the completeness
  audit passing for every historical day.

### D5 — Retire dHRV: own daytime-HRV (JS) — needs **D6**; lands **BEFORE D2's neural port**
The one *wired* Oura oracle (map §6). Today `buildDaytimeStressSeries` calls the `dhrv_imputation` ONNX per
30-min bucket → resilience/body-battery. **This is a genuine build, NOT a wiring task** — correcting the
draft: `daytime-hrv.ts` only *filters* measured `0x5d` samples and `hrv-frequency.ts` is a sleep-stage
discriminator; neither imputes daytime HRV the way dHRV does (from temp+MET+HR, because the ring measures
HRV sparsely when awake). D5 must: (1) validate whether the ring's daytime `0x5d` density is sufficient to
compute daytime HRV directly, else build our own imputation; (2) wire it into the resilience/stress path.
**Observe-never-feed:** compute ours with zero knowledge dHRV exists.
- **Sequencing:** land D5 **before D2's neural port** so D2 never WASM-ports dHRV (a model we delete) —
  after D5, D2's neural half is **SleepNet + step_counter only**.
- **Gate:** validate our daytime-HRV against the **Polar H10 spot-check (D6), NOT dHRV** — validating against
  dHRV re-anchors us to the Oura opinion we're escaping. The H10 is an **intermittent test reference, not a
  source** (owner-clarified, D6): worn for bursts to confirm our ring-derived daytime-HRV holds up during
  those windows; the ring remains the continuous source and our math carries it long-term. No resilience
  regression. Removing dHRV **frees no raw** (its inputs are keep-raw for owned metrics — map §3a). Keep dHRV
  in the D6 harness only until parity passes; D7 deletes it.

### D6 — Polar H10 validation reference + comparison harness (JS + existing native strap) — enables **D5** (do before it)
Escape circular validation (map §6). The `rr_intervals` table (mig 124) + `polar-h10-ble` integration
already exist. Build the **generic comparison harness** (strategy §4): admin-console tool, pluggable
reference adapter (`SleepNet stages`, `step_counter`, `Polar H10 HR/RR`), per-metric `{ours, reference,
delta, withinTolerance}`, tune toward a **tripwire not sameness**.
- **H10's role, precisely (owner-clarified):** an **intermittent spot-check** — worn for short bursts during
  tuning/testing to catch when *our* cardiac logic diverges. It is **NOT a data source, NOT the primary
  source of truth, NOT a longitudinal record.** The **ring stays the primary/continuous source of truth**
  and **our own math carries longevity**; the H10 never feeds a stored metric or replaces the ring. Its only
  job is to break the circular-validation loop (validate against something other than the Oura opinion).
- **Gate:** harness runs over a window; H10 spot-check wired as an admin test instrument; **no live-path
  dependency** (admin only — it never enters the pipeline).

### D7 — Oracle deprecation: delete observe-only models + `onnxruntime-node` from the request path (JS) — needs **D6**, ~T+3mo
Delete the dormant vendored models (`sleepnet_bdi` ×2, `energy_expenditure` ×2, `illness_detection`,
`awhr_imputation`, `awhr_profile_selector`) + dHRV (post-D5) + the ~87 MB of weights + `onnxruntime-node`
from serving. Because the reference only ever **observed**, this is a near-mechanical deletion. **Keeps**
SleepNet + step_counter (the two kept models, now on-device WASM). **Runtime win:** lighter/faster cold
starts. **Do NOT delete** vascular-age/body-comp/activity-type artifacts' *value* — there was never a wired
model (map §6); this is deleting vendored files, and the body-comp *formula* tile stays.

---

## 3. Owner decisions

| # | Decision | When | Recommendation |
|---|---|---|---|
| **O1** | Server raw: drop-after-pull **vs** `bytea` migration (mutually exclusive) | pre-D4 plan; **confirm at D4 drop** (destructive) | Drop (raw belongs on device); bytea only if D4 slips |
| **O2** | `cull-after-window` biometric set (`0x73`, raw PPG, atlas bioZ) + retention window (~2–3mo is an estimate) | **post-implementation** (safe to defer; small lever) | Keep-hex-only for now; revisit at decoder-stabilisation |
| **O3** | Adopt step_counter as **primary** steps (replaces visible heuristic) | at D0 | Proceed — fixes a live bug; verify totals on-device |
| **O4** | Sync coarse `oura_bucket` tiers to Railway on top of finished forms | at D1 Track B | Yes (long-horizon trend the finished forms don't hold) |

**Nothing here blocks merging this planning doc.** O1/O2 are gated at their destructive implementation step
(post-implementation confirms); O3/O4 are engineering calls the implementer makes with the recommendation.

---

## 4. Global guardrails (every phase)

- **No cron layer** — all rollup/promotion/prune/backfill fires from **app-foreground / BLE-sync
  completion**, never a scheduler (module-map §0).
- **`body_hex` is archival/immutable** until the owner-confirmed D4 policy change; no biometric-tag or
  `body_hex` drop lands without owner confirm + the CLAUDE.md rule rewrite in the same PR.
- **Sync-push mirrors the web route**, one shared write fn per domain (`check-push-mutations.js`); new local
  tables register in `RECONCILE_TABLES`/`check-reconcile.js` in the same commit; `oura_raw.db` needs its own
  reconcile discipline (it's outside the trainingai-DB safety net).
- **Web fallback stays logic-free** (Canonical Runtime): pure fetch→render, no defaults/derivations/band-math.
- **Migration hygiene:** defer to Phase-2's allocation — **130** (`oura_heartrate.updated_at`) + **137**
  (`oura_bucket` server table + `oura_device_authoritative` flag). **NOT 136** — the draft's "claim forward
  past 135" re-introduced the collision Phase-2 R7 already fixed (the tree also carries 081×2/087×2
  collisions, applied in filename-sort order). Local SQLite at **v18** (next v19 — any `ADD COLUMN` is
  guarded + registered in `RECONCILE_COLUMNS` same-commit, per the partial-application rule). Claim against
  the tree **and** open PRs/plan docs.
- **WASM CSP (D2 Task-0 prerequisite):** production `script-src` (`next.config.ts`) currently has no
  `wasm-unsafe-eval`, so `onnxruntime-web` is blocked in the WebView; add it and assert WASM instantiates
  under the real prod CSP header on the S25 before any neural-half work. New heavy routes (D4 437k pull, D0
  redecode backfill) ship the standard rate limit + a per-request row budget at creation. New date-bucketed
  series + the D4 audit get a 23:59/00:01 user-local boundary test.
- **Device is the authoritative check** for any native/SQLite/BLE/WASM/safe-area behaviour — green sandbox
  is necessary, never sufficient.

## 5. Exit criteria (the whole initiative is "done" when)

- [ ] D0: daily steps come from step_counter; history backfilled; on-device totals sane.
- [ ] D1: all six finished forms are full offline domains; full-history restore rehydrates a wiped store;
      device-verified push→pull round-trip; `check-push-mutations`/`check-reconcile` green.
- [ ] D2: `oura_raw.db` native store + local-commit cursor proven loss-free across real nights; WebView
      rollup (deterministic + SleepNet WASM) reproduces server values; tier ladder + storage-aware prune live.
- [ ] D3: every Oura screen reads local-first offline; server rollup demoted to reader; no value drift.
- [ ] D4: 437k rows pulled to device; per-day backup completeness audited; server raw table dropped
      (owner-confirmed); Railway Oura footprint bounded; CLAUDE.md rule rewritten.
- [ ] D5: resilience/stress owned (dHRV retired); no regression vs harness.
- [ ] D6: comparison harness live; Polar H10 cardiac reference wired.
- [ ] D7: oracle models + `onnxruntime-node` off the request path; SleepNet + step_counter kept on-device.

## 6. Device-verification flags (owner's S25 — sandbox cannot exercise)

step_counter totals (D0); native `oura_raw.db` durability + cursor (D2); SleepNet WASM nightly perf/battery
(D2); the push/pull/restore round-trip on real data (D1); the backup-completeness audit before the drop
(D4); local-first offline paint (D3). Run `docs/device-smoke-checklist.md` + ops-doc §4 for each; else a
NOT-verified Known-Issues row per the Canonical Runtime rule.
