// Our own heuristic sleep stager. The Ring 5 does not emit a hypnogram over BLE and Oura's
// SleepNet weights are encrypted/unrunnable offline, so we compute DEEP/LIGHT/REM/WAKE ourselves
// from the raw signals we decode (movement, HR, HRV, temperature) — the approach open_oura
// recommends ("train/derive from the raw signals we do decode"). This is physiologically
// motivated (actigraphy for sleep/wake + cardiac autonomic signatures for REM vs deep), NOT
// clinical, and cannot be ground-truthed against Oura (our BLE raw and the old Cloud stages
// never overlap in time). Thresholds are provisional; the per-night quantile basis makes them
// scale-invariant, so they hold regardless of the absolute acm_mad movement magnitude.

import type { SleepStage } from './hypnogram'

export interface SleepEpoch {
  movement: number | null // accelerometer MAD magnitude (0x72 acm_mad mean); higher = more motion
  hr: number | null       // mean HR (bpm) in the epoch
  hrv: number | null       // mean rMSSD (ms) in the epoch
  temp: number | null      // mean skin temperature (°C) in the epoch
  hrVar?: number | null    // within-epoch HR spread (SD of beat HRs, bpm); high = REM surges, low = deep.
                           // Distinct from rMSSD (beat-to-beat jitter): captures the slower autonomic
                           // surges of REM that a 5-min mean HR hides. null when too few beats to trust.
  breathVar?: number | null // breathing-rate irregularity (CV of breath-to-breath timing, from IBI
                           // respiratory-sinus-arrhythmia; see lib/health/breathing-rate). High =
                           // irregular breathing = REM/wake; low = regular = deep. null when the beat
                           // stream is too sparse to derive it.
  lfhf?: number | null     // LF/HF frequency-domain HRV ratio (see lib/health/hrv-frequency). High =
                           // sympathetic-leaning = REM; low = parasympathetic = deep. An independent
                           // (frequency-domain) axis vs the time-domain terms above. null when the
                           // beat stream is too sparse to resolve the LF band.
  spo2Var?: number | null  // within-epoch SpO₂ spread (SD, percentage points; see spo2-variability).
                           // High = the desaturation-resaturation of irregular REM/wake breathing,
                           // low = flat deep-sleep breathing. A separate physiological channel from
                           // every term above — the oximeter, not the tachogram. null when the
                           // oximeter was too sparse in the epoch to trust a spread.
}

export const EPOCH_MIN = 5 // one epoch per 5 minutes — matches sleep_phase_5_min + HRV cadence

