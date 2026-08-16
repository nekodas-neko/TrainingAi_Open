# Plan — Our own step counter from the Oura ring (BLE)

**Goal:** produce a trustworthy daily **step count** for the user, derived by us from the
ring's BLE motion data, written to `body_metrics.steps` (`source='ble'` semantics) and shown on
the existing health/activity surfaces — with no Oura Cloud and no Health-Connect dependency.

**Branch:** `feat/oura-ble-own-step-counter`
**Status:** planned (this is the planning PR — docs only). Supersedes the decode-only ambition of
`2026-07-09-oura-ble-steps.md` (which proved `0x7e`/`0x7f` are *not* a count — see below).

> **2026-07-09 update (round 2):** a second, rigorous multi-window capture (idle × 3 windows,
> 30s-gap × 4, a counted 100-step walk × 6 windows, full per-byte mean/stdev diff — see the scratchpad
> `step-captures.md`) **confirmed** the naive per-byte unpacking of `0x7e`/`0x7f` (treating each as an
> independent 14-byte blob — what `decodeRealSteps` and open_oura `main` both do) carries no clean
> per-window step delta and no clean cadence signal. Options (a)/(b) below are dead **for that
> unpacking.** Reached out to the open_oura author about `0x51`/`0x52`, the `0x33` accel g-scale, and
> further `0x7e/0x7f` insight — parked initially, not blocking.

