# Oura Direct-BLE — Sleep Staging & Hypnogram: What We Can Actually Recover

**Written:** 2026-07-08. Self-contained findings brief. Supersedes the pessimistic
"no hypnogram over BLE" claims in [`oura-ble-remaining-work.md`](oura-ble-remaining-work.md)
(item 8) and the `projectOverview.md` session rows that call stages "null by design".

## The question

After the 2026-07-07 re-key, the Oura **Cloud** sync stopped. Cloud is what fed the sleep
**hypnogram** (`sleep_sessions.sleep_phase_5_min`) and the deep/light/REM split the Health
sleep screen renders. Post-re-key nights show HRV / resting-HR / duration but **no stages,
no hypnogram, no cycles**. How do we get them back in the BLE-only world?

## The finding: staging IS emitted over BLE — our own docs were wrong

Checked against `open_oura` directly (the project's rule: staging facts come from the
reverse-engineered source, not memory or our own notes):

- **`README`:** the ring's history-event stream "carries raw PPG/IBI/temperature/motion/SpO₂
  samples plus the ring's **on-device sleep stages**, activity MET levels, and HRV." Only the
  0–100 scores are phone-computed (ecore); the **stages themselves come off the ring**.
- **`docs/data-recovery-map.md`:** tags **`0x4b` / `0x4e` / `0x5a` (`sleep_phase_*`) carry the
  hypnogram** — `enum {DEEP, LIGHT, REM, AWAKE}`; tags **`0x49` / `0x4c` / `0x4f` / `0x58`
  (`sleep_summary_1..4`) carry bedtime, stage durations, lowest HR, contributors**. "Sleep
  staging and activity MET-binning happen **on the ring, not the cloud**," and these events were
  "cross-checked against live captures from a **Ring 3 Horizon and a Ring 5**."
- **`docs/ring-features.md`:** there is **no sleep feature to enable** — staging is not
  feature-gated (unlike REAL_STEPS `0x0b`). It's just part of the history buffer a normal
  `sync` drains.