// Tuning constants (provisional — see plan doc). Absolute ones are physiological; the rest are
// relative to each night's own distribution.
// Movement is the primary wake signal (actigraphy). HR alone only flags wake at clear
// tachycardia — REM sits well above the resting floor but with atonia, so a small HR delta
// would misclassify REM as wake. Kept generous; tunable against the owner's baselines.
const WAKE_HR_DELTA = 18      // bpm above the night's resting floor (without movement) ⇒ awake
const WAKE_MOVE_MULT = 2      // movement above this × the night median (and the high quantile) ⇒ awake
const WAKE_MOVE_QUANTILE = 0.9
// Deep/REM are decided by FIXED cutoffs in each night's own signal space (z-scores of that
// night's signals), NOT by forcing a fixed proportion. So the stage mix EMERGES from the real
// data and floats night-to-night — a night with genuinely little deep shows little deep, rather
// than being padded to an average. The owner's Oura baselines (deep ≈12%, REM ≈24%, light ≈64%)
// are only a sanity check on the long-run AVERAGE, used to pick these cutoffs; they are tunable
// as real BLE nights accumulate (send a redecoded night to re-fit).
//
// The depth/REM scores combine the correlations documented for wearable staging (Oura's own
// method + the cardiorespiratory-staging literature):
//   deep = low HR + high HRV + STABLE HR (within & across epochs) + elevated skin temp, earlier
//   REM  = elevated HR + low HRV + VARIABLE HR (surges within & across epochs), later, with atonia
// Cardiac terms dominate; HR-stability, within-epoch HR spread, temperature and the time-of-night
// prior are weighted refinements. Two HR-variability signals at different timescales are used:
// the rolling ±10-min stability (zStab, between-epoch) and the within-epoch spread (zHrVar, the SD
// of beat HRs inside one 5-min epoch). They are complementary — a 5-min mean HR hides REM's slower
// autonomic surges, which the within-epoch spread recovers. A THIRD REM signal is breathing-rate
// irregularity (zBreath): REM breathing wanders while deep-sleep breathing is metronome-regular,
// recovered from the IBI respiratory-sinus-arrhythmia oscillation (lib/health/breathing-rate).
// Refinement weights are kept small so the cardiac signal (HR + HRV) stays the primary
// discriminator — the refinements only TIP borderline epochs. Tunable.
const W_STAB = 0.4           // between-epoch HR stability (±10 min): low ⇒ deep, high ⇒ REM
// Raised from 0.3 (session 236): real BLE nights carry hundreds of beats per epoch (hrVar is
// densely populated) while HRV (0x5d) is sparse and interpolated — lean more on the signal that's
// actually dense in practice.
const W_HRVAR = 0.4          // within-epoch HR spread (beat SD): high ⇒ REM surges, low ⇒ deep
// Breathing-rate irregularity (session 245): REM breathing is erratic, deep-sleep breathing is
// regular — a direct, physiologically independent REM signal (vs the cardiac terms). Self-neutralising
// (z-scored only over epochs that carry it, so a night with too few beats leaves it 0 and all prior
// behaviour/tests are unchanged).
// Raised 0.4→0.7 (session 249, owner's 07-08→07-10 redecode + debug dump): the REM cutoff is now a
// dead lever — dropping REM_Z 0.45→0.35 changed REM by 0.0h on all three BLE nights (epochs just
// under the cutoff are isolated singletons that get smoothed away). But the debug dump validated that
// brVar cleanly separates real REM (0.9-1.0 at REM onset vs 0.3-0.5 in deep), and this ring's REM
// often lacks the HR elevation the cardiac term keys on — so breathing is the signal that can reach
// the HR-quiet REM the cardiac score misses. Leaning on it is the last untried heuristic lever before
// the SleepNet-model route. Deep bouts (low brVar) are pushed further into deep, so this is safe for
// them. If this still doesn't lift REM to the ~25% baseline, the heuristic has hit its ceiling.
const W_BREATH = 0.7        // breathing irregularity (CV of breath timing): high ⇒ REM, low ⇒ deep
// LF/HF autonomic-balance ratio (lib/health/hrv-frequency): high ⇒ REM (sympathetic-leaning), low ⇒
// deep — same sign as the other variability terms, but a frequency-domain axis physiologically
// independent of the time-domain RMSSD/HR-spread signals, so it can move REM where re-weighting the
// correlated terms cannot. Density-gated (null on sparse epochs → z-scored to neutral 0), so nights
// without dense beats are unaffected. Provisional starting weight; the primary lever the owner tunes
// against redecoded nights (raise it if REM stays under-read on beat-dense nights).
const W_LFHF = 0.5
// SpO₂ micro-variability (see spo2-variability): high ⇒ REM/wake (irregular breathing drives
// desaturation-resaturation), low ⇒ deep. Same sign as the other variability terms, but read off the
// oximeter rather than the tachogram — so unlike raising W_BREATH or W_LFHF it adds a genuinely
// separate channel rather than re-weighting a correlated one. Density-gated (null on sparse epochs →
// z-scored to neutral 0), so nights whose oximeter was quiet are unaffected.
// Deliberately started well below the validated W_BREATH = 0.7: ring-worn SpO₂ variability in sleep
// is subtle and noisy, and this signal has never been looked at on a real night. Raise it only on
// evidence from the admin debug dump's spo2Var column, the same way W_BREATH earned 0.4→0.7. If the
// column turns out weakly bimodal (the way brVar did in session 246), that is a valid negative
// result — record it in the findings doc and leave the weight where it is.
const W_SPO2 = 0.2
const W_TEMP = 0.2           // elevated skin temp supports deep
const W_TIME = 0.25          // deep skews earlier, REM later in the night
// Ultradian (NREM→REM) cycle length. Sleep architecture is periodic, not linear: REM recurs at the
// END of each cycle rather than ramping smoothly all night, which is structure the W_TIME term above
// cannot express. 95 min sits mid-range of the 85–120 min physiological spread. A fixed period is an
// approximation — real cycles vary between people and lengthen across the night — so this modulates
// the linear trend rather than replacing it.
const ULTRADIAN_MIN = 95
// Cycles over which REM's share ramps to full. REM is short or absent in cycle 1 and dominant by
// cycle 4–5, so the periodic term starts at zero amplitude and grows — which is also what keeps its
// cos peak at sleep onset (see ultradianRemBias) from wrongly favouring REM in the first minutes.
const ULTRADIAN_RAMP_CYCLES = 4
// Amplitude of the periodic modulation. Deliberately under W_TIME so it tips epochs inside an
// expected REM window without overriding the coarse "REM skews late" trend, and because a fixed
// period can fight the Viterbi bout decoder's own transition structure on a fragmented night. If
// real redecoded nights don't improve, delete the two `W_CYCLE *` addends — that is the whole
// revert.
const W_CYCLE = 0.15

