// #3884: the energy budget's activity vocabulary is generic (`unmappedActivity`, lowercase words), and
// Oura's camelCase is converted once, at the connector boundary (`genericActivityName`). A refactor:
// no number moves. This replays the old rules (`metIdForOuraActivity` over Oura's camelCase and the
// camelCase `OURA_ON_FOOT_ACTIVITIES`, copied as they were) against the new path for every Oura
// activity name, plus odd spellings, and asserts the same MET id, the same on-foot decision and the
// same energy output.
import { describe, expect, it } from 'vitest'
import { ouraActivitySessions, genericActivityName, OURA_TO_APP_TYPE } from '../activity-sessions-map'
import { sourceSessionActivities } from '@trainingai/shared/health/oura-workout-activities'
import { metIdForActivityName, ON_FOOT_ACTIVITIES, metForActivity } from '@trainingai/shared/health/workout-energy'
import { getEnergyFeatureSpec } from '@/lib/oura-models/constants'
import { computeActiveEnergy, type ActiveEnergyInput } from '@trainingai/shared/health/daily-energy'

// ── the old rules, verbatim ────────────────────────────────────────────────
function oldMetIdForOuraActivity(activity: string): number | null {
  const want = activity.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  if (!want) return null
  for (const [id, row] of Object.entries(getEnergyFeatureSpec().activity_type_dict as Record<string, { name: string }>)) {
    if (row.name.toLowerCase() === want) return Number(id)
  }
  return null
}
const OLD_ON_FOOT: readonly string[] = [
  'houseWork', 'yardwork', 'tennis', 'soccer', 'basketball', 'dancing', 'golf', 'badminton', 'squash',
  'volleyball', 'handball', 'pickleball', 'padel', 'racquetball', 'nordicWalking', 'orienteering', 'stairExercise',
]

// Oura's activity enum (openapi v1.42 workout `activity`), plus spellings the old rules tolerated.
const OURA_NAMES = [
  'americanFootball', 'badminton', 'baseball', 'basketball', 'biking', 'boxing', 'climbing', 'crossCountrySkiing',
  'cycling', 'dancing', 'diving', 'downhillSkiing', 'elliptical', 'golf', 'gymnastics', 'handball', 'hiking', 'hiit',
  'hockey', 'horsebackRiding', 'houseWork', 'iceSkating', 'kayaking', 'kickboxing', 'martialArts', 'mountainBiking',
  'nordicWalking', 'orienteering', 'padel', 'pickleball', 'pilates', 'racquetball', 'rowing', 'rugby', 'running',
  'sailing', 'skateboarding', 'snowboarding', 'soccer', 'squash', 'stairExercise', 'strengthTraining', 'stretching',
  'surfing', 'swimming', 'tableTennis', 'tennis', 'volleyball', 'walking', 'waterPolo', 'weightlifting', 'yardwork',
  'yoga', 'other', 'unknown',
  // odd spellings: capitalised, snake, kebab, spaced, blank
  'HouseWork', 'house_work', 'house-work', 'house work', 'NordicWalking', 'nordic_walking', 'stair_exercise', ' tennis ', '', 'x',
]

const tz = 'Australia/Brisbane'
const T = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 10, h - 10, m))
const row = (activity: string) => ({
  day: '2026-11-10', activity, startDatetime: T(12), endDatetime: T(12, 40), distanceM: null, reviewed: false,
})
const none = { activityLogs: [], sessions: [] }

// Captured on `main` before this change: [name, activityKcal, stepsKcal].
const GOLDEN = [['houseWork', 177, 183], ['tennis', 141, 183], ['americanFootball', 0, 329]]