> **2026-07-09 update (round 3 — the author replied):** pointed us at
> [`Th0rgal/open_health`](https://github.com/Th0rgal/open_health), his consumer app built on a
> **divergent branch** of open_oura (`split-open-health`, not `main`) with real, verified `0x7e/0x7f`
> decode progress — see `§2A` and `§4 Phase 1`. **Re-running round 2's exact captured data through the
> correct pairing surfaced a clean idle/walking discriminator** (unpack27 column 0, zero overlap across
> 13 samples) — round 2's "dead" verdict stands for the *naive* unpacking, but the *correct* unpacking
> gives Tier 1 something much better than the coarse trend this plan originally proposed. `0x51/0x52`
> is now doubly confirmed dead (unreferenced in open_health too). This doc's two-tier gate (§4)
> architecture is unchanged — this upgrades what Tier 1 is built from, not the design.

> **Why this is now top priority (owner directive, 2026-07-09):** there is **no Health Connect**
> feeding the app, and the Oura Cloud is frozen post-re-key. So the ring is the app's **only**
> possible step source, and `body_metrics.steps` is otherwise empty for every day since the re-key.

---

## 1. What we established first (the hard finding — still true)

Enabling `REAL_STEPS (0x0b)` (shipped #373) makes the ring emit `0x7e`/`0x7f`
`real_step_event_feature` frames (#376 confirmed they arrive on-device). A **counted 100-step
walk**, decoded naively (each frame as an independent 14-byte blob), showed high-entropy bytes with
no clean count. The **correct** decode (§2A) reveals these are genuinely per-window **gait/motion
feature vectors** — the ring's own step-model inputs, confirmed by open_health's `unpack27` +
`steps_motion_decoder` round-trip (author-verified: decodes to a stable ~2.7 Hz cadence). The RE
source confirms the pipeline `REAL_STEPS → 0x7e/0x7f → stepmotion`, where `stepmotion` is a model
output (`steps_motion_decoder_2_0_0.pt`, proprietary, gitignored — not available to us) fed **raw
ACM** in Oura's own pipeline — but open_health's `unpack27` shows the 0x7e/0x7f *pairing itself*
does **not** need raw ACM, only the already-enabled `REAL_STEPS` capability. Oura's own literal
step-count model (`step_counter`, distinct from `steps_motion_decoder`) is independently confirmed
**raw-ACM/RData-locked** (open_health's `docs/model-runners.md`) — so **we cannot reproduce Oura's
exact number**, but the *inputs* to their gait model are reachable and useful on their own, without
their model, as a much better activity signal than raw per-byte reads. We build **our own** gate +
counter from the motion signals we *can* get.

## 2. What we can actually get over BLE (grounded inventory)

Two distinct data planes — this split drives the whole design.

### (A) History plane — passive, all-day, survives disconnect (drains hourly into `oura_raw_samples`)
Decoded today (`lib/oura-ble/decode.ts`, all validated unless noted):
- `0x50` **activity_information** — `state` + per-minute **MET** bins (`decodeActivityInfo`,
  decode.ts:222). Our 100-step walk showed as a MET jump to `3.3/6.6`.
- `0x47` **motion_event** — `orientation`, **`motion_seconds`** (0–31 per event), per-axis avg,
  `low/high_intensity` (`decodeMotion`, decode.ts:234).
- `0x6b` **motion_period** — packed 2-bit **motion_levels[]** over a period (`decodeMotionPeriod`,
  decode.ts:302).
- `0x74` **ehr_acm_intensity** — LE u16 intensity samples (decode.ts:213).
- `0x72` **sleep_acm_period** — ACM MAD stats (sleep only).
- `0x7e`/`0x7f` **real_step_event_feature_1/2** — the ring's step-model feature vectors. Our
  `decodeRealSteps` still does the **naive/wrong** unpack (each 14-byte frame independently,
  `_status:'unvalidated'` — do not read its `fields[]` as anything meaningful). **The correct decode
  pairs both halves**: `0x7f` is emitted one ring-timestamp-unit after its matching `0x7e`; combine
  both 14-byte bodies via `unpack27` (open_oura branch `split-open-health`, NOT `main` — see
  `§4 Phase 1`) into **27 quantized gait-feature columns**, using carry bits packed into `0x7f`'s last
  byte. Author-verified: paired and run through Oura's own `steps_motion_decoder` model, a continuous
  run decodes to a stable ~2.7 Hz cadence (vs. noise for the naive per-frame unpack). We don't have
  that model, but **our own re-analysis of the 27 columns (no model needed) found column 0 cleanly
  separates idle from walking** — see §4 Phase 1 for the result and its caveats.
- `0x51`/`0x52` **activity_summary_1/2** — **dead, doubly confirmed.** open_oura's docs claimed these
  hold "13 MET-level bins + step counts" but leave them undecoded; we've observed **zero** on our ring
  across every capture, and open_health (the author's own follow-up project) doesn't reference these
  tags anywhere either. Not worth further investigation.

All of these are already **stored raw** in `oura_raw_samples` regardless of decoder (ingest keeps
every tag ≥ 0x41; `app/api/oura-ble/samples/route.ts:47-60`). **None are in the rollup trigger set**
(`BIOMETRIC_TAGS`) yet, so nothing derives product data from them today.

### (B) Live plane — accurate, but the *stream itself* is expensive to hold open (NOT the RData lock)
- `SetRealtime(ACM 0x20)` (`OuraProtocol.accelStartSequence`, plugin `startAccel`) streams **live
  accelerometer**, and it is **NOT** the entitlement-locked RData/`0x03` path (that returns
  `INVALID_SUBTAG` on a consumer ring — sustained full-rate raw accel is unreachable). Samples arrive
  as tag **`0x33`** (NOT `0x5f` — corrected from open_oura `client.rs:529-552`): frame
  `[0]=0x33 [1]=len [2]=sampleRate [3]=seq [4..10]=x,y,z [10..16]=x,y,z?`, each axis **i16 LE raw
  count**, ~2 samples/frame, `magnitude=√(x²+y²+z²)`. The format is **documented → portable**. This is
  the classic pedometer input: filter → peak-count → steps.
  - ⚠️ **Native handling required:** `0x33 < 0x41`, so it's a *command-tag* frame — the current service
    only forwards/stores tags ≥ 0x41 (history events). Using the live stream needs a native decode +
    forward path (APK work), not just a JS decoder.
  - **Why this isn't "just leave it running": the counting logic itself is trivial** — a peak-counter
    naturally reads zero motion when the person is still, no special idle-handling needed. **The real
    cost is keeping the pipe open, not the algorithm:**
    1. `SetRealtime` is **time-boxed by the ring's firmware** (`max_duration_min` parameter) — it
       auto-expires and must be re-issued before it does. Running it 24/7 means continuous BLE command
       traffic re-arming the stream, not a one-time "turn it on."
    2. **The ring's own radio sleeps when worn-idle** (already-documented behavior, CLAUDE.md/ops
       matrix R1 — wakes on charger, worn+moving, or during sleep). A held connection during real idle
       stretches fights reconnect churn, it doesn't just "stream zeros" quietly.
    3. A live streaming connection (`CONNECTION_PRIORITY_HIGH`, continuous notify traffic, a
       phone-side peak-detector running) costs materially more ring + phone battery than the existing
       connect→drain→idle hourly pattern, independent of whether the person is moving.
  - **Not "unusable all day" — spend it selectively.** See the **two-tier gate** in §4: use the
    already-free passive plane (A) as a near-zero-cost trigger, and only hold the live `0x33` stream
    open during genuine activity windows (or an explicit user-started walk/workout), not continuously.
    (`0x5f raw_acm_event` in the *history* plane was never recovered upstream — a dead end; ignore it —
    this is unrelated to the live `0x33` stream, which is fully documented.)

**Net:** plane (A) is what's always running (free) and is the *gate*; plane (B) is what's expensive and
is the *accurate counter*, spent only when the gate says so. See §4 for the combined architecture.

## 3. Storage & display reality (where a step writer plugs in)

- **Hook point:** `aggregateOuraRawSamples` (adapter.ts:3420), the `byDay` map upserted at
  **adapter.ts:3735**. Add a derived `steps` per local day here. Timezone-correct day keying already
  exists (`toAestDay(toDate(ds), timezone)`).
- **Write is via `upsertBodyMetrics`** (adapter.ts:1586) — `COALESCE(EXCLUDED, existing)`, i.e. any
  non-null incoming value **overwrites**. There is **no `source` column** on `body_metrics` (unlike
  `oura_heartrate`), so we can't delete-and-reinsert; we merge into the shared daily row. **Two
  safeties required:**
  1. **Max-merge, not clobber:** the BLE step value must only win if it's ≥ the stored value (avoid an
     intraday partial overwriting a completed value). Since `upsertBodyMetrics` is plain COALESCE, do
     the max at the rollup (read current row, write `max(existing, derived)`), or add a
     `greatest()`-merge variant.
  2. **Partial-day "today" guard:** today's count is incomplete — mirror the wear-time
     `elapsedTodaySec` treatment already in the rollup (adapter.ts:3819) so a partial "today" isn't
     compared against completed days.
- **Rollup trigger:** add `0x50/0x47/0x6b/0x7e/0x7f` to `BIOMETRIC_TAGS` (route.ts) so a drain
  carrying motion frames re-aggregates.
- **Cache invalidation:** invalidate `body-metadata` + `health-trends*` groups (the same keys the
  Cloud sync path touches — `lib/cache-groups.ts`).
- **Display: no new UI.** `/api/body-metadata` already reads `body_metrics.steps` (and folds
  `activity_logs.steps`), and the health/session-select/home/stats surfaces already render it.

## 4. The approach — a two-tier gate (primary architecture)

**Core idea:** plane (A) is already running for free, all day, regardless of what we do — so use it as
a near-zero-cost **gate** that decides *when activity is happening*, and spend the expensive, accurate
plane (B) live stream only during those windows (or when the user explicitly starts a tracked walk).
This isn't "supervised calibration OR live streaming" — it's both, composed:

```
Tier 1 (always on, free)              Tier 2 (spent selectively, accurate)
passive history plane (A)      -->    live 0x33 accel stream (B)
  0x7e/0x7f paired via unpack27           peak-count magnitude → real step count
    (27 gait-feature columns;             for the duration of the activity window
     column 0 = clean idle/walk
     discriminator, see Phase 1),
  0x47 motion_seconds, 0x50 MET
  = "are they probably active,
     roughly how much" signal
        |
        v
  gate: active-enough? --------------> spin up Tier 2, hold it open
                                        while activity continues, then
                                        stop (or let SetRealtime expire)
```

- **Tier 1 never claims to count steps** — it only classifies "active vs. sedentary" (and roughly how
  active), from data we're already storing. Cheap, always running, no new battery/connection cost.
- **Tier 2 is the only thing that ever produces a real per-step count**, and it's spent like the DHR
  live-HR burst already is in this codebase (`triggerHrBurst`, battery-gated to relevant windows) —
  the same pattern, applied to accel instead of PPG.
- **If `0x51`/`0x52` (or a better `0x7e/0x7f` insight) ever pans out** — from the open_oura outreach or
  further captures — it becomes a *third, even-cheaper* source that can feed Tier 1 a real count
  instead of an estimate, without changing the gate architecture at all. Not required to ship.

### Phase 0 — Capture the calibration dataset (owner, on-device; tooling already shipped in #376) — ONGOING
Using the **"Dump step frames"** button, capture, each as a separate labelled dump:
- **idle** (sit still 2 min) — ✅ done (2026-07-09).
- **100 steps slow** — ✅ done (2026-07-09) — see Phase 1 result below.
- **100 steps brisk**, **200 steps**, **~20 steps** — still to capture; feed the same analysis.
Scratchpad `step-captures.md` holds the raw hex + the byte-diff script (`analyze_steps.py`).

### Phase 1 — Analyse the history plane: what can Tier 1's gate actually use? — PARTIALLY DONE, UPGRADED

**Round 2 result (naive per-frame unpacking, idle × 3 + gap × 4 + walk × 6, 2026-07-09):**
- **(a) Per-window step delta, naive unpack: DEAD.** Treating each `0x7e`/`0x7f` frame as an
  independent 14-byte blob, no byte is stable enough — walk-window values for the same byte position
  swing across a 200-point range despite a steady pace; one "walking" sample even reads *below* the
  idle mean. Confirmed noise for **this unpacking** — this is what `decodeRealSteps` and open_oura
  `main` both do; the finding stands for that method.
- **(b) Frame cadence: still DEAD.** `0x7e/0x7f` fire on a strict ~30s clock regardless of motion.
- **(0) `0x51`/`0x52`: still DEAD**, now doubly confirmed (§2A).

**Round 3 result (correct pairing via `unpack27`, same 13 samples re-analysed, 2026-07-09) — the
upgrade:** open_oura's `split-open-health` branch (not `main`) has a verified-correct pairing:
match each `0x7e` with the `0x7f` one ring-timestamp-unit later, then unpack both 14-byte bodies into
**27 quantized columns** using carry bits from `0x7f`'s last byte (`unpack27`, ported from
`open_health/tools/run_activity_model.py`). Re-running round 2's exact captured pairs through this
**correct** unpacking (not new data — same samples, right decode):
- **Column 0 cleanly separates idle/gap from walking, zero overlap:** idle/gap range **419–675**
  (n=7), walking range **760–848** (n=6). Every idle sample is below every walking sample. This is a
  genuine, reliable activity discriminator — not a step count, but a much stronger Tier-1 gate input
  than round 2's noisy per-byte trend.
- A few other columns (3, 11, 19, 21) shift meaningfully with activity but overlap between idle and
  walking — secondary signals, not standalone discriminators.
- **Caveat: n=13 from a single continuous session.** The clean separation is promising but needs
  confirming against the still-pending 100-brisk/200/~20 walks (different pace, different day) before
  trusting a fixed threshold — a single session could have an artifact (e.g. residual motion from
  sitting down) that happens to separate cleanly but doesn't generalize.
- **(d) Full feature regression:** still not the plan — column 0 alone may be enough for a binary
  gate; a regression across more of the 27 columns is a fallback if column 0 doesn't hold up on the
  remaining captures, not the default plan.

**Bonus, independent of unpack27:** open_health's own shipped step number (in its web/iOS clients) is
a crude **MET-threshold heuristic**, not gait-derived: `MET ≥ 7.0 → 150 steps/min`, `MET 2.5–7.0 → 105
steps/min`, else `0`, summed per day, rounded to the nearest 100 (`crates/oura-summary/src/lib.rs`).
Not ported from Oura's own ecore model (checked — no such function exists in the ecore-ported module),
just the author's own invented constants. Worth keeping as a **calibrated fallback** for Tier 1 if
`0x50` MET data is available but `0x7e/0x7f` column 0 isn't (MET fires far more rarely than `0x7e/0x7f`
on our ring — only ×2 across a multi-hour session in one capture).

**Remaining Phase-1 work:** collect the 3 outstanding walks (brisk/200/~20) to confirm column 0's
threshold holds across different paces/sessions — this decides whether Tier 1 ships as a clean binary
gate (column 0) or needs a small multi-column regression as a fallback.

### Phase 2 — Implement Tier 1 (server/JS, no rebuild)
- Port `unpack27` into `lib/oura-ble/decode.ts` (or a small sibling module) — pairs `0x7e`+`0x7f` by
  adjacent ring timestamp into the 27-column gait feature vector. Unit-pin it to the captured vectors
  in `step-captures.md` (input hex → expected 27 columns) so a transcription slip doesn't silently
  break the gate.
- New `lib/health/activity-gate.ts` (One-Formula-One-Place) — classifies each paired window as
  active/sedentary (+ rough level) primarily from unpack27's column 0 (Phase 1's threshold, once
  confirmed across the remaining captures), with `0x47`/`0x50` as secondary signal. This is NOT
  `lib/health/step-count.ts` — it does not produce a step number.