/**
 * Ultradian cycle-position prior: how much this moment into the night favours REM over deep, from
 * −1 (mid-cycle, deep territory) to +1 (cycle boundary, REM territory).
 *
 * `cos` peaks at every whole multiple of {@link ULTRADIAN_MIN} — the end of each NREM→REM cycle,
 * where REM concentrates — and troughs mid-cycle where slow-wave sleep sits. It also peaks at
 * minute 0, which would be wrong on its own (the first minutes of sleep are deep, not REM); the
 * amplitude ramp is what suppresses that, growing from 0 at onset to full by
 * {@link ULTRADIAN_RAMP_CYCLES} cycles in. That ramp is the same fact stated twice: REM is short or
 * absent in cycle 1 and dominant by cycle 4–5.
 *
 * Exported for testing — it is a prior, not a score, and nothing outside the stager should use it.
 */
export function ultradianRemBias(minsSinceOnset: number): number {
  if (!Number.isFinite(minsSinceOnset) || minsSinceOnset <= 0) return 0
  const phase = (2 * Math.PI * minsSinceOnset) / ULTRADIAN_MIN
  const amplitude = Math.min(1, minsSinceOnset / (ULTRADIAN_RAMP_CYCLES * ULTRADIAN_MIN))
  return Math.cos(phase) * amplitude
}
const STAB_WIN = 2           // ± epochs for the rolling HR-variability window (±10 min)
// Cutoffs on the combined score. Set so only CLEARLY deep/REM epochs qualify — light epochs read
// as mildly-below-average HR once REM inflates the night mean, so a loose cutoff leaks them into
// deep. These are the primary calibration knobs: raise to shrink deep/REM, lower to grow them.
// Tune against a real redecoded night (proportions still float with the data either way).
const DEEP_Z = 1.0           // deep: HR clearly low AND HRV clearly high for the night (depth z ≥ this)
// Lowered from the original 1.0 (session 236, from a real redecoded BLE night): the synthetic tests
// this was tuned against used dramatic HR separation (60 vs 70 bpm); real nights run far subtler
// contrasts, and the HRV term (0x5d) arrives sparsely and gets interpolated, damping the cardiac
// signal's natural amplitude. 1.0 left REM essentially unreachable on real data (0-8% vs the
// owner's ~20-28% baseline) despite hrVar having ample beats to work with.
// Lowered again, 0.65→0.55 (session 237): the 1.0→0.65 drop moved real nights from 0-8% to only
// 10-13% REM — still meaningfully under baseline — so REM remains under-scored at 0.65. Another
// nudge in the same direction.
// Lowered again, 0.55→0.45 (session 240): 0.65→0.55 moved real nights to 14-15% REM — steady,
// consistent progress each nudge (~+4pts per 0.10 drop) but still under the ~20-28% baseline.
// Same-size step again. Still provisional; re-tune again as more redecoded nights confirm where
// it should land.
// Lowered again, 0.45→0.35 (session 246, from the owner's 07-08→07-10 redecode + debug dump):
// adding the breathing-irregularity signal (W_BREATH) did NOT clearly lift REM — real BLE nights
// still read 11-17% vs the ~25% Cloud baseline, with the night reading mostly Light (REM squeezed
// into Light). The `brVar` values are only weakly bimodal (~0.4-0.5 typical), so breathing alone
// isn't flipping borderline epochs; the REM cutoff is still the dominant lever. Now that breathing
// gives an independent cross-check against false REM, a further drop is safer. Same 0.10 step.
const REM_Z = 0.35           // rem: HR elevated + HRV low for the night (rem z ≥ this), with atonia
// Cross-epoch transition prior for the REM↔light boundary (session 259). The per-epoch cutoff
// above decides each epoch in isolation, then MIN_BOUT smoothing deletes isolated REM epochs — so
// dropping REM_Z stopped moving REM at all (findings doc, session 250: sub-cutoff epochs are
// singletons that get smoothed away). A Viterbi decode over each contiguous run of light/REM
// candidate epochs replaces that: it maximises summed REM-advantage (remScore − REM_Z per epoch)
// minus a switch cost, so REM is chosen as a CONTIGUOUS BOUT rather than per-epoch. The physiology:
// REM occurs in sustained cycles, so a brief mid-bout dip (one epoch whose own signal wavers) stays
// REM when flanked by REM, and a lone below-threshold epoch never becomes a REM island. This bridges
// the ring's intermittent REM signal into bouts that survive smoothing — the lever the exhausted
// REM_Z cutoff could not reach. DEEP is assigned by the unchanged cutoff BEFORE this runs and is
// never revisited here, so the priority stage is untouched. Higher ⇒ fewer/longer bouts (more
// bridging, harder to start REM); lower ⇒ closer to the old per-epoch behaviour. Tunable against a
// real redecoded night alongside REM_Z.
const REM_SWITCH = 0.5       // score penalty per light↔REM transition in the Viterbi decode
const MIN_BOUT = 2           // epochs (10 min) — shorter same-stage runs get smoothed away
// Sleep onset: an epoch counts as asleep once HR has settled to (roughly) the night's typical
// sleep level. Anchored to the MEDIAN sleep HR (+ a small margin), not the deep floor — light
// sleep sits well above the floor, so a floor-relative cutoff would wrongly trim real sleep.
const ONSET_HR_MARGIN = 2

