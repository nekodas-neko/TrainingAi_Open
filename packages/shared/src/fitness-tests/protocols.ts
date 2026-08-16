// Data-driven fitness-test protocols. The guided-test flow is parameterised by
// these rows — add a protocol here, never a new hardcoded test screen.

export type FitnessTestId = '6mwt' | 'cooper12' | 'resting_hrr'

/** A guided step in a phased protocol (resting_hrr). Each phase runs for a fixed
 *  duration; the active screen prompts the user through them in order. The 1-min HR
 *  recovery is measured from the instant the `effort` phase ends (see hrrRecoveryStartMs). */
export interface HrrPhase {
  key: 'rest' | 'effort' | 'recovery'
  label: string
  instruction: string
  durationSec: number
}

export interface FitnessTestProtocol {
  id: FitnessTestId
  name: string
  shortName: string
  /** One-line instruction shown on the picker + pre-test screen. */
  description: string
  /** Fixed active duration (s); null = self-paced (resting_hrr ends on user tap). */
  durationSec: number | null
  captureDistance: boolean
  captureHrr: boolean
  /** Karvonen reserve-fraction effort hint for the live zone banner, or null. */
  effortFrac: number | null
  /** Which lib/health/fitness-tests.ts equation the result screen applies. */
  vo2Equation: '6mwt' | 'cooper' | null
  /** Guided rest→effort→recovery steps for phased tests (resting_hrr); undefined otherwise. */
  phases?: HrrPhase[]
}

export const FITNESS_TEST_PROTOCOLS: FitnessTestProtocol[] = [
  {
    id: '6mwt',
    name: '6-Minute Walk Test',
    shortName: '6MWT',
    description: 'Walk as far as you can on a flat course for 6 minutes.',
    durationSec: 360,
    captureDistance: true,
    captureHrr: false,
    effortFrac: 0.4, // brisk-walk aerobic zone
    vo2Equation: '6mwt',
  },
  {
    id: 'cooper12',
    name: 'Cooper 12-Minute Run',
    shortName: 'Cooper',
    description: 'Cover as much distance as possible running for 12 minutes.',
    durationSec: 720,
    captureDistance: true,
    captureHrr: false,
    effortFrac: 0.85, // near-max sustained effort
    vo2Equation: 'cooper',
  },
  {
    id: 'resting_hrr',
    name: 'Resting HR + Recovery',
    shortName: 'HRR',
    description: 'Rest 1 min, do 1 min of hard effort, then rest — measures resting HR and 1-min recovery.',
    durationSec: null,
    captureDistance: false,
    captureHrr: true,
    effortFrac: null,
    vo2Equation: null,
    phases: [
      { key: 'rest', label: 'Rest', instruction: 'Sit still and relax — reading your resting heart rate.', durationSec: 60 },
      { key: 'effort', label: 'Go hard', instruction: 'Push hard now — get your heart rate as high as you can.', durationSec: 60 },
      { key: 'recovery', label: 'Recover', instruction: 'Stop and rest completely — stay still, measuring your 1-min recovery.', durationSec: 60 },
    ],
  },
]

export function getProtocol(id: string): FitnessTestProtocol | undefined {
  return FITNESS_TEST_PROTOCOLS.find((p) => p.id === id)
}

/** Total active duration of a phased protocol, in seconds. */
export function phasesTotalSec(phases: HrrPhase[]): number {
  return phases.reduce((sum, p) => sum + p.durationSec, 0)
}

/**
 * The epoch-ms instant the recovery window opens — i.e. when the last non-recovery
 * phase ends. HR recovery (bpm drop) is measured from here; capture continues through
 * the recovery phase so the +60 s reading exists. Deterministic from the fixed phase
 * durations, so it needs no live marker.
 */
export function hrrRecoveryStartMs(phases: HrrPhase[], startedAtMs: number): number {
  const preRecoverySec = phases
    .filter((p) => p.key !== 'recovery')
    .reduce((sum, p) => sum + p.durationSec, 0)
  return startedAtMs + preRecoverySec * 1000
}
