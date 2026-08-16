# Oura Direct-BLE — open_oura Re-Audit (2026-07-08)

**Self-contained context brief.** Point an agent at this file to understand what a
fresh read of the reverse-engineered [`Th0rgal/open_oura`](https://github.com/Th0rgal/open_oura)
source (cloned 2026-07-08, upstream last-updated the same day) says vs. what our
integration and knowledge base claim — and what is actually left to do. Read this
before touching the Oura BLE decode/rollup path or editing the `oura-native-ble` skill.

Related canon: the `oura-native-ble` skill (protocol knowledge base), the `oura-api`
skill (the retired Cloud path), `docs/oura-ble-operations.md` (failure matrix / runbook),
`docs/oura-ble-sleep-staging-findings.md` (the staging deep-dive), `docs/oura-ble-remaining-work.md`,
and `docs/implementation-backlog.md` items 1–4 + the Oura bullets under "Not yet queued".

---

## TL;DR

1. **Our decoders are correct.** `lib/oura-ble/decode.ts` is a faithful, byte-exact, and
   *complete* port of open_oura's `crates/oura-protocol/src/events.rs` `decode_body`. Every
   tag upstream decodes, we decode; the bit layouts match; the "unvalidated" markers match.
   There is **no decoder bug and no missing decoder** to fix.
2. **The "misinformation" is in the knowledge base's *confidence*, not the code** — specifically
   about the **sleep hypnogram**, where our docs (and even open_oura's own docs) assert
   *opposite certainties*. Corrected: the skill now holds the honest "unverified, leaning
   available, pending an on-device capture" position instead of either extreme.
3. **Steps:** our stance was already right (the `0x7e/0x7f` field layout is unidentified upstream
   too). The one operational fact: `REAL_STEPS` (`0x0b`) is off by default and our service enables
   only `DAYTIME_HR + SPO2`, so step events are **never produced**. This is already fully queued.
4. **Everything actionable is already in the backlog.** No new backlog entries were needed; no
   code changed. Only docs were corrected.

---

## Scope of the audit

- Cloned `open_oura` at commit `c5106bd` (2026-07-08). Read: `crates/oura-protocol/src/events.rs`
  (the source of truth for byte layouts), `README.md`, and `docs/`: `data-recovery-map.md`,
  `ring-5-observations.md`, `ring-features.md`, `sync-orchestration.md`,
  `algorithms/README.md`, `algorithms/sleepnet.md`, `algorithms/unvalidated-events.md`,
  `original-heuristics.md`.
- Cross-checked against our: `lib/oura-ble/decode.ts`, `lib/oura-ble/spo2.ts`,
  `aggregateOuraRawSamples` in `lib/data/postgres/adapter.ts`, the native service
  (`android/app/src/main/java/com/trainingai/app/oura/*.kt`), the backlog, and the
  `oura-native-ble` skill.

---

## Finding 1 — decoder parity (clean)

Every `decode_body` arm in `events.rs` has a matching arm in our `decodeEventBody`, with the
same byte arithmetic and the same validation guards. Confirmed tags:

`0x42, 0x43, 0x45, 0x46, 0x47, 0x49, 0x4b, 0x4c, 0x4e, 0x4f, 0x50, 0x53, 0x56, 0x58, 0x59,`
`0x5a, 0x5b, 0x5d, 0x60, 0x61, 0x69, 0x6b, 0x6c, 0x6f, 0x72, 0x74, 0x75, 0x76, 0x79, 0x7e,`
`0x7f, 0x80, 0x81, 0x82, 0x83, 0x84, 0x86, 0x87, 0x88, 0x8b`.

The same set carry `_status: "unvalidated"` in both (sleep summaries `0x49/0x4c/0x4f/0x58`,
real-steps `0x7e/0x7f`, `aohr 0x86`, `ambient 0x84`, atlas `0x87/0x88`, and the binary
`debug_data` subtypes). **Nothing to port.**

Events open_oura *lists but nobody decodes yet* (neither upstream nor us — so no lost work,
just the frontier): `0x44` ibi, `0x71` green_ibi_and_amplitude, `0x6e` spo2_ibi_and_amplitude,
`0x62` on_demand_meas, `0x70/0x77` spo2 variants, `0x51/0x52` activity_summary_1/2,
`0x73` ehr_trace.

---

## Finding 2 — sleep hypnogram: an UNRESOLVED question our docs kept answering with false certainty

This is the "sleep cycle" item. The hazard is that our knowledge base (and open_oura itself)
has stated the claim both ways as fact. **Neither extreme is proven.** What is actually true:

**Upstream leans "ring-emitted":**
- `README.md`: the history stream carries "the ring's **on-device** sleep stages."
- `docs/data-recovery-map.md`: `0x4b/0x4e/0x5a` (`sleep_phase_*`) = the DEEP/LIGHT/REM/AWAKE
  hypnogram; `0x49/0x4c/0x4f/0x58` (`sleep_summary_1..4`) = stage durations/bedtime/lowest-HR;
  "cross-checked against live captures from a **Ring 3 Horizon and a Ring 5**."
- `docs/ring-features.md`: there is **no sleep feature to enable** — staging rides the history
  buffer (unlike REAL_STEPS, which must be enabled).

**Competing note (why "leaning", not "certain"):**
- `docs/algorithms/sleepnet.md`: the stager is a neural net (SleepNet); calls the hypnogram
  *"the one metric not reproducible without Oura's cloud."*
- `docs/algorithms/README.md`: hedges the stager runs "on-device SleepNet PyTorch model
  **and/or the ring firmware**."
- Reconciliation: sleepnet.md's "cloud-dependent" is about *recomputing* stages from raw signals
  with the encrypted, server-keyed model — the **fallback path** — **not** a claim the ring can't
  hand over already-finished stages. If the ring emits them, no model is needed. SleepNet may
  simply run *on the ring firmware*.

**On our ring:** we've captured **zero** `0x4b/0x4e/0x5a` events (and no `0x76 bedtime_period`),
which is why the sleep card shows a duration (from the ACM `0x72` + sleep-temp `0x75` envelope)
but null stages. **But** we've never verified a clean *worn-overnight → next-morning* drain;
staging may only be written after on-ring sleep analysis finalises (trigger `0x28`); and the
forward-only history cursor can skip the span. **Absence-so-far ≠ proof of absence.**

**Current code reality:** `decodeSleepPhases` is byte-correct and `aggregateOuraRawSamples`
already consumes `0x4b/0x4e/0x5a` and computes stage hours — dormant only because no events
arrive. (Known gap noted in the findings doc: even if events arrive, the rollup builds stage
*hours* but doesn't yet assemble the `sleep_phase_5_min` ribbon string.)

**Correct position (now in the skill §0):** *unverified, leaning available.* The tiebreaker is
an on-device captured vector — **backlog item 4**. If a genuine full-night drain still yields
nothing, fall back to training our own stager from the raw HR/HRV/temp/motion we do decode.
**Do not write "stages are free/easy" or "stages are impossible/by-design" as fact.**

---

## Finding 3 — steps: our stance was right; the blocker is feature-enable, not decoding

- The `0x7e/0x7f` `real_steps_features` **field layout is unidentified upstream too**
  (`unvalidated-events.md`: "names TBD"). So our "steps stay phone-only for now" was correct.
- The under-appreciated fact: `REAL_STEPS` (`0x0b`) is **off by default** (server flag
  `activity/real_steps`), and our `OuraProtocol.enableMeasurementFeatures` enables only
  `DAYTIME_HR + SPO2`. **So the step events are never produced at all** — cracking the decoder
  later would find an empty table. Enabling REAL_STEPS is the prerequisite (needs an APK rebuild).
- It is **not** entitlement-locked: open_oura forced `SetFeatureMode(REAL_STEPS, AUTOMATIC)` on a
  consumer Ring 5 and got SUCCESS (`ring-features.md`, "What we enabled by hand"). Only research/raw
  (`0x01`/`0x12`) stay firmware-locked.
- Alternative source: `data-recovery-map.md` says step counts also ride `activity_summary_1/2`
  (`0x51/0x52`), which neither we nor upstream decode yet — may be easier than the bit-packed
  `0x7e/0x7f`.
- **All of this is already queued** (backlog "Ring steps over BLE — enable the feature, then a
  decoder", lines ~346-363).

---

## Finding 4 — analysis we could employ but don't (all already queued)

- **Temperature deviation + personal baseline** — open_oura has a *validated* ecore port
  (`oura-analysis::temperature`/`baseline`, asymmetric EMA). We store the `0x46/0x69/0x75` temps
  but compute nothing from them. Queued under "Extended metrics" Part A (intraday temp).
- **Breathing / respiratory rate** — lost when the Cloud went away; upstream port is partial
  (IIR coefficients recovered, 4 Hz resample kernel unresolved). Queued under Part C.
- **VO₂max, stress/recovery minutes, BDI** — Cloud metrics to reclaim via our own BLE
  derivations. Queued under Part C.

We already compute HRV (RMSSD), resting HR (lowest 5-min bin), SpO₂ (polynomial,
`lib/oura-ble/spo2.ts`), and the sleep window — those are done.

---

## What changed in this session (branch `claude/oura-api-gaps-cylz3y`, docs-only)

- `.agents/skills/oura-native-ble/SKILL.md` (v1.0.0 → v1.1.0): rewrote §0 tier table + the
  sleep-hypnogram consequence bullet, §1 reachable inventory, §6 (added the REAL_STEPS-gate note),
  §9 analysis table, §10 — all to the honest "unverified, leaning available" position, with the
  upstream contradiction cited on both sides.
- `docs/oura-ble-sleep-staging-findings.md`: added a dated addendum noting the `sleepnet.md`
  counter-claim so the doc isn't one-sided.
- **No code changes** (decoders are correct). **No new backlog entries** (all actionable gaps
  already queued).

## What a follow-up agent should NOT do

- Don't "fix" the decoders — they're a correct port.
- Don't re-assert either sleep-staging extreme. The only thing that resolves it is an on-device
  captured `0x4b/0x4e/0x5a` vector (backlog item 4).
- Don't add duplicate backlog items for steps / temp / respiratory rate — they're queued.
- Don't re-onboard the official Oura app to "get staging back" — that risks a firmware update that
  breaks the reverse-engineered protocol (see the skill §12 firmware-freeze doctrine).
