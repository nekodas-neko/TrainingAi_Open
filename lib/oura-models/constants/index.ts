/**
 * Vendored Oura on-device model constants — the single source of truth for every
 * rule-based port (steps decoder, OTS training load, daytime stress, baselines, etc.).
 *
 * Provenance: extracted from the decrypted `.pt` binaries (SHA-256 pinned in each file's
 * `source.sha256`, cross-checked against `MANIFEST.json`). See the `oura-models` skill
 * (the private model reference archive) for what each model does and
 * `docs/superpowers/plans/2026-07-15-oura-model-constants-ingestion.md` for the vendoring
 * policy. Only the small **rule-based** models are vendored here; large neural-net weight
 * tensors are deferred to their feature sub-plans (see the plan, Tier 2).
 *
 * NOTE: the extractor emitted Python `NaN`/`Infinity` sentinels, which are invalid JSON.
 * The vendored copies replace those *value* tokens with `null` (semantically: "no value" —
 * exactly how our ports treat them). Message strings that contain the word "NaN" are
 * untouched. `source.sha256` refers to the original `.pt`, so this transform does not affect
 * provenance. Do NOT regenerate these from a re-onboarded ring (protocol-freeze rule).
 *
 * One-Constant-One-Source: ports import from here; never hardcode a number that lives in a
 * vendored constant.
 */
import fs from 'node:fs'
import type { StepsDecoderConstants } from './steps-decoder-types'
import path from 'node:path'

/**
 * Where the constant files live at runtime.
 *
 * These were `import x from './foo.constants.json'` until 2026-08-13. A static import is resolved by
 * webpack at build time and baked into the bundle, which meant the whole 11.6 MB tree had to be
 * present in the repository for the app to compile — the single reason the public cut could not
 * remove it (Q-49). `publish-dry-run --all` reported ~170 failures from exactly one cause: this
 * module failing to resolve, which takes `adapter.ts` and every DB test with it.
 *
 * Reading at call time instead makes the directory a *runtime* dependency, which can be satisfied
 * from outside git. Deliberately synchronous: `stress-resilience.ts` and `steps-motion-decoder.ts`
 * both evaluate their constants at module scope, so async getters would turn two plain constants
 * into lifecycle problems across every port that reads one.
 *
 * SERVER-ONLY, and structurally so — `node:fs` cannot resolve in a browser bundle. Every consumer is
 * a route or the adapter (verified 2026-08-13); if a client component ever needs one of these
 * numbers, it belongs behind an API route, not behind a bundler shim.
 */
// A function rather than a module-scope const, and the difference is load-bearing once the files
// leave the tree: `instrumentation-node.ts` sets OURA_CONSTANTS_DIR at boot, after downloading them,
// and a const captures whatever the variable held at *import* time. That is the right answer today
// only because nothing imports this module during instrumentation — a fragile thing to depend on,
// and it would fail silently by reading the tree path that no longer exists.
function constantsDir(): string {
  return process.env.OURA_CONSTANTS_DIR ?? path.join(process.cwd(), 'lib', 'oura-models', 'constants')
}

/** Parsed files, memoised for the process. Each is read at most once however many getters want it. */
const cache = new Map<string, unknown>()

function readJson<T>(file: string): T {
  const hit = cache.get(file)
  if (hit !== undefined) return hit as T
  // Deliberately not caught. A missing constant is a wrong number, not a missing feature — the
  // infallible-loader contract that suits the ONNX models is the wrong shape here, because there is
  // no degraded answer to fall back to. The boot check is what turns this into a deploy-time
  // failure rather than a first-request one.
  const parsed = JSON.parse(fs.readFileSync(path.join(constantsDir(), file), 'utf8')) as T
  cache.set(file, parsed)
  return parsed
}

/** Test-only: drop the memoised files so a changed directory is picked up. */
export function __clearConstantsCache() {
  cache.clear()
}

export interface ModelSource {
  file: string
  sha256: string
  size_bytes: number
  version: string | null
}

export interface ModelConstants {
  source: ModelSource
  params_and_buffers: Record<string, unknown>
  attributes: Record<string, unknown>
  errors: unknown[]
}

interface ManifestEntry {
  sha256: string
  params_buffers: number
  attributes: number
  errors: string[]
}

/** Every rule-based model vendored here. Keys are the canonical `<model>_<version>` ids. */
/** Every rule-based model vendored here, mapped to the file it is read from. Keys are the canonical
 *  `<model>_<version>` ids. A map of filenames rather than of parsed objects, so listing the models
 *  costs nothing and only the ones actually asked for are read. */