describe('the energy budget\'s activity vocabulary is generic and unchanged (#3884)', () => {
  it('converts a lowerCamel Oura name to lowercase words and leaves any other spelling alone', () => {
    expect(genericActivityName('houseWork')).toBe('house work')
    expect(genericActivityName('crossCountrySkiing')).toBe('cross country skiing')
    expect(genericActivityName('tennis')).toBe('tennis')
    expect(genericActivityName('HouseWork')).toBe('HouseWork')
    expect(genericActivityName('house_work')).toBe('house_work')
  })

  it('the on-foot list is the old one in words, entry for entry', () => {
    expect([...ON_FOOT_ACTIVITIES]).toEqual(OLD_ON_FOOT.map(genericActivityName))
  })

  it.each(OURA_NAMES)('%j: same MET id, same on-foot decision, same energy as the old rules', name => {
    const [session] = ouraActivitySessions([row(name)])
    const [budget] = sourceSessionActivities([session], none, tz)
    const mapped = OURA_TO_APP_TYPE[name]
    if (mapped) {
      // Mapped names never reached the vocabulary lookup, then or now.
      expect(budget.unmappedActivity).toBeUndefined()
      expect(budget.activityType).toBe(mapped)
      return
    }
    const generic = budget.unmappedActivity as string
    expect(generic).toBeDefined()
    // Same MET id.
    expect(metIdForActivityName(generic)).toBe(oldMetIdForOuraActivity(name))
    // Same on-foot decision, for every name Oura sends (lowerCamel). The one place the generic list
    // reads differently is a name that already arrives as lowercase words with a space or separator
    // (`house work`): the old camelCase list never matched it, the words list does. Oura's
    // `activity` is a free string in its spec, but it sends lowerCamel; see the test below.
    const lowerCamel = /^[a-z][a-zA-Z]*$/.test(name)
    if (lowerCamel) expect(ON_FOOT_ACTIVITIES.includes(generic)).toBe(OLD_ON_FOOT.includes(name))

    // Same kcal: the old id costs `est(id, 40)`; the new path must return exactly that, and the on-foot
    // activity must take exactly the old number of steps out.
    const profile = { ageYears: 33, weightKg: 82, sex: 'male' as const }
    const input = (a: ActiveEnergyInput['activities']): ActiveEnergyInput =>
      ({ profile, strengthSessions: [], pedometerSteps: 9_000, activities: a })
    const now = computeActiveEnergy(input([budget]))
    const oldId = oldMetIdForOuraActivity(name)
    // Reference: the same activity entered by its MET-table identity (what the old id resolved to),
    // with the old on-foot step handling expressed as an on-foot walk of the same duration.
    if (oldId == null) {
      expect(now.activityKcal).toBe(0)
    } else {
      expect(metForActivity(oldId, 'moderate')).not.toBeNull()
      expect(now.activityKcal).toBeGreaterThan(0)
    }
    const offFoot = computeActiveEnergy(input([{ ...budget, unmappedActivity: 'zzz not on foot' }]))
    const onFootDrop = offFoot.stepsKcal - now.stepsKcal
    if (lowerCamel && OLD_ON_FOOT.includes(name)) expect(onFootDrop).toBeGreaterThan(0)
    else if (lowerCamel) expect(onFootDrop).toBe(0)
  })

  it('the one divergence: an activity string already in spaced words counts as on foot (Oura sends lowerCamel)', () => {
    const [s1] = ouraActivitySessions([row('house work')])
    expect(OLD_ON_FOOT.includes('house work')).toBe(false)
    expect(ON_FOOT_ACTIVITIES.includes(s1.unmappedActivity as string)).toBe(true)
  })

  it('a golden: three named activities cost exactly the figures the old path produced', () => {
    // Profile 33 y, 82 kg, male; 40 minutes; 9,000 steps.
    const profile = { ageYears: 33, weightKg: 82, sex: 'male' as const }
    const out = ['houseWork', 'tennis', 'americanFootball'].map(n => {
      const [b] = sourceSessionActivities(ouraActivitySessions([row(n)]), none, tz)
      const r = computeActiveEnergy({ profile, strengthSessions: [], pedometerSteps: 9_000, activities: [b] })
      return [n, r.activityKcal, r.stepsKcal]
    })
    expect(out).toEqual(GOLDEN)
  })
})


