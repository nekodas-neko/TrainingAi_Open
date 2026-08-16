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
  createdAt: Date
}