export const MODEL_FILES = {
  astd_event_detection_0_1_0: 'astd_event_detection_0_1_0.constants.json',
  atlas_trendline_1_0_0: 'atlas_trendline_1_0_0.constants.json',
  cumulative_stress_1_2_2: 'cumulative_stress_1_2_2.constants.json',
  cva_calibrator_1_3_0: 'cva_calibrator_1_3_0.constants.json',
  daily_medians_1_1_0: 'daily_medians_1_1_0.constants.json',
  daily_short_term_baselines_1_1_0: 'daily_short_term_baselines_1_1_0.constants.json',
  dhrv_imputation_1_1_0: 'dhrv_imputation_1_1_0.constants.json',
  meal_timing_0_1_0: 'meal_timing_0_1_0.constants.json',
  sleepstaging_2_6_0: 'sleepstaging_2_6_0.constants.json',
  steps_motion_decoder_2_0_0: 'steps_motion_decoder_2_0_0.constants.json',
  stress_daytime_sensing_1_1_0: 'stress_daytime_sensing_1_1_0.constants.json',
  stress_resilience_2_2_1: 'stress_resilience_2_2_1.constants.json',
  training_stress_score_0_2_1: 'training_stress_score_0_2_1.constants.json',
} as const satisfies Record<string, string>

export type ModelName = keyof typeof MODEL_FILES

export const MODEL_NAMES = Object.keys(MODEL_FILES) as ModelName[]

const manifest = () => readJson<Record<string, ManifestEntry>>('MANIFEST.json')

/** Raw vendored constants for a model (envelope: source / attributes / errors). */
export function getModelConstants(name: ModelName): ModelConstants {
  return readJson<ModelConstants>(MODEL_FILES[name])
}

/** A model's attributes bag (the tuning constants / lookup tables). */
export function getAttributes(name: ModelName): Record<string, unknown> {
  return getModelConstants(name).attributes
}

/** Provenance: the model/asset version (falls back to the id suffix if the `.pt` had none). */
export function modelVersion(name: ModelName): string {
  return getModelConstants(name).source.version ?? name
}

/** Provenance: the SHA-256 of the source `.pt` this constant set was extracted from. */
export function modelSha(name: ModelName): string {
  return getModelConstants(name).source.sha256
}

/**
 * Integrity: every vendored file's `source.sha256` must match the MANIFEST entry for that
 * model (both are the source `.pt` hash). A test asserts this so a corrupted/mismatched
 * vendor is caught in CI. Returns the list of mismatches (empty = OK).
 */
export function verifyConstantsIntegrity(): string[] {
  const problems: string[] = []
  for (const name of MODEL_NAMES) {
    const entry = manifest()[name]
    if (!entry) {
      problems.push(`${name}: missing from MANIFEST`)
      continue
    }
    const sha = modelSha(name)
    if (sha !== entry.sha256) {
      problems.push(`${name}: source.sha256 ${sha} != MANIFEST ${entry.sha256}`)
    }
  }
  return problems
}

// ── Typed accessors for the near-term ports ────────────────────────────────────────────

// Read from disk like every other constant (Q-221). This used to be re-exported from `./client`,
// which held the JSON as a static import so the browser bundle could reach it — and that is exactly
// what shipped the vendor's quantisation table to unauthenticated `_next/static` chunks. The client
// now gets it from `GET /api/oura-ble/decoder-constants` and injects it; nothing static remains, so
// this whole module is server-read again.
export function getStepsDecoderConstants(): StepsDecoderConstants {
  return getAttributes('steps_motion_decoder_2_0_0') as unknown as StepsDecoderConstants
}
export type { DecoderColumnSetting, StepsDecoderConstants } from './steps-decoder-types'

export interface AstdConstants {
  binWidthMinutes: number       // 15
  minNBins: number              // 4 — validator floor
  relaxedThreshold: number      // 0.4
  extremeStressThreshold: number // 0.5
  nStressed: number             // 4 — stressed window size (bins)
  nRestored: number             // 4 — restored window size (bins)
  binWidthMs: number            // 900000
  minWindowDeltaMs: number      // 3300000
  maxWindowDeltaMs: number      // 3900000
  allowedMergeGapMs: number     // 1800000
  ruleStressed: number          // 1
  ruleRestored: number          // 1
  borderlineCountRule: number   // 0
  borderlineMinFullyCount: number // 1
}

