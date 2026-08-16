# Sleep System — reference

**Purpose:** the single "how sleep works in this app" reference — data flow, staging, scoring, the
signals we have, what's reliable vs approximate, the tuning discipline, and the open levers. Read this
before touching anything sleep-related or building on sleep data (scores, correlations, coaching).

**Companion docs:**
- [`docs/oura-ble-sleep-staging-findings.md`](oura-ble-sleep-staging-findings.md) — the append-only
  *history/log* of how the stager got here (session-by-session). This doc is the *stable reference*; that
  doc is the *narrative*. When they disagree, this one is authoritative for "current state."
- The sleep-staging accuracy roadmap (Phase 0/1/2) — private archive, see `scripts/private-paths.json`:
  its parked section is a model-key extraction procedure and is not publishable.
- [`docs/superpowers/plans/2026-07-11-oura-ble-lfhf-rem-signal.md`](superpowers/plans/2026-07-11-oura-ble-lfhf-rem-signal.md) — LF/HF plan (backlog item 22).
- [`docs/module-map.md`](module-map.md) — file index.

---

## 1. Data flow (one glance)

```
Ring 5  ──BLE──▶  oura_raw_samples (body_hex, archival)   [migration 114]
                        │  aggregateOuraRawSamples()  (lib/data/postgres/adapter.ts)
                        │    · cluster sleep-signal into night windows
                        │    · bin each window into 5-min epochs
                        │    · stage the epochs (lib/health/sleep-staging.ts)
                        ▼
                  sleep_sessions rows (stage hours, sleep_phase_5_min, HR/HRV, onset, efficiency)
                        │  read-time: merge / pick / window-derive (lib/sleep/*)
                        ▼
                  Health → Sleep card + hypnogram ribbon (components/hypnogram.tsx)
                        │
                  Sleep Score (lib/health/sleep-score.ts), consistency, correlations
```

**Key facts:**
- The **Ring 5 emits NO hypnogram over BLE** (confirmed dead, session 245 — zero `0x4b/0x4e/0x5a`
  phase events, zero `0x49/0x4c/0x4f/0x58` sleep-summary events across many full nights). So stages are
  **computed by our own heuristic stager**, not read off the ring. If phase events ever appear they take
  precedence (dormant code path exists).
- `oura_raw_samples.body_hex` is archival — the stager runs server-side off stored hex, so **Redecode**
  (`/admin/oura-ble`) restages all history with no re-drain and no APK rebuild. Every staging change is
  a server/JS change that ships via Railway.
- Nights are keyed by **wake-day** (`toAestDay(windowEnd)`), user timezone (AEST default).

---

## 2. The stager — `lib/health/sleep-staging.ts`