- Wire into `aggregateOuraRawSamples` to derive **active-minutes** per local day (a real, defensible
  product number on its own — distinct from "steps"), written to `body_metrics` with the same
  **max-merge + partial-day guard** as §3, and to the (future) history-plane step estimate if one ever
  becomes trustworthy.
- Add the motion tags to the rollup trigger set (`BIOMETRIC_TAGS`); invalidate `body-metadata` +
  `health-trends*` cache groups.

### Phase 3 — Implement Tier 2: the live accurate counter (native + server)
- Decode the **`0x33` realtime accel frame** (format known, §2B — i16 LE x/y/z, ~2 samples/frame). Add
  a native forward path for `0x33` (it's a command-tag frame `< 0x41`, so it isn't currently
  stored/forwarded like history events) so the samples reach JS.
- Peak-count over the filtered magnitude → a real step count for the duration the stream is held open.
- **Orchestration — battery-gated, not continuous** (mirrors the existing live-HR burst pattern):
  - Triggered by Tier 1's gate crossing the activity threshold, **or**
  - Triggered explicitly by the user starting a tracked walk/workout in the app (the guided-interval-walk
    feature already on the backlog is a natural host for this).
  - Stops when the gate drops back to sedentary, or the tracked session ends, or `SetRealtime`'s
    time-box expires without being re-armed.