const nums = (xs: (number | null)[]): number[] => xs.filter((v): v is number => v != null && Number.isFinite(v))
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const median = (xs: number[]): number | null => quantile(xs, 0.5)
function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))
  return s[i]
}

// Fill null gaps in a slowly-varying signal (HRV/HR) from the nearest non-null neighbours, so a
// sparse HRV stream doesn't leave most epochs unclassifiable. Pure interpolation of what's there —
// never invents beyond the measured range.
function fillGaps(xs: (number | null)[]): (number | null)[] {
  const out = [...xs]
  let last: number | null = null
  for (let i = 0; i < out.length; i++) { if (out[i] != null) last = out[i]; else out[i] = last }
  let next: number | null = null
  for (let i = out.length - 1; i >= 0; i--) { if (xs[i] != null) next = xs[i]; else if (out[i] == null) out[i] = next }
  return out
}

export interface SleepStagingResult {
  /** Per-epoch stages (the 5-min hypnogram). */
  stages: SleepStage[]
  /** Index of the epoch sleep begins in (first non-awake epoch after smoothing); `stages.length`
   *  if the night never settles. Used to refine onset latency below the epoch grid. */
  onsetEpoch: number
  /** HR at/below which an epoch counts as "settled into sleep" (median sleep HR + margin), or
   *  null when there isn't enough HR data. The same threshold the onset trim uses. */
  settleHr: number | null
  /** Count of brief (< MIN_BOUT), measured-movement mid-sleep wake bouts that were folded back
   *  into sleep (see step 4.5) — kept so callers can still tally them as restless/awakening
   *  events even though they no longer subtract from time asleep. */
  foldedWakeBouts: number
}

/** Classify a night's 5-min epochs into DEEP/LIGHT/REM/WAKE. Wake is actigraphy-driven; deep and
 *  REM are decided by FIXED cutoffs on a combined cardiac + HR-stability + temperature + time-of-
 *  night score, z-scored within each night — so the stage mix emerges from the real signals and
 *  varies night-to-night (no forced proportions). */
export function stageSleep(epochs: SleepEpoch[]): SleepStage[] {
  return stageSleepDetailed(epochs).stages
}

/** Like {@link stageSleep} but also returns the onset epoch and settle-HR threshold, so callers
 *  with the raw timestamped HR series can refine onset latency below the 5-min grid (see
 *  {@link refineOnsetLatencySec}). */