Classifies a night's **5-min epochs** into `deep | light | rem | awake`. Per-night self-normalising
(z-scores over each night's own distribution), so it's scale-invariant to the ring's raw magnitudes.
**Physiologically motivated, not clinical, and cannot be ground-truthed against Oura** (our BLE raw and
the pre-re-key Cloud stages never overlap in time).

### Per-epoch inputs (`SleepEpoch`)
| field | source | meaning |
|---|---|---|
| `movement` | `0x72` acm_mad mean | actigraphy; higher = more motion |
| `hr` | IBI (`0x60`/`0x80`) mean | mean HR (bpm) in the epoch |
| `hrv` | `0x5d` rmssd | mean rMSSD (ms); sparse → gap-filled by interpolation |
| `temp` | `0x75`/temp | mean skin temp (°C) |
| `hrVar` | SD of the epoch's beat HRs | within-epoch HR spread; high = REM surges, low = deep. null < 5 beats |
| `breathVar` | IBI RSA tachogram (`breathing-rate.ts`) | breathing-rate irregularity; high = REM/wake, low = deep. null when beats too sparse |

### Pipeline (in order)
1. **Wake detection** — an epoch is `awake` if **no signal**, **clear movement** (`> moveHi` = the
   90th-pct / 2× median movement), or **tachycardia without stillness** (`HR > floor + WAKE_HR_DELTA`
   and moving). *(A "quiet wake" rule was tried and reverted — see §6.)*
2. **DEEP** — assigned by a fixed z-cutoff `depth ≥ DEEP_Z` on a combined score
   (`cardiac = zHrv − zHr`, minus HR-instability/spread/breathing, plus temp and an early-night time
   term). Deep = low HR, high HRV, stable HR, regular breathing, elevated temp, earlier in the night.
   **Deep is the most reliable stage** (clean, non-ambiguous physiology). Assigned *before* the REM/light
   decode and never revisited.
3. **REM vs light — per-bout Viterbi decode** (`decodeRemLight`, session 259). Each still, non-deep
   epoch gets a REM-advantage (`remScore − REM_Z`); a 2-state Viterbi over each contiguous candidate run
   maximises summed REM-advantage minus `REM_SWITCH` per light↔REM transition. This makes REM a
   **contiguous bout** (bridges the ring's intermittent REM signal), instead of per-epoch thresholding
   that smoothing then deleted. REM signals: cardiac (HRV↓/HR↑), within-epoch HR spread, breathing
   irregularity, later-in-night.
4. **Onset/offset trim** — leading/trailing epochs stay `awake` until HR settles (`settleHr` = median
   sleep HR + margin) OR the epoch is *measurably still*. Refined below the 5-min grid by
   `refineOnsetLatencySec` using raw timestamped HR.
5. **Mid-sleep blip fold** — an isolated `< MIN_BOUT` measured-movement wake epoch flanked by sleep
   folds back into sleep (a stir/"restless period", not a real awakening); counted in `foldedWakeBouts`.
6. **Smooth** — sub-`MIN_BOUT` same-stage runs fold into neighbours (wake runs are never folded).

### Tunable constants (all in `sleep-staging.ts`, with inline history comments)
| const | current | role |
|---|---|---|
| `DEEP_Z` | 1.0 | deep cutoff. **Do not nudge lightly — deep is the reliable stage.** |
| `REM_Z` | 0.35 | REM emission reference. Dead as a solo lever since session 250 (singletons smoothed away). |
| `REM_SWITCH` | 0.5 | Viterbi transition penalty — **the live REM lever now** (higher = fewer/longer bouts). |
| `W_STAB` / `W_HRVAR` / `W_BREATH` | 0.4 / 0.4 / 0.7 | REM-signal weights (HR stability / spread / breathing). |
| `W_TEMP` / `W_TIME` | 0.2 / 0.25 | temp + linear time-of-night skew. |
| `WAKE_HR_DELTA` | 18 | tachycardia bar over the HR floor. |
| `MIN_BOUT` | 2 | smoothing / blip-fold threshold (10 min). |

---

## 3. Sleep scoring — `lib/health/sleep-score.ts`

A 0–100 **Sleep Score** we compute ourselves (`computeSleepScore`). **Not** Oura's proprietary model —
but the **combiner weights are Oura's actual weights**, recovered by open_health by regressing an Oura
Trends export against contributor sub-scores (Sleep Score reproduced at R²=0.9987):

| contributor | weight | notes |
|---|---|---|
| totalSleep | 35 | dominant |
| restfulness | 15 | |
| efficiency | 10 | |
| rem | 10 | **null on BLE nights lacking stage data** |
| deep | 10 | ditto |
| latency | 10 | U-curve |
| timing | 10 | circadian peak |

Per-contributor curves approximate open_health's fitted sub-score functions; recalibrated session 245 so
a very-good night lands mid-to-high 80s and 90+ is reserved for exceptional nights (a regression guard
lives in `sleep-score.test.ts`). **The combiner renormalises over whichever contributors exist** and
never fabricates a missing one — so a night with real stage hours (our stager now supplies them) scores
across all seven; a bare duration-only night scores on the subset. Related score/band code:
`score-band.ts` (bands + labels — always ship the label with the colour), `activity-score.ts`.

---

## 4. Supporting sleep modules (`lib/sleep/`, `lib/health/`)

| file | role |
|---|---|
| `lib/sleep/primary-sleep.ts` | `pickPrimarySleep` — choose the main night from multiple rows (`MIN_MAIN_SLEEP_H = 3`). |
| `lib/sleep/merge-sessions.ts` | `mergeByDate` — drop distant nap/rest fragments so a night isn't inflated by an evening rest (read-time). |
| `lib/sleep/actual-window.ts` | `actualSleepWindow` — the displayed asleep→woke window (start trims to onset; end is the raw window's natural end). |
| `lib/health/hypnogram.ts` | `SleepStage` type, `STAGE_COLOR` palette (defined once — don't fork it), phase-string helpers. |
| `lib/health/breathing-rate.ts` | `breathingFromIbi` — RSA tachogram → breathing-rate irregularity (a REM signal). **The even-grid resampler here is the base for the LF/HF lever.** |
| `lib/health/sleep-consistency.ts` | `computeSleepStartConsistency` — bedtime regularity. |
| `lib/health/hr-sleep-band.ts` | `bedtimeToMinuteWindow` — HR-band helpers over the sleep window. |
| `components/hypnogram.tsx` | the banded ribbon UI (renders `sleep_phase_5_min`). |

---

## 5. What's reliable vs approximate (be honest in the UI)

| stage | status |
|---|---|
| **Awake** | reliable for *clear* wake (movement / tachycardia / no-signal / onset). Cannot reliably detect *quiet* wake (lying still on a phone) — see §6. |
| **Deep** | **the most trustworthy stage.** Clean physiology (HR floor + high HRV + stability + regular breathing). Can slightly over-read at stage *boundaries* (a few morning epochs folded into an adjacent deep run — observed 07-13, ~15–20 min); not a threshold problem, not worth touching `DEEP_Z`. |
| **REM** | **directionally right, under-reads.** The per-bout decode gets bouts placed sensibly but lands ~half of Oura's ~23–28% baseline on sparse-beat nights — a **signal-density** ceiling (the ring's IBI goes sparse in the ambiguous stretches), not a tuning gap. On beat-dense nights it tracks well (07-12/07-13 REM ~19–27%). |
| **Light** | the residual — whatever isn't deep/REM/wake. |

**The hard ceiling:** Oura's staging is a trained neural net (SleepNet) on labelled PSG. A threshold+HMM
heuristic on cardiorespiratory signals is a principled *approximation* of that, not an equal. No amount
of constant-tuning closes the gap; only a trained model or new *independent* signal can. See §8.

---

## 6. Reverted: the "quiet wake" experiment (session 288, v1.139.6)

A rule to catch lying-awake-in-bed (sustained movement **and** HR both mildly elevated) was shipped
(v1.129.0) and **reverted**. It over-called badly — a real night read **33% / 3h15m awake** because the
movement gate was `movement > median` (≈half of every night exceeds the median by definition), so
combined with a low HR bar it swept ordinary light-sleep stirring into wake. **Lesson:** it was over-fit
to one labelled night; the movement bar must be well *above* the median, and it needs per-epoch dumps of
*over-called* nights to calibrate — not a single positive example. The real wake windows it was chasing
turned out to be caught by the existing clear-movement / no-signal rules anyway. If retried, do it
data-first against over-called dumps and verify before shipping.

---

## 7. Calibration log — real labelled nights (ground truth is scarce; keep adding)

We have **no PSG ground truth**, so accuracy is judged against (a) the owner's ~23–28% Cloud-era REM
baseline and (b) nights the owner *remembers*. Anchors collected so far:

| night | owner label / note | what the dump showed |
|---|---|---|
| 07-11 | awake on phone ~03:30–03:45 (~15 min) | co-elevated HR+movement; caught, but the rule that caught it over-called elsewhere → reverted |
| 07-12 | awake on laptop 03:40–04:15 | high movement (mv 3–4.5) + off-finger no-signal → caught by existing rules; post-revert Awake 6%/35m (correct) |
| 07-13 | "Deep looked a little high" | Deep 2.2h: core genuine (HR floor 58–62, HRV 45–70, stable/regular); ~15–20 min soft at the morning tail (boundary fold). True deep ~1.9–2.0h. |

**The single highest-leverage thing to improve accuracy: accumulate owner-labelled nights** ("I was
awake HH:MM–HH:MM", "that felt like a deep night"), and ideally a few nights with an independent
stage-scoring reference (a consumer EEG headband worn alongside the ring — re-onboarding Oura is
forbidden, a second tracker is fine). A handful of labelled nights is what would make any change
*verifiable* instead of "plausible vs baseline," and enough to fine-tune a model.

---

## 8. Open levers / roadmap (cheapest → hardest)

1. **LF/HF frequency-domain HRV** — backlog **item 22**, plan `2026-07-11-oura-ble-lfhf-rem-signal.md`.
   A *genuinely independent* REM signal (autonomic balance) reusing the `breathing-rate.ts` resampler.
   Best remaining heuristic lever; density-gated like breathing. **Owner-requested, in-sandbox buildable.**
2. **Explicit ultradian (~90-min) cycle prior** — replace the linear `W_TIME` with a periodic prior.
   Cheap, but rigid (helps a normal night, mis-shapes a fragmented one).
3. **Better quiet-wake** (§6) — only from over-called per-epoch dumps, movement bar ≫ median.
4. **SleepNet model (Phase 2, parked)** — the only path to Oura-parity REM. Runnable on the signals we
   already store (IBI/motion/temp/bedtime) but gated on extracting Oura's encrypted model key (rooted
   emulator, account login, ring never paired). See the accurate-staging plan's Phase 2.

**Discipline for any staging change (non-negotiable):**
- Get the real per-epoch dump first (`/admin/oura-ble` → "Sleep epochs (debug)") — **don't tune blind.**
- Change one constant with an inline history comment (old→new + the real-night numbers that motivated it).
- Run the sleep suite: `lib/health/__tests__/sleep-staging.test.ts`, `lib/sleep/__tests__/*`,
  `lib/data/postgres/__tests__/oura-ble-sleep*`.
- Server/JS-only → version bump + changelog; tell the owner what to Redecode and check.
- **Protect deep.** It's the reliable stage and the owner's priority (muscle growth). Don't touch
  `DEEP_Z`/deep terms to chase REM or a one-night hunch.

---

## 9. File map

| file | role |
|---|---|
| `lib/health/sleep-staging.ts` | the stager (all tunable constants live here) |
| `lib/health/breathing-rate.ts` | breathing-rate irregularity + the tachogram resampler |
| `lib/health/sleep-score.ts` | 0–100 Sleep Score (Oura combiner weights) |
| `lib/health/hypnogram.ts` | `SleepStage`, stage palette, phase-string helpers |
| `lib/sleep/primary-sleep.ts` · `merge-sessions.ts` · `actual-window.ts` | night selection / merge / displayed window |
| `lib/health/sleep-consistency.ts` · `hr-sleep-band.ts` | bedtime regularity, HR-band helpers |
| `lib/data/postgres/adapter.ts` → `aggregateOuraRawSamples` | windowing, epoch binning, calls the stager, writes `sleep_sessions`, captures the debug dump |
| `components/hypnogram.tsx` | banded ribbon UI |
| `components/oura-ble/*` (admin) | the "Sleep epochs (debug)" per-epoch diagnostic |
| `lib/health/__tests__/sleep-staging.test.ts`, `lib/data/postgres/__tests__/oura-ble-sleep*` | tests |

DB: `sleep_sessions` (stage hours, `sleep_phase_5_min`, `oura_id 'ble:<startDs>'`, HR/HRV/onset/efficiency),
`oura_raw_samples` (archival hex), `oura_daily` (scores/contributors).
