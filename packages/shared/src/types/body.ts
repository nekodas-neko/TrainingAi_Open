export interface BodyMetrics {
  id: string
  userId: string
  date: string           // ISO date "YYYY-MM-DD"
  weightKg?: number
  bodyFatPct?: number
  calories?: number
  proteinG?: number
  carbsG?: number
  fatG?: number
  steps?: number
  distanceKm?: number
  restingHeartRate?: number
  hrvMs?: number
  spo2Pct?: number
  waterMl?: number
  activeCalories?: number
  waistCm?: number
  chestCm?: number
  armCm?: number
  thighCm?: number
  hipCm?: number
  neckCm?: number
  // Direct-BLE scale composition (migration 155) — our own BIA formula, not Renpho's.
  skeletalMusclePct?: number
  fatFreeMassKg?: number
  subcutaneousFatPct?: number
  visceralFatIndex?: number
  bodyWaterPct?: number
  muscleMassKg?: number
  boneMassKg?: number
  proteinPct?: number
  bmrKcal?: number
  metabolicAge?: number
  createdAt: Date
}

export interface ActivityLog {
  id: string
  userId: string
  date: string           // ISO date "YYYY-MM-DD"
  activityType: string   // FK to activity_types.id
  title: string
  startTime?: string     // "HH:MM"
  endTime?: string       // "HH:MM"
  durationMin?: number
  distanceKm?: number
  caloriesBurned?: number
  avgHr?: number
  maxHr?: number
  steps?: number
  notes?: string
  routePolyline?: string
  splits?: { km: number; paceSec: number }[]
  bestEfforts?: Record<string, number>
  paceSeries?: { tSec: number; paceSec: number }[]
  avgPaceSecPerKm?: number
  elevationGainM?: number
  elevationLossM?: number
  elevationProfile?: { distKm: number; eleM: number }[]
  /** Average cadence, steps/min, across locomotor readings only (pauses excluded). */
  cadenceSpm?: number
  cadenceSeries?: { tSec: number; spm: number }[]
  /** Which sensor measured it — the two derivations are independent, so provenance is
   *  needed to interpret the value or compare it against a later reading. */
  cadenceSource?: 'ring' | 'strap'
  /** Per-segment stats for a guided interval walk (see lib/walk/segment-stats.ts). */
  segments?: {
    index: number; setNumber: number; kind: 'warmup' | 'fast' | 'slow' | 'cooldown'
    startSec: number; endSec: number
    avgHr: number | null; maxHr: number | null; hrAtStart: number | null
    avgPaceSecPerKm: number | null; distanceKm: number | null; avgCadenceSpm: number | null
  }[]
  createdAt: Date
}

export interface ActivityType {
  id: string
  label: string
  icon: string
  isDistanceBased: boolean
  sortOrder: number
}

export interface SleepSession {
  id: string
  userId: string
  date: string           // YYYY-MM-DD (wake-up date)
  sleepStart: Date       // full timestamp
  sleepEnd: Date
  durationHours?: number
  deepSleepHours?: number
  remSleepHours?: number
  lightSleepHours?: number
  awakHours?: number
  createdAt: Date
  // Oura Ring enriched fields (migrations 085/088)
  ouraId?: string | null
  efficiency?: number | null         // 0-100 %
  onsetLatencySec?: number | null    // seconds to fall asleep
  averageHrvMs?: number | null       // rMSSD during sleep (ms)
  avgHeartRate?: number | null       // bpm
  lowestHeartRate?: number | null    // bpm (proxy for resting HR)
  restlessPeriods?: number | null
  sleepScore?: number | null         // 0-100 from Oura daily_sleep
  respiratoryRate?: number | null    // breaths/min
  sleepPhase5Min?: string | null     // 5-min stage codes: 1=deep 2=light 3=REM 4=awake
  timeInBedHours?: number | null     // migration 112
}