export function stageSleepDetailed(epochs: SleepEpoch[]): SleepStagingResult {
  const n = epochs.length
  if (n === 0) return { stages: [], onsetEpoch: 0, settleHr: null, foldedWakeBouts: 0 }

  const moves = nums(epochs.map(e => e.movement))
  const moveMed = median(moves) ?? 0
  const moveHi = Math.max(quantile(moves, WAKE_MOVE_QUANTILE) ?? Infinity, moveMed * WAKE_MOVE_MULT)
  const hrFloor = quantile(nums(epochs.filter(e => e.movement == null || e.movement <= moveMed).map(e => e.hr)), 0.05)

  // 1. Wake: no signal, clear movement, or clear tachycardia without stillness.
  const stages: SleepStage[] = new Array(n).fill('light')
  const sleepIdx: number[] = []
  for (let i = 0; i < n; i++) {
    const e = epochs[i]
    const noSignal = e.movement == null && e.hr == null && e.hrv == null
    const moving = e.movement != null && e.movement > moveHi
    const tachy = e.hr != null && hrFloor != null && e.hr > hrFloor + WAKE_HR_DELTA && (e.movement == null || e.movement > moveMed)
    if (noSignal || moving || tachy) stages[i] = 'awake'
    else sleepIdx.push(i)
  }
  if (sleepIdx.length === 0) return finalize(smooth(stages), null, 0)

  // 2. Fill sparse gaps, then z-score over the sleep epochs (per-night, self-normalizing).
  const hrF = fillGaps(epochs.map(e => e.hr))
  const hrvF = fillGaps(epochs.map(e => e.hrv))
  const tempF = fillGaps(epochs.map(e => e.temp))
  const zof = (vals: (number | null)[]) => {
    const xs = nums(vals)
    const m = mean(xs) ?? 0
    const sd = xs.length ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) : 0
    return (v: number | null) => (sd > 0 && v != null ? (v - m) / sd : 0)
  }
  // Short-term HR variability: SD of HR over a ±STAB_WIN window (deep = stable, REM = fluctuating).
  // Exclude wake epochs from the window — a wake HR spike must not inflate an adjacent sleep
  // epoch's variability and misread it as REM.
  const hrStab = epochs.map((_, i) => {
    const w: number[] = []
    for (let j = Math.max(0, i - STAB_WIN); j <= Math.min(n - 1, i + STAB_WIN); j++) {
      if (hrF[j] != null && stages[j] !== 'awake') w.push(hrF[j] as number)
    }
    if (w.length < 2) return 0
    const m = w.reduce((a, b) => a + b, 0) / w.length
    return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length)
  })
  const zHr = zof(sleepIdx.map(i => hrF[i]))
  const zHrv = zof(sleepIdx.map(i => hrvF[i]))
  const zTemp = zof(sleepIdx.map(i => tempF[i]))
  const zStab = zof(sleepIdx.map(i => hrStab[i]))
  // Within-epoch HR spread: z-scored over the epochs that actually carry it (null when too few
  // beats), so a night with no per-beat data leaves this term neutral rather than skewing.
  const hrVarOf = (i: number) => epochs[i].hrVar ?? null
  const zHrVar = zof(sleepIdx.map(hrVarOf))
  // Breathing-rate irregularity: z-scored over epochs that carry it (null when too few beats), so a
  // night without it stays neutral. High ⇒ REM, low ⇒ deep — same sign as the HR-spread term.
  const breathVarOf = (i: number) => epochs[i].breathVar ?? null
  const zBreath = zof(sleepIdx.map(breathVarOf))
  // LF/HF autonomic balance: z-scored over epochs that carry it (null on sparse beats → neutral), so a
  // night without dense beats leaves this term at 0. High ⇒ REM, low ⇒ deep — same sign as zBreath.
  const lfhfOf = (i: number) => epochs[i].lfhf ?? null
  const zLfhf = zof(sleepIdx.map(lfhfOf))
  // SpO₂ micro-variability: z-scored over epochs that carry it (null on a sparse oximeter → neutral).
  // High ⇒ REM/wake, low ⇒ deep — same sign as zBreath and zLfhf.
  const spo2VarOf = (i: number) => epochs[i].spo2Var ?? null
  const zSpo2 = zof(sleepIdx.map(spo2VarOf))
  const still = (i: number) => epochs[i].movement == null || (epochs[i].movement as number) <= moveMed

  // 3. Fixed-cutoff DEEP (unchanged — the priority stage stays exact), then a Viterbi decode of the
  //    REM/light boundary. Non-still epochs are light; DEEP wins by the same z-cutoff as before. Any
  //    still, non-deep epoch becomes a REM/light CANDIDATE — we record its REM advantage
  //    (remScore − REM_Z, >0 when it clears the old REM cutoff) and leave the DEEP/light choice to
  //    the transition-aware pass in step 3.5. Proportions still float with the data.
  const remAdv: (number | null)[] = new Array(n).fill(null) // REM advantage for candidates; null = fixed
  for (const i of sleepIdx) {
    if (!still(i)) { stages[i] = 'light'; continue }
    const pos = n > 1 ? i / (n - 1) : 0 // 0 = start of night, 1 = morning
    // Ultradian cycle position, anchored to the first non-wake epoch. The plan for this term said to
    // anchor it to `onsetEpoch`, but the onset trim is step 4 — it has not run yet here, so the real
    // onset is not knowable at this point in the pass. The first epoch that survived the wake pass is
    // the closest thing available, and it is what the trim itself starts refining from.
    const cycleBias = ultradianRemBias((i - sleepIdx[0]) * EPOCH_MIN)
    const cardiac = zHrv(hrvF[i]) - zHr(hrF[i]) // + when HRV high & HR low
    const varZ = zHrVar(hrVarOf(i)) // + when this epoch's beats are unusually spread (REM surges)
    const brZ = zBreath(breathVarOf(i)) // + when breathing is irregular this epoch (REM)
    const lfZ = zLfhf(lfhfOf(i)) // + when LF/HF is high this epoch (sympathetic-leaning ⇒ REM)
    const spZ = zSpo2(spo2VarOf(i)) // + when SpO₂ wobbles this epoch (irregular breathing ⇒ REM/wake)
    const depth = cardiac - W_STAB * zStab(hrStab[i]) - W_HRVAR * varZ - W_BREATH * brZ - W_LFHF * lfZ - W_SPO2 * spZ + W_TEMP * zTemp(tempF[i]) + W_TIME * (1 - 2 * pos) - W_CYCLE * cycleBias
    if (depth >= DEEP_Z) { stages[i] = 'deep'; continue }
    const remScore = -cardiac + W_STAB * zStab(hrStab[i]) + W_HRVAR * varZ + W_BREATH * brZ + W_LFHF * lfZ + W_SPO2 * spZ + W_TIME * (2 * pos - 1) + W_CYCLE * cycleBias
    remAdv[i] = remScore - REM_Z
    stages[i] = 'light' // provisional — decided in step 3.5
  }

  // 3.5. Viterbi over each contiguous run of REM/light candidates: pick the labelling that maximises
  //      summed REM advantage minus REM_SWITCH per light↔REM transition. This turns the per-epoch
  //      REM cutoff into a per-BOUT decision — bridging the ring's intermittent REM signal into
  //      sustained bouts and refusing lone REM islands (see REM_SWITCH). DEEP epochs (remAdv null)
  //      break runs and are never revisited.
  decodeRemLight(stages, remAdv)

  // 4. Onset/offset trim (sleep latency). Before sleep you lie in bed settling in — HR still at the
  //    awake level. Mark leading (and trailing, morning) epochs awake until you're asleep. An epoch
  //    counts as asleep once HR has SETTLED (≤ median sleep HR + margin) OR you are MEASURABLY STILL
  //    (movement recorded and low). Stillness matters because early-night sleep can run at an
  //    elevated HR (a warm/active evening); calling that "awake" purely on HR over-trims — a real
  //    105-min case where the ring recorded zero movement the whole time. Note: an epoch with NO
  //    movement data does NOT count as still here, so a sparse leading epoch can't prematurely end
  //    the trim. Only the two boundaries are touched, so mid-night REM (also elevated HR) is safe.
  const hrMedSleep = median(nums(sleepIdx.map(i => hrF[i])))
  const settleHr = hrMedSleep != null ? hrMedSleep + ONSET_HR_MARGIN : null
  const measuredStill = (i: number) => epochs[i].movement != null && (epochs[i].movement as number) <= moveMed
  const asleepAt = (i: number) =>
    stages[i] !== 'awake' &&
    ((settleHr != null && hrF[i] != null && (hrF[i] as number) <= settleHr) || measuredStill(i))
  let onset = 0
  while (onset < n && !asleepAt(onset)) onset++
  let offset = n - 1
  while (offset >= 0 && !asleepAt(offset)) offset--
  if (onset <= offset) { // a sleep span exists — trim only the awake margins around it
    for (let i = 0; i < onset; i++) stages[i] = 'awake'
    for (let i = offset + 1; i < n; i++) stages[i] = 'awake'
  }

  // 4.5. Fold brief, MEASURED-movement mid-sleep wake blips back into sleep. A single 5-min epoch
  //      of elevated movement surrounded by sleep on both sides is a stir/micro-arousal, not a true
  //      awakening — commercial trackers (Oura included) count these as "restless periods" WITHIN
  //      sleep rather than subtracting them from time asleep. Only INTERIOR runs qualify (both
  //      neighbours must be non-awake) — the leading/trailing edges are the onset/offset trim's
  //      territory (step 4) and are never touched here. A run with any epoch missing movement data
  //      is left as-is (we can't attest it was just a stir). Sustained runs (≥ MIN_BOUT epochs, ~10+
  //      min) remain genuine awake time — only isolated blips fold. The folded count is preserved
  //      (not lost) so callers can still tally these as restless/awakening events.
  let foldedWakeBouts = 0
  {
    let i = 0
    while (i < n) {
      if (stages[i] !== 'awake') { i++; continue }
      let j = i
      while (j < n && stages[j] === 'awake') j++
      const interior = i > 0 && j < n
      const allMeasured = epochs.slice(i, j).every(e => e.movement != null)
      if (interior && j - i < MIN_BOUT && allMeasured) {
        const fill = stages[i - 1]
        for (let k = i; k < j; k++) stages[k] = fill
        foldedWakeBouts++
      }
      i = j
    }
  }

  return finalize(smooth(stages), settleHr, foldedWakeBouts)
}