/** `astd_event_detection_0_1_0` — thresholds + window/merge rules for daytime stress-event
 *  detection. Consumed by lib/oura-models/astd-event-detection.ts. */
export function getAstdConstants(): AstdConstants {
  const a = getAttributes('astd_event_detection_0_1_0')
  return {
    binWidthMinutes: a['bin_width_minutes'] as number,
    minNBins: a['validator.min_n_bins'] as number,
    relaxedThreshold: a['preprocessor.relaxed_threshold'] as number,
    extremeStressThreshold: a['preprocessor.extreme_stress_threshold'] as number,
    nStressed: a['processor.N_stressed'] as number,
    nRestored: a['processor.N_restored'] as number,
    binWidthMs: a['processor.bin_width_ms'] as number,
    minWindowDeltaMs: a['processor.min_window_delta_ms'] as number,
    maxWindowDeltaMs: a['processor.max_window_delta_ms'] as number,
    allowedMergeGapMs: a['processor.allowed_merge_gap_ms'] as number,
    ruleStressed: a['processor.rule_stressed'] as number,
    ruleRestored: a['processor.rule_restored'] as number,
    borderlineCountRule: a['processor.borderline_count_rule'] as number,
    borderlineMinFullyCount: a['processor.borderline_min_fully_count'] as number,
  }
}

interface DaytimeStressTables {
  stress_saturation: SaturationTable
  recovery_saturation: SaturationTable
}

export interface SaturationTable {
  limits: number[]
  values: number[]
}

export interface DaytimeStressConstants {
  /** `equalize_scaled_levels` remap parameters. */
  targetLevelLimit: number
  scaledLevelLimit: number
  /** MET above which a sample counts as activity (sleep/active exclusion). */
  ringMetLimit: number
  /** `stress_saturation` / `recovery_saturation` step tables, keyed on night-HRV baseline. */
  stressSaturation: SaturationTable
  recoverySaturation: SaturationTable
}

/** `stress_daytime_sensing_1_1_0` — the daytime HRV-deviation stress mapping constants. */
export function getDaytimeStressConstants(): DaytimeStressConstants {
  const a = getAttributes('stress_daytime_sensing_1_1_0')
  return {
    targetLevelLimit: a['target_level_limit'] as number,
    scaledLevelLimit: a['scaled_level_limit'] as number,
    ringMetLimit: a['validator.ring_met_limit'] as number,
    stressSaturation: readJson<DaytimeStressTables>('stress_daytime_sensing_1_1_0.tables.json').stress_saturation,
    recoverySaturation: readJson<DaytimeStressTables>('stress_daytime_sensing_1_1_0.tables.json').recovery_saturation,
  }
}

export interface DhrvScaling {
  /** Per-feature scaling stats, in `DHRV_FEATURES` order. */
  means: number[]
  stds: number[]
}

/**
 * `dhrv_imputation_1_1_0` — the MLP's input normalisation.
 *
 * Tensor-valued attributes are wrapped (`{kind, shape, dtype, numel, values}`); scalar ones are
 * bare. Reading `a['means']` as a `number[]` typechecks and yields `undefined` at every index,
 * which turns every scaled feature into NaN and every inference into a silent `null`.
 */
export function getDhrvScaling(): DhrvScaling {
  const a = getAttributes('dhrv_imputation_1_1_0')
  const tensor = (key: string) => (a[key] as { values: number[] }).values
  return { means: tensor('means'), stds: tensor('stds') }
}

export interface ResilienceConstants {
  highWeight: number; moderateWeight: number; lowWeight: number; neutralWeight: number
  sleepScoreWeight: number; hrvBalanceWeight: number; recoveryIndexWeight: number; restingHeartRateWeight: number
  sleepRecoveryScalerCoef: number[]   // polyval coefs (high→low degree)
  percentMultiplier: number
  moderateToHighCoef: number; lowToModerateCoef: number
  daytimeRecoveryWeight: number; sleepRecoveryWeight: number
  todayWeight: number; lastPeriodWeight: number
  windowLength: number; windowMinLength: number
  planeFitCoef: number[]              // [a, b, c] polyval coefs
  pcaMinorAxisLength: number
  levelMultiplier: number[]           // 4 cut-points
  minDaytimeStressHours: number
  resolutionMinutes: number
}