- On-device: confirm `SetRealtime(ACM)` actually delivers `0x33` samples on our ring while worn+moving
  (unproven until tried). ⚠️ APK + on-device only.

### Phase 4 — Integrate: Tier 2's count feeds the daily total
- When Tier 2 runs (gated or explicit), its counted steps for that window **replace/augment** Tier 1's
  coarse estimate for the same window in the daily `body_metrics.steps` total — Tier 2 always wins where
  it ran, since it's the accurate source; Tier 1 only fills the gaps Tier 2 never covered.
- Same max-merge + partial-day guard applies to the combined write.

### Phase 5 — Validate & tune
- Fresh counted walks vs. Tier 2's live count (should be close — it's a real peak-counter) and vs. the
  full day's combined total (Tier 2 windows + Tier 1 gap-fill). Validate on-device (the S25 is the only
  real target). Honest target: Tier 2 windows are close to accurate; **whole-day totals are only as good
  as gate coverage** — a day with little explicit tracking and infrequent Tier-1-triggered bursts will
  under-count. That tradeoff is inherent to the architecture and should be reflected in UI copy (e.g.
  "steps tracked" rather than implying a lab-grade all-day pedometer).

## 5. Risks & honest expectations
- **We will not reproduce Oura's exact number** — their model + raw ACM are locked. This is *our*
  count, built from a different architecture than theirs (gated live-counting vs. a continuous
  on-device model).