So the `oura-native-ble` skill (§0/§1: "the ring emits its own hypnogram, read it, no model
needed") is **correct**. Our operational notes concluded "impossible / by design" from a
single incomplete on-device drain — the **same premature pessimism** we already had about
REAL_STEPS (first "can't be enabled", then open_oura showed it can). This corrects the record.

> **Addendum (2026-07-08, open_oura re-read):** don't over-swing the other way either. The same
> upstream repo contains a *competing* claim: `docs/algorithms/sleepnet.md` says the stager is a
> neural net (SleepNet) and calls the hypnogram *"the one metric not reproducible without Oura's
> cloud"*, and `algorithms/README.md` hedges it runs "on-device SleepNet PyTorch model **and/or the
> ring firmware**." That statement is about *recomputing* stages from raw signals with the encrypted,
> server-keyed model — the fallback path — **not** a claim the ring can't hand over finished stages;
> if the ring emits them (as the README + data-recovery-map's real Ring 3/5 captures say), no model is
> needed. Net: upstream **leans ring-emitted but is not internally unanimous**, and our own ring has
> produced zero phase events so far. Treat staging as **unverified, leaning available** — the
> `decodeSleepPhases`/rollup path is ready and dormant; the on-device captured vector below is the only
> thing that settles it. The `oura-native-ble` skill §0 now states this uncertainty explicitly rather
> than asserting either extreme.

## The current code reality (important nuance)

The rollup **already consumes** these events — this is not greenfield:

- `aggregateOuraRawSamples` (`lib/data/postgres/adapter.ts`) already fetches `phaseRows` from
  tags `[0x4b, 0x4e, 0x5a]` and already computes deep/REM/light/awake **hours** from them,
  assuming **30-second 2-bit codes**. Every stage field is gated on `phases.length > 0`.
- **Today `phases.length === 0`** — prod (2026-07-08) shows **zero** `0x4b/0x4e/0x5a` rows for
  this ring — so all stage fields resolve null and duration falls back to the sleep-signal
  window span. That's why the Health card shows duration but no stages.
- **The one genuine code gap:** even when phase events arrive, the rollup builds stage *hours*
  but **never assembles the `sleep_phase_5_min` string** the `Hypnogram` component renders. So
  the numeric chips would fill but the ribbon would stay blank. Closing that gap is small and
  reuses the existing 30 s assumption (no new decoder).

## What is NOT yet proven (needs an on-device captured vector)

We have **never captured a real `0x4b/0x4e/0x5a` event** from this ring. The decoder's unit
test uses a *synthetic* byte. So these remain **unvalidated against reality**:

1. **Why zero events today** — either (a) we've never done a clean *worn-overnight → next-morning*
   drain after the ring finalized staging, or (b) the forward-only sync cursor advanced past the
   span before the ring wrote staging into the history buffer (a documented cursor-skip hazard).
   The phase-3-4 results doc explicitly flags "a full overnight sleep drain end-to-end" as **not
   yet exercised**.
2. **Epoch length** — the skill says 30 s/code; standard sleep scoring is 30 s epochs; but this
   is not pinned to a captured Ring-5 vector.
3. **Tag redundancy** — `0x4b` (information) / `0x4e` (details) / `0x5a` (data) have *different*
   names. If they carry the *same* hypnogram, summing all three (as the current dormant code
   does) triple-counts. The staging outputs must be treated as **provisional** until a real
   capture settles which tag(s) carry the per-epoch stream.
4. **Timestamp semantics** — whether phase-event `ring_timestamp_ds` marks the epoch start, and
   whether codes step forward or backward, affects time-positioning of the ribbon.

## The plan (branches on one cheap diagnostic)

**Diagnostic gate (server-side, zero cost — run first):** query prod `oura_raw_samples` for
this user across all nights for tags `0x49, 0x4b, 0x4c, 0x4e, 0x4f, 0x57, 0x58, 0x5a`
(the `/admin/oura-ble` tester's raw-sample-summary path). Two outcomes:

- **Rows exist** → pure **rollup-wiring win** (server/JS): recognize + assemble
  `sleep_phase_5_min`, validate the rendered hypnogram against the owner's pre-re-key Oura
  history screenshots, then Redecode backfills history from archived `body_hex`.
- **No rows, ever** → **device-capture task** (APK): do a clean full-night drain, verify the
  cursor isn't skipping the staging span, re-check. Batches with the steps/EXERCISE_HR
  feature-enable (remaining-work item 2) and native reconnect (item 6), which already need a
  rebuild. If a real full-night drain still yields nothing, staging is genuinely gone for this
  ring/firmware and we fall to **our own model** from HR/HRV/motion/temp (remaining-work item 8).

**Independent of the above — the ribbon redesign** (`components/health/hypnogram.tsx`): rebuild
the current stepped-bar skyline into a proper Oura/Whoop-style **ribbon with connected stage
lanes**. This is a pure UI win that improves **every** night that has a `sleep_phase_5_min`
string (all the Cloud-era history) immediately, and lights up new BLE nights the moment a data
source lands.

## What this PR ships

1. This findings doc + the implementation plan (`docs/superpowers/plans/2026-07-08-oura-ble-sleep-staging-hypnogram.md`).
2. **Ribbon redesign** of the Hypnogram — the tangible, testable win (verified on dev against
   existing data).
3. **Rollup wiring** — assemble `sleep_phase_5_min` from the decoded phases (dormant until
   events arrive; clearly flagged provisional pending an on-device captured vector).
4. **Doc corrections** to `oura-ble-remaining-work.md` and `projectOverview.md`, plus a backlog
   entry for the on-device full-night drain + captured-vector validation.

---

## Update, 2026-07-09 (sessions 223–240): the ring emits no hypnogram — our own heuristic stager shipped

The diagnostic above ran: **zero** `0x4b/0x4e/0x5a` events across many full nights, worn-overnight
included. Option A (read the ring's own stages) is dead for this ring/firmware. Option B — our own
heuristic stager from movement/HR/HRV/temp — is the live path, shipped in `lib/health/sleep-staging.ts`
(session 223, v1.122.0) and iterated on heavily since via real on-device redecodes. This section is
the closing summary of that iteration arc and the reference for picking it back up.

### What got fixed (chronological, each shipped + merged)

| Session | Fix | Why |
|---|---|---|
| 226 (#360) | Onset latency derived from HR settling, refined to the second | Onset previously read ~0 (classified from the first epoch) |
| 227 (#362) | "Fell Asleep" tile in the sleep detail sheet | Onset latency wasn't visible anywhere but a small summary-card badge |
| 227 (#363) | First REM signal: within-epoch HR spread (`hrVar`) | 5-min mean HR hides REM's autonomic surges; `hrVar` recovers it |
| 230 (#366) | Stopped merging distant nap/rest fragments into the night | A short evening-rest/afternoon-nap/stray-BLE session was getting unioned into the main night, dragging bedtime/wake-time hours off |
| 232 (#369) | Sleep UI shows the actual asleep→woke window, not the in-bed window | Owner wanted real sleep times, not raw bedtime-to-getup |
| 234 (#372) | Per-epoch diagnostic tool in the BLE tester (`/admin/oura-ble` → "Sleep epochs (debug)") | Needed real per-epoch HR/movement/beat data to tune anything further without guessing |
| 235 (#374) | Onset over-trim fixed: a still + elevated-HR stretch now counts as sleep | A real captured night showed 105 min marked "awake" purely on HR while the ring recorded zero movement — early sleep, not wake |
| 236 (#375) | Isolated mid-sleep wake blips fold into sleep (restlessness, not lost time); REM_Z 1.0→0.65 | A single 5-min movement spike surrounded by sleep is a stir (Oura's own "restless periods" concept), not a real awakening; REM was unreachable at 1.0 |
| 238 (#377) | Header/stage-total time-window mismatch fixed; REM_Z 0.65→0.55 | The displayed time range excluded a trailing "awake in bed" stretch that the stage totals below it still counted — three different numbers for one night |
| 240 (#379) | REM_Z 0.55→0.45 | Steady, consistent ~+4pt REM gain per 0.10 step — kept nudging in the same direction |

### Where REM stands (paused here — collecting more data before the next nudge)

Real BLE nights (owner's Ring 5, not Cloud-era data):

| `REM_Z` | REM % observed |
|---|---|
| 1.0 (shipped default) | 0–8% |
| 0.65 | 10–13% |
| 0.55 | 14–15% |
| 0.45 (current, v1.122.20) | unconfirmed — next redecode |

Target is the owner's pre-re-key Cloud baseline, ~20–28%. Progress has been linear and predictable
so far (~+4pts per 0.10 drop in `REM_Z`) — there is no evidence yet that this trend has to bend, but
it hasn't been confirmed past 14–15%.

### How to tune further (do this next, once more nights have accumulated)

1. **Get the real per-epoch data first — don't guess.** Open `/admin/oura-ble` (admin console →
   Oura BLE tester → Advanced), type a date (`YYYY-MM-DD`), tap **"Sleep epochs (debug)"**. It dumps
   a copyable table: local time, HR, beats binned (tells you if `hrVar` even has data), movement,
   HRV, within-epoch spread, and the stage the model actually assigned, plus the night's `settleHr`
   threshold and `onsetEpoch`. Every fix above except the very first (#360) was informed by this
   exact dump — tuning blind is what caused the back-and-forth earlier in this arc; tuning from the
   dump is what converged it.
2. **Compare against the app's own summary** (Health → Sleep → tap the night) for Deep/REM/Light/
   Awake %, Time Asleep, and Sleep Latency, and against the owner's known baseline for that kind of
   night.
3. **Pick the knob by symptom**, all in `lib/health/sleep-staging.ts`:
   - **REM still too low** → lower `REM_Z` (current 0.45). Same-size steps (~0.10) have been
     predictable so far; keep the step size unless the per-epoch dump suggests otherwise.
   - **REM overshoots / light sleep gets misread as REM** → raise `REM_Z` back up.
   - **Deep % off** vs baseline → `DEEP_Z` (untouched this arc, currently 1.0 — deep has tracked
     baseline reasonably well throughout).
   - **REM signal not moving no matter what** → check the dump's `beats` column first. `hrVar` is
     null below 5 beats/epoch; if beats are consistently sparse, no `REM_Z`/`W_HRVAR` change will
     help — the ring isn't giving enough IBI density that night.
   - **Onset too aggressive** (marks real early sleep as awake) → this exact bug was fixed in #374
     (still + elevated HR now counts as sleep) — if it recurs on a different signature, the fix is in
     the `asleepAt`/`measuredStill` logic in `stageSleepDetailed`, not `ONSET_HR_MARGIN` alone.
   - **A single stir is eating time asleep** → already fixed in #375 (isolated interior wake bouts
     < `MIN_BOUT` fold into the surrounding stage when movement was measured). If a *sustained* bout
     (≥ `MIN_BOUT` epochs) is being folded when it shouldn't, that's the bug to chase — sustained
     bouts must never fold.
   - **Header time doesn't match the stage totals below it** → already fixed in #377
     (`lib/sleep/actual-window.ts` — only the *start* trims to onset; the *end* is always the raw
     window's natural end). If this recurs, check that whatever renders the header and whatever sums
     the stage minutes are reading the *same* window.
4. **Ship the same way each time**: change the constant with an inline comment (old value → new,
   the real-night numbers that motivated it, keep the history — see the block above `REM_Z` in the
   source for the pattern), run the full test suite (`lib/health`, `lib/sleep`,
   `lib/data/postgres/__tests__/oura-ble-sleep*`), bump the version + changelog (server/JS-only
   change, no APK rebuild), open a PR, merge on green CI. These are cheap, low-risk, reversible
   nudges — they don't need the merge-confirmation gate once the pattern above is established, but
   do tell the owner what changed and what to check after their next Sync/Redecode.
5. **The bigger lever, still not built**: breathing-rate variability from raw IBI resampling. This
   is documented (`oura-native-ble` skill, §9) as the strongest remaining REM/wake signal, but
   open_oura's own port of it is only partial (the resampling kernel is unresolved) — a real build,
   not a constant tweak. Worth revisiting if `REM_Z` nudges stop yielding gains before reaching
   baseline.

### Files map (for picking this back up cold)

| File | Role |
|---|---|
| `lib/health/sleep-staging.ts` | The stager itself — all tunable constants live here with inline history comments |
| `lib/data/postgres/adapter.ts` (`aggregateOuraRawSamples`) | Bins raw samples into epochs, calls the stager, writes `sleep_sessions`, captures the `debugNight` diagnostic |
| `lib/sleep/actual-window.ts` | Derives the displayed asleep→woke window from the hypnogram (start trims to onset, end is the raw window's natural end) |
| `lib/sleep/merge-sessions.ts` | Drops distant nap/rest fragments so they don't distort a night's bedtime/wake-time |
| `components/health-metric-sheet.tsx` | Sleep detail sheet UI — Time Asleep, Sleep Latency tile, hypnogram ribbon |
| `components/oura-ble/oura-ble-debug.tsx` | The tester — "Sleep epochs (debug)" button is the per-epoch diagnostic |
| `lib/health/__tests__/sleep-staging.test.ts` | Unit tests — mechanics only (direction/invariants), not tuned to an exact cutoff value |
| `lib/data/postgres/__tests__/oura-ble-sleep*.test.ts` | DB-rollup tests, including the mid-sleep-blip-fold and per-epoch-diagnostic tests |

---

## Update, 2026-07-09 (session 244): the heuristic is a *substitute*, not the endpoint — open_health reframes the accuracy story

The owner reported cycles still inaccurate and pointed at `Th0rgal/open_health` (the open_oura
author's own consumer app, on the divergent `open_oura@split-open-health` branch). A full read
of it **corrects the conclusion above** that "our heuristic is the live path" — that's still
true as *what's shipped*, but it is a substitute for something better, not the ceiling:

- **Oura's staging is a trained neural net (SleepNet), and it is runnable on the exact signals
  we already store.** ecore does **not** compute the hypnogram — it consumes a pre-computed
  30-second stage array (`open_health/docs/algorithms/README.md`, `sleepnet.md`). The stager is
  `sleepnet_moonstone_1_2_0` (PyTorch); `open_health/tools/run_sleep_model.py` runs it on
  IBI(0x60) + motion(0x47) + temp(0x46) + bedtime(0x76) — every input is already in our
  `oura_raw_samples`. So our z-score stager is a hand-built *approximation of a NN*. **This is
  why `REM_Z` nudging has a ceiling** — no threshold set matches a model trained on labelled PSG.
- **The model's blocker is a server-delivered decryption key, not the model logic.** It ships
  AES-256-GCM encrypted with a key fetched to a *logged-in Oura account session* (different from
  the ring key we own). open_health ships extraction tooling for it. Whether the owner can
  extract it is the go/no-go for the accurate path.
- **A cheaper lead we never checked:** the ring's **sleep-summary events** (`0x49/0x4c/0x4f/0x58`)
  are a *different* source from the phase events (`0x4b/0x4e/0x5a`) session 238 ruled out.
  open_health's `data-recovery-map.md` describes them as carrying ring-computed "bedtime, stage
  durations, lowest HR." We decode them already (`lib/oura-ble/decode.ts`, `_status:unvalidated`)
  but have **never confirmed whether our ring emits them**. If it does, that's real ring-computed
  stage durations with no model needed.

**New plan capturing all of this:**
`docs/superpowers/plans/2026-07-09-oura-ble-accurate-sleep-staging.md` — Phase 0 (cheap:
check for sleep-summary frames) → Phase 1 (better heuristic signals: breathing-rate variability)
→ Phase 2 (SleepNet-moonstone model, gated on key extraction). The `REM_Z`-tuning arc documented
above remains the shipped **fallback**; it is no longer framed as the destination.

---

## Update, 2026-07-09 (session 245): Phase 0 ran on-device — ring emits NO stage data; own-score recalibrated

**Phase 0 verdict (owner ran "Dump sleep frames" after an overnight drain):** `bedtime_period ×5`,
**zero `sleep_summary_1/2/3/4`, zero `sleep_phase_*`**. Definitive for this ring/firmware: the ring
emits only the sleep *window* over BLE, no ring-computed stages of any kind. This **rules out the
sleep-summary path too** (session 238 had already ruled out the per-epoch hypnogram) — **Option A
(read stages off the ring) is fully dead.** Accurate cycles is now strictly Phase 1 (improve the
heuristic — breathing-rate variability) or Phase 2 (the SleepNet model, gated on the parked
model-key extraction). See backlog item 2.

**Own Sleep Score recalibrated (v1.123.1):** the v1.123.0 score (`lib/health/sleep-score.ts`) read a
normal-good night at 94 (owner feedback: ceiling too easy to approach). Compressed the top ends of
the contributor curves (Total Sleep 8h→~90 not ~98, Efficiency 90%→~80, capped Latency/Timing peaks,
shaved the Restfulness base) so a very-good night now lands mid-to-high 80s and 90+ is reserved for
exceptional nights. Same reference night (7.6h / 91% / 12-min latency / null stages) went 93→85.
Regression guard added in `sleep-score.test.ts`. Curve *shapes* unchanged; this is a top-end squeeze.

---

## Update, 2026-07-09 (session 245): Phase 1 shipped — breathing-rate irregularity as a third REM signal

With Option A dead (ring emits no stages), Phase 1 of the accurate-staging plan is the pragmatic
in-sandbox improvement. Shipped v1.124.0: a new `lib/health/breathing-rate.ts` derives breathing-rate
**irregularity** from the IBI respiratory-sinus-arrhythmia oscillation (the tachogram oscillates once
per breath; REM breathing wanders → high CV, deep-sleep breathing is metronome-regular → low CV). The
stager (`lib/health/sleep-staging.ts`) now folds it in as a third REM signal (`breathVar`, weight
`W_BREATH = 0.4`) alongside the cardiac (HRV−HR) and within-epoch HR-spread (`hrVar`) terms. It's
**self-neutralising** — z-scored only over epochs that carry it, so a night with too few beats leaves
it 0 and all prior behaviour/tests are unchanged (the rollup wiring is exercised by the DB tests). The
`/admin/oura-ble` per-epoch debug dump gains a `brVar` column so it can be tuned against real nights.

**Not yet validated on a real night** — mechanics are unit-tested (regular vs irregular synthetic
tachograms discriminate correctly; sparse input → null) and the rollup path is DB-tested, but the
actual REM% lift needs the owner's next Sync/Redecode. If REM is still low after this, `W_BREATH` is
the lever to raise (like `REM_Z`/`W_HRVAR` before it); check the debug dump's `brVar`/`beats` columns
first — `brVar` is null when the beat stream is too sparse, in which case no weight change helps.

---

## Update, 2026-07-10 (session 250): heuristic ceiling reached — both tuning levers exhausted

Three consecutive on-device redecodes settled it. On the owner's BLE nights (07-08/09/10):

| Night | REM_Z 0.45 (v1.124.1) | REM_Z 0.35 (v1.124.2) | W_BREATH 0.7 (v1.124.4) | Cloud baseline |
|---|---|---|---|---|
| 07-10 | 1.1h | 1.1h | 1.4h (15%) | ~25% |
| 07-09 | 1.3h | 1.3h | 1.3h (17%) | ~25% |
| 07-08 | 0.8h | 0.8h | 0.6h (8%)  | ~25% |

- **Cutoff tuning is dead:** REM_Z 0.45→0.35 changed REM by **0.0h** on all three nights (sub-cutoff
  epochs are isolated singletons that `MIN_BOUT` smoothing removes).
- **Breathing weight is net-flat:** W_BREATH 0.4→0.7 helped 07-10 (+0.3h), did nothing to 07-09, and
  *hurt* 07-08 (−0.2h) — **+0.1h total**, just reshuffling stages, not adding real REM.
- The debug dump shows why: the ~22:48–04:13 stretch (prime REM-cycle territory) stays entirely
  "light" because the epochs that should be REM show only **moderate HR, moderate HRV, and isolated
  brVar spikes** — no sustained signature for any threshold to key on. The breathing signal is real
  and validated (brVar 0.9–1.0 at the *clear* REM bouts) but the *ambiguous* REM simply isn't in the
  ring's raw signal in a heuristic-recoverable form.

**Conclusion: the heuristic stager has hit its ceiling at ~8–17% REM vs the ~23–28% Cloud baseline —
roughly half. Both parameters are exhausted; further tuning is the "endless nudging" trap the arc
above already warned against, and is closed.** The remaining gap is exactly what a trained model
(SleepNet) recovers and a threshold heuristic cannot. Two honest options from here:
1. **Accept the heuristic** — it gets the night's *shape* (Deep/Light/REM present, wake/onset right),
   just under-reads REM by ~40%. Fine if approximate cycles are good enough.
2. **The SleepNet-model route** (Phase 2, parked) — the only path to Oura-parity REM, gated on the
   documented model-key extraction (rooted emulator, login-only, ring never paired).

`W_BREATH` was left at 0.7 (the validated signal, net-neutral vs 0.4); no further heuristic tuning is
planned. This is an owner decision point, not a tuning problem.

---

## Update, 2026-07-10 (session 259): cycle-aware REM/light decode — the one principled lever the cutoffs couldn't reach

The session-250 conclusion ("both tuning levers exhausted") held one unexamined assumption: that the
stager decides each epoch **in isolation**. It does (did) — step 3 was a per-epoch `remScore >= REM_Z`
cutoff, and the note explained why `REM_Z` went dead (sub-cutoff REM epochs are isolated singletons
that `MIN_BOUT` smoothing deletes). The missing lever is **cross-epoch structure**: REM occurs in
sustained cycles, so the decision should be made per-**bout**, not per-epoch.

**Shipped v1.126.0:** step 3 now assigns DEEP by the unchanged `DEEP_Z` cutoff (priority stage
byte-for-byte untouched — owner's stated top concern), then a **2-state Viterbi decode** (`decodeRemLight`
in `lib/health/sleep-staging.ts`) resolves the REM/light boundary over each contiguous run of
candidate epochs. Emissions are the existing scores (`remScore − REM_Z` per epoch, `light = 0`); the
only new parameter is `REM_SWITCH = 0.5`, a penalty per light↔REM transition. This makes REM a
**contiguous bout**: a brief mid-bout dip flanked by REM stays REM (bridged), a sustained light stretch
is never absorbed (proportional), and a lone below-threshold epoch never becomes a REM island.

**Why this is different from the `REM_Z`/`W_BREATH` nudges:** those re-weighted a per-epoch decision
that smoothing then flattened. This changes the *decision unit* from epoch to bout, so the ring's
**intermittent** REM signal (real at cycle peaks, wavering in between — exactly what the session-250
debug dump showed) gets bridged into bouts that survive. It's the "classical rule-based scorer" tier
(transition priors / HMM smoothing) sitting between per-epoch thresholds and a trained net — one
generation of method above where we were, still below SleepNet.

**Honest limits (unchanged from the arc's conclusion):** this is still **unverifiable without a
ground-truth night** — it's judged on "does the ribbon look physiologically sane + does per-night REM%
approach the ~23–28% baseline," the same soft check as before. It is a *rigid* prior (helps a normal
night, can mis-shape a fragmented/short one) where Oura's net applies temporal structure *adaptively*.
On a crafted intermittent-REM night it lifts REM into clean bouts (deep untouched); the **real-night
lift is the owner's next Redecode to confirm** (per-epoch dump at `/admin/oura-ble`).

**Tuning knob:** `REM_SWITCH` (higher ⇒ fewer/longer bouts, harder to start REM; lower ⇒ closer to the
old per-epoch behaviour), tuned alongside `REM_Z` against a real redecoded night. If real nights still
under-read REM, this is now the primary lever (the cutoff having been dead since session 250). If bouts
over-extend into light, raise it. The SleepNet-model route (Phase 2, parked) remains the only path to
true Oura-parity REM.

---

## Phase 1b Item 3 — SpO₂ micro-variability (shipped, awaiting a real-night verdict)

Plan: [`docs/superpowers/plans/2026-07-11-oura-ble-sleep-staging-phase1b-signal-upgrades.md`](superpowers/plans/2026-07-11-oura-ble-sleep-staging-phase1b-signal-upgrades.md),
item 3. **Item 1 (LF/HF) was already on `main`** when this was picked up — `hrv-frequency.ts`, the
`lfhf` epoch field and `W_LFHF = 0.5` all shipped earlier; the plan text is stale on that point.

**What it adds.** A fourth REM/wake correlate, `spo2Var`: the within-epoch standard deviation of
SpO₂ in percentage points (`packages/shared/src/health/spo2-variability.ts`), gated at five valid
samples and z-scored per night like every other refinement term, with `W_SPO2 = 0.2`.

**Why it is not just another re-weighting.** Every REM term the stager already carries is derived
from the tachogram — `hrVar` and `hrv` are its time-domain moments, `breathVar` its respiratory
oscillation, `lfhf` its spectrum. They are correlated by construction, which is why raising one has
repeatedly failed to move REM. `spo2Var` is read off the **oximeter** (`0x8b` R/PI → `spo2PctFromR`,
or the firmware `0x6f` percentage where a ring emits one), so it can disagree with all four. That
independence is the entire argument for adding it.

**Weight rationale.** Started at 0.2, well under the validated `W_BREATH = 0.7`, because ring-worn
SpO₂ variability in sleep is subtle and this signal has never been looked at on a real night. The
admin debug dump (`/admin/oura-ble` → "Sleep epochs (debug)") gains a `spo2V` column so the owner can
judge it from real data before the weight moves.

**What is NOT known yet, and the honest failure mode.** Two things, both answerable only on device:

1. **Whether the column is populated at all.** The gate needs ≥ 5 valid SpO₂ readings inside one
   5-minute epoch, and the ring's oximeter cadence over BLE has never been measured against that bar.
   If `spo2V` reads mostly blank, the term is inert — self-neutralising by construction (null →
   z-scored to 0), so nothing regresses, but nothing improves either.
2. **Whether it discriminates.** If the populated values turn out weakly bimodal, that is the same
   negative result `brVar` produced in session 246 — record it here and leave `W_SPO2` where it is
   rather than forcing it up.

**Verification that was possible in-sandbox:** unit tests on the pure spread function (floor,
artefact rejection, ranking) and two stager tests — one proving the term self-neutralises when the
column is uniform or absent, one proving it is genuinely read (a night differing *only* in its
`spo2Var` column stages differently; it fails with `W_SPO2 = 0`). The stager test deliberately does
not assert a direction: the per-night z-score is relative, so raising one block's variability lowers
every other epoch's, and on a synthetic night the time-of-night prior can dominate either effect.
**Direction is a real-night question, and this doc is where its answer belongs.**

---

## Phase 1b Item 2 — ultradian (~95 min) cycle prior (shipped, awaiting a real-night verdict)

Plan item 2. Adds a **periodic** modulation on top of the existing linear `W_TIME` term rather than
replacing it, so the coarse "deep skews early, REM skews late" trend the linear term already captures
is preserved.

**The structure it adds.** `W_TIME` applies `1 − 2·pos` — a straight ramp. Real architecture is
periodic: NREM→REM cycles run ~85–120 min and REM concentrates at the END of each cycle, growing
across the night rather than climbing smoothly through it. `ultradianRemBias(minsSinceOnset)` is
`cos(2π·m / 95) × min(1, m / (4 × 95))` — peaks on the cycle grid, troughs mid-cycle, amplitude
ramping from 0 at onset to full by cycle 4. `W_CYCLE = 0.15`, deliberately under `W_TIME = 0.25`, so
it modulates the trend rather than overriding it.

Why this could reach where the cutoff nudges could not: the session-250 dump showed the ~22:48–04:13
stretch — prime REM-cycle territory — reading as "moderate everything", with no single-epoch signal
decisive. A prior that *expects* REM to recur on a grid is different information from one that only
knows "later is more REM-ish".

**One thing the plan got wrong, worth not rediscovering.** It says to anchor the cycle clock to
`onsetEpoch`. That value does not exist yet at this point in the pass — the onset trim is step 4 and
the scoring loop is step 3. The anchor used is `sleepIdx[0]`, the first epoch that survived the wake
pass, which is also what the trim itself starts refining from.

**Testing, and its honest limit.** `ultradianRemBias` is unit-tested directly: peaks beat the troughs
on either side of them at every cycle (the periodic shape a monotonic ramp cannot produce), the ramp
grows cycle-over-cycle from zero, it saturates rather than diverging on a long night, and degenerate
input returns a neutral 0.

**No stager-level behavioural test ships with this, deliberately.** Several were attempted and all
were unfalsifiable: a flat synthetic night stages entirely light (the Viterbi switch cost swallows the
prior's advantage), and any night with enough contrast to cross the cutoffs saturates the REM bout to
all-or-nothing, so the assertion passes with `W_CYCLE = 0`. A test that cannot fail is worse than no
test. The term's behavioural effect is a real-night question — which is what this whole document
exists for.

**The revert is two addends.** If real nights don't improve — or if the fixed period fights the
Viterbi decoder's own transition structure on a fragmented night, the failure mode the plan names —
delete `− W_CYCLE * cycleBias` from `depth` and `+ W_CYCLE * cycleBias` from `remScore`.