/** `stress_resilience_2_2_1` — weights, window params, PCA plane-fit + banding coefficients.
 *  Consumed by lib/health/stress-resilience.ts (the port). One Place for the constants. */
export function getResilienceConstants(): ResilienceConstants {
  const a = getAttributes('stress_resilience_2_2_1')
  const s = (k: string): number => (a[k] as { values: number[] }).values[0]
  const vec = (k: string): number[] => (a[k] as { values: number[] }).values
  return {
    highWeight: s('high_weight'), moderateWeight: s('moderate_weight'),
    lowWeight: s('low_weight'), neutralWeight: s('neutral_weight'),
    sleepScoreWeight: s('sleep_score_weight'), hrvBalanceWeight: s('hrv_balance_weight'),
    recoveryIndexWeight: s('recovery_index_weight'), restingHeartRateWeight: s('resting_heart_rate_weight'),
    sleepRecoveryScalerCoef: vec('sleep_recovery_scaler_coef'),
    percentMultiplier: s('percent_multiplier'),
    moderateToHighCoef: s('moderate_to_high_coef'), lowToModerateCoef: s('low_to_moderate_coef'),
    daytimeRecoveryWeight: s('daytime_recovery_weight'), sleepRecoveryWeight: s('sleep_recovery_weight'),
    todayWeight: s('resilience_today_weight'), lastPeriodWeight: s('resilience_last_period_weight'),
    windowLength: s('resilience_window_length'), windowMinLength: s('resilience_window_min_length'),
    planeFitCoef: vec('resilience_plane_fit_coef'),
    pcaMinorAxisLength: s('pca_minor_axis_length'),
    levelMultiplier: vec('resilience_level_multipier'),
    minDaytimeStressHours: s('min_hours_of_stress_available_in_daytime'),
    resolutionMinutes: s('resolution_minutes'),
  }
}

export interface CumulativeStressConstants {
  feverLimit: number            // 38 — °C fever gate
  lutealPhaseCorrection: number // 0.2 — added to temp-dev baseline in luteal phase
  minHrvCoverage: number        // 0.2 — min fraction of non-NaN hrv_items for norm IQR
  minDaysRequired: number       // 21 — per-feature non-NaN count for can_produce_score
  faModelMean: number[]         // [9]
  faModelStd: number[]          // [9]
  faModelWeights: number[]      // [9*6] row-major (9 features → 6 factors)
  dimToDrop: number             // 0 — factor index dropped before clustering
  clusterCentroids: number[]    // [5*5] row-major (5 clusters × 5 factors)
  positiveClusters: number[]    // [1, 3] — cluster indices summed into the score
  contributorMeans: number[]    // [5]
  contributor01p: number[]      // [5]
  contributor99p: number[]      // [5]
  contributorLevels: number[]   // [5*6] row-major — piecewise-linear UI level table
}

/** `cumulative_stress_1_2_2` (ChronicStress) — factor-analysis weights, cluster centroids,
 *  contributor scaling percentiles + UI level table. Consumed by lib/oura-models/cumulative-stress.ts.
 *  Tensor buffers were extracted from the `.pt` into the constants JSON (see the port's header). */
export function getCumulativeStressConstants(): CumulativeStressConstants {
  const a = getAttributes('cumulative_stress_1_2_2')
  const vec = (k: string): number[] => (a[k] as { values: number[] }).values
  return {
    feverLimit: a['fever_limit'] as number,
    lutealPhaseCorrection: a['luteal_phase_correction'] as number,
    minHrvCoverage: a['min_hrv_coverage'] as number,
    minDaysRequired: a['min_days_required'] as number,
    faModelMean: vec('processor.fa_model_mean'),
    faModelStd: vec('processor.fa_model_std'),
    faModelWeights: vec('processor.fa_model_weights'),
    dimToDrop: a['processor.dim_to_drop'] as number,
    clusterCentroids: vec('processor.cluster_centroids'),
    positiveClusters: vec('processor.positive_clusters'),
    contributorMeans: vec('processor.contributor_means'),
    contributor01p: vec('processor.contributor_01p'),
    contributor99p: vec('processor.contributor_99p'),
    contributorLevels: (a['contributor_levels'] as { values: number[] }).values,
  }
}

export interface SleepStagingConstants {
  /** HRV power bands (millihertz when `useMillihz`). */
  hrvBands: { vlf: [number, number]; lf: [number, number]; hf: [number, number] }
  useMillihz: boolean
  /** The full HRV feature-column list the stager consumes (1-min + 5-min windows). */
  hrvFeatureColumns: string[]
}