/** Package smoothed stages into a result, deriving onsetEpoch from the FINAL stages (so it matches
 *  the rendered ribbon even after smoothing folds a short leading bout). */
function finalize(stages: SleepStage[], settleHr: number | null, foldedWakeBouts: number): SleepStagingResult {
  const firstAsleep = stages.findIndex(s => s !== 'awake')
  return { stages, onsetEpoch: firstAsleep < 0 ? stages.length : firstAsleep, settleHr, foldedWakeBouts }
}

export interface OnsetSample {
  /** Seconds since the sleep window start. */
  tSec: number
  hr: number
}

/** Refine sleep-onset latency below the 5-min epoch grid. The grid places onset at the START of
 *  the onset epoch (a 5-min step); the true moment of falling asleep is somewhere inside it. Scan
 *  the raw timestamped HR samples within the onset epoch for the first one at/below the settle
 *  threshold and return its offset in seconds. The result stays inside the onset epoch, so it is
 *  always consistent with the hypnogram ribbon; falls back to the epoch-start (grid) value when
 *  the threshold or samples are unavailable. */
export function refineOnsetLatencySec(
  result: SleepStagingResult,
  samples: OnsetSample[],
  epochMin = EPOCH_MIN,
): number {
  const epochSec = epochMin * 60
  // Never settled → the whole window is latency (matches summarizeSleepStages).
  if (result.onsetEpoch >= result.stages.length) return result.stages.length * epochSec
  const epochStartSec = result.onsetEpoch * epochSec
  if (result.settleHr == null) return epochStartSec
  const epochEndSec = epochStartSec + epochSec
  let firstSettled = Infinity
  for (const s of samples) {
    if (s.tSec < epochStartSec || s.tSec >= epochEndSec) continue
    if (s.hr <= result.settleHr && s.tSec < firstSettled) firstSettled = s.tSec
  }
  return Math.round(Number.isFinite(firstSettled) ? firstSettled : epochStartSec)
}

