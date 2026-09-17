export type EnergyLevel = 'drained' | 'low' | 'ok' | 'good' | 'pumped'
export type SleepQuality = 'terrible' | 'poor' | 'ok' | 'good' | 'great'
export type BodyState =
  | 'feeling_good'
  | 'stiff'
  | 'sore_muscles'
  | 'sick'
  | 'tired_legs'
  | 'joint_pain'
  | 'tight_back'
  | 'low_motivation'

export interface MoodLog {
  id: string
  userId: string
  logDate: string        // YYYY-MM-DD
  energyLevel: EnergyLevel
  sleepQuality: SleepQuality
  bodyState: BodyState[]
  soreMuscles: string[]  // e.g. ['chest', 'triceps']
  /**
   * BF-173. The subset of `soreMuscles` the model itself pre-ticked, so the session scorer can tell
   * an accepted suggestion from something the lifter volunteered and stop counting the first kind
   * twice.
   *
   * `null` is "unknown", not "none" — a log written before provenance existed cannot say, and is
   * scored the pre-BF-173 way. `[]` is the answer "none of these were suggestions".
   */
  suggestedSoreMuscles?: string[] | null
  createdAt: Date
}