/** `sleepstaging_2_6_0` — HRV band edges + the feature-column list for the feature stack. */
export function getSleepStagingConstants(): SleepStagingConstants {
  const a = getAttributes('sleepstaging_2_6_0')
  const band = (k: string): [number, number] => {
    const t = a[k] as { values: number[] } | undefined
    const v = t?.values ?? []
    return [v[0], v[1]]
  }
  return {
    hrvBands: {
      vlf: band('_hrv_low_model.VLF_BAND'),
      lf: band('_hrv_low_model.LF_BAND'),
      hf: band('_hrv_low_model.HF_BAND'),
    },
    useMillihz: (a['_hrv_low_model.use_millihz'] as boolean) ?? false,
    hrvFeatureColumns: (a['_hrv_high_model.in_columnNames'] as string[]) ?? [],
  }
}

/** `training_stress_score_0_2_1` (OTS) — the load-bearing scalars + weight vectors.
 *  NB: these are the *extracted* values; several differ from earlier skill prose (gamma=1,
 *  M=8, min_mets_count=720) — trust these. Window/resample contract must be pinned against a
 *  test vector before use (see the movement sub-plan). */
export function getOtsConstants(): Record<string, unknown> {
  return getAttributes('training_stress_score_0_2_1')
}

export interface OtsTypedConstants {
  metIntensityGamma: number
  metIntensityM: number
  useMetIntensityWeights: boolean
  minMetValue: number
  highOtsThreshold: number
  minMetsCount: number
  metWeights: Float64Array          // [720]
  rhrWeights: number[]              // [10]
  vo2maxWeights: number[]           // [4]
  vo2maxThresholds: number[][]      // [24][6]: [sex, ageMin, ageMax, lowFair, fairHigh, highPeak]
  femalePercentiles: number[][]     // [8][9]
  malePercentiles: number[][]       // [8][9]
  otherPercentiles: number[][]      // [6][9]
  femaleAndMaleAgeGroups: number[]  // [8]
  otherAgeGroups: number[]          // [6]
}

/** Typed, unwrapped OTS constants for the TS port (`lib/oura-models/inference/ots.ts`).
 *  Kept here so the vendored constants have one accessor (One Place). */
export function getOtsTypedConstants(): OtsTypedConstants {
  const a = getAttributes('training_stress_score_0_2_1')
  const vec = (k: string): number[] => ((a[k] as { values: number[] } | undefined)?.values ?? [])
  const scalar = (k: string): number => (a[k] as { values: number[] } | undefined)?.values?.[0] ?? NaN
  const mat = (k: string, cols: number): number[][] => {
    const flat = vec(k)
    const rows: number[][] = []
    for (let i = 0; i < flat.length; i += cols) rows.push(flat.slice(i, i + cols))
    return rows
  }
  return {
    metIntensityGamma: a['met_intensity_gamma'] as number,
    metIntensityM: a['met_intensity_M'] as number,
    useMetIntensityWeights: a['use_met_intensity_weights'] as boolean,
    minMetValue: scalar('min_met_value'),
    highOtsThreshold: scalar('high_ots_threshold'),
    minMetsCount: a['validator.min_mets_count'] as number,
    metWeights: Float64Array.from(vec('met_weights')),
    rhrWeights: vec('rhr_weights'),
    vo2maxWeights: vec('vo2max_weights'),
    vo2maxThresholds: mat('vo2max_thresholds', 6),
    femalePercentiles: mat('female_percentiles', 9),
    malePercentiles: mat('male_percentiles', 9),
    otherPercentiles: mat('other_percentiles', 9),
    femaleAndMaleAgeGroups: vec('female_and_male_age_groups'),
    otherAgeGroups: vec('other_age_groups'),
  }
}

export interface EnergyFeatureSpec {
  activity_type_dict: Record<string, unknown>
  [key: string]: unknown
}

/**
 * `energy_expenditure_1_0_0`'s feature layout and its 82-activity MET table.
 *
 * Read through here rather than imported directly, so it moves with the rest of the tree. It is the
 * one constants file with a plausible future on the client — #999 Task 2 proposes re-sourcing the
 * MET values from the public Compendium of Physical Activities, at which point it stops being
 * vendor data and can be a plain import again.
 */
export function getEnergyFeatureSpec(): EnergyFeatureSpec {
  return readJson<EnergyFeatureSpec>('energy-expenditure-features.json')
}