// Viterbi decode of the REM/light boundary over each maximal contiguous run of candidate epochs
// (those with a non-null REM advantage — still, non-deep, non-wake). Two states: light (emission 0)
// and REM (emission = that epoch's REM advantage). Every light↔REM switch costs REM_SWITCH, so the
// optimal path favours contiguous bouts: a brief dip flanked by REM stays REM, and an isolated
// weak epoch never becomes a REM island. Deep/wake epochs (null advantage) break runs and are left
// untouched — the priority stage never enters this decode. Mutates `stages` in place.
function decodeRemLight(stages: SleepStage[], remAdv: (number | null)[]): void {
  const n = stages.length
  let i = 0
  while (i < n) {
    if (remAdv[i] == null) { i++; continue }
    let j = i
    while (j < n && remAdv[j] != null) j++
    decodeRemLightRun(stages, remAdv as number[], i, j)
    i = j
  }
}

// Standard 2-state Viterbi over the half-open run [lo, hi). State 0 = light, 1 = REM.
function decodeRemLightRun(stages: SleepStage[], remAdv: number[], lo: number, hi: number): void {
  const len = hi - lo
  // Best cumulative score ending in light / REM at the current epoch.
  let sL = 0
  let sR = remAdv[lo]
  const backL: number[] = new Array(len).fill(0)
  const backR: number[] = new Array(len).fill(0)
  for (let k = 1; k < len; k++) {
    const emR = remAdv[lo + k]
    // Enter light (emission 0): stay from light, or switch from REM.
    const toL_stay = sL
    const toL_switch = sR - REM_SWITCH
    let nL: number
    if (toL_stay >= toL_switch) { nL = toL_stay; backL[k] = 0 } else { nL = toL_switch; backL[k] = 1 }
    // Enter REM (emission emR): stay from REM, or switch from light.
    const toR_stay = sR + emR
    const toR_switch = sL - REM_SWITCH + emR
    let nR: number
    if (toR_stay >= toR_switch) { nR = toR_stay; backR[k] = 1 } else { nR = toR_switch; backR[k] = 0 }
    sL = nL; sR = nR
  }
  let state = sR > sL ? 1 : 0
  for (let k = len - 1; k >= 0; k--) {
    stages[lo + k] = state === 1 ? 'rem' : 'light'
    if (k > 0) state = state === 1 ? backR[k] : backL[k]
  }
}