- **Whole-day accuracy depends on gate coverage, not just the counter's precision.** Tier 2 itself is a
  real peak-counter (should be close to accurate when it runs); the daily *total* is only as complete
  as how much of the day Tier 1 triggered it (or the user explicitly tracked). A day with minimal
  explicit tracking under-counts — this is a coverage problem, not a precision problem, and no amount
  of tuning Tier 2 fixes it. Set UI copy expectations accordingly (§4 Phase 5).
- **The step-*count*-byte hunt in the history plane is closed for the naive unpacking** (round 2) —
  do not revisit per-frame `0x7e`/`0x7f` byte reads or cadence as a source of truth for a count;
  confirmed noise for that purpose. **The correct `unpack27` pairing (round 3) is NOT closed** — it
  produces a promising activity *discriminator* (column 0), pending confirmation on more captures; it
  is still not expected to yield a step *count* without Oura's own proprietary model.
- **`0x51`/`0x52` is closed, not parked** — doubly confirmed dead (never observed on our ring, and
  unreferenced in the author's own follow-up project). Stop investigating it.
- **Column 0's clean separation is n=13 from one session** — the single biggest remaining risk to
  Tier 1's design. If it doesn't hold up on the pending brisk/200/~20 captures (different pace,
  different day), fall back to a multi-column regression or the MET-threshold heuristic (§4 Phase 1)
  rather than trusting a single fixed threshold from one dataset.
- **Write-path safety is load-bearing:** a naive partial-day overwrite corrupts the day's steps — the
  max-merge + partial-day guard are not optional (§3), and apply to both tiers' writes.
- **Tier 2 depends on `SetRealtime(ACM)`/`0x33` behaving on our ring** — unproven until the on-device
  experiment. If it doesn't pan out, Tier 1's coarse active-minutes signal is the fallback ceiling —
  worth shipping on its own even if Tier 2 stalls, since it's still real product value (an "active
  minutes" metric) built from data already flowing.

## 6. Verification
- Phase 1: the activity-gate threshold reliably separates the captured walks from the idle baseline
  (no code yet — this is a data/calibration finding, pinned in `step-captures.md`).
- Phase 2 (Tier 1): `pnpm dev` — feed captured motion frames through the ingest+rollup, assert
  `body_metrics` active-minutes fills with a plausible value and the max-merge/partial-day guards hold
  (integration test against local Postgres, like `oura-ble-raw-dump.test.ts`). Cache groups invalidate.
- Phase 3 (Tier 2): on-device — confirm `0x33` samples arrive while worn+moving; live peak count during
  a counted walk ≈ the count.
- Phase 4/5: on-device — the combined daily total behaves sanely across a day with both gated bursts and
  an explicit tracked walk; the max-merge write never regresses a completed day. Device is the gate
  throughout (native SQLite/BLE inert in sandbox).