// Fold sub-MIN_BOUT same-stage runs into the preceding stage so a single noisy epoch doesn't
// chop the hypnogram into confetti. WAKE runs are left intact regardless of length — a 5-min
// awakening is real and physiologically meaningful, and absorbing it would hide fragmentation.
function smooth(stages: SleepStage[]): SleepStage[] {
  if (stages.length <= 1) return stages
  const out = [...stages]
  let runStart = 0
  for (let i = 1; i <= out.length; i++) {
    if (i < out.length && out[i] === out[runStart]) continue
    const len = i - runStart
    if (len < MIN_BOUT && out[runStart] !== 'awake') {
      const fill = runStart > 0 ? out[runStart - 1] : (i < out.length ? out[i] : out[runStart])
      for (let j = runStart; j < i; j++) out[j] = fill
    }
    runStart = i
  }
  return out
}

export interface SleepStageSummary {
  deepMin: number
  lightMin: number
  remMin: number
  awakeMin: number
  timeAsleepMin: number
  timeInBedMin: number
  efficiencyPct: number | null
  onsetLatencyMin: number
  awakenings: number
}

/** @param extraAwakenings brief mid-sleep wake bouts already folded back into sleep (step 4.5) —
 *  added to the count so restlessness frequency isn't lost just because those epochs no longer
 *  subtract from time asleep. */
export function summarizeSleepStages(stages: SleepStage[], epochMin = EPOCH_MIN, extraAwakenings = 0): SleepStageSummary {
  const count = (s: SleepStage) => stages.filter(x => x === s).length
  const deepMin = count('deep') * epochMin
  const lightMin = count('light') * epochMin
  const remMin = count('rem') * epochMin
  const awakeMin = count('awake') * epochMin
  const timeAsleepMin = deepMin + lightMin + remMin
  const timeInBedMin = stages.length * epochMin

  const firstAsleep = stages.findIndex(s => s !== 'awake')
  const onsetLatencyMin = firstAsleep < 0 ? timeInBedMin : firstAsleep * epochMin

  // Awakenings = distinct wake runs after sleep onset, plus any brief blips already folded away.
  let awakenings = extraAwakenings
  for (let i = Math.max(firstAsleep, 0) + 1; i < stages.length; i++) {
    if (stages[i] === 'awake' && stages[i - 1] !== 'awake') awakenings++
  }

  return {
    deepMin, lightMin, remMin, awakeMin, timeAsleepMin, timeInBedMin,
    efficiencyPct: timeInBedMin > 0 ? Math.round((timeAsleepMin / timeInBedMin) * 100) : null,
    onsetLatencyMin,
    awakenings,
  }
}
