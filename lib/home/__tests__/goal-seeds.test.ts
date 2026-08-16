// @vitest-environment jsdom
//
// Q-241. Nine goal values lived in `localStorage` *and* the database, written by three surfaces
// (the Profile editor, the AI recommendation sheet, and Coach) and read back by a fourth. The
// device copy does not sync, so a second device, a re-install or the gap between the web surface
// and the APK left the server holding the user's real goals while the app rendered defaults — with
// nothing anywhere to reconcile the two.
//
// The direction is now one-way: the server payload is the source of truth and this writes the seed
// from it. These cases pin the two properties that make that true — that a server value overwrites
// a disagreeing device value, and that a server NULL *clears* the seed instead of leaving a stale
// number behind to be read as current.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  hydrateGoalSeeds, type GoalSeedValues,
  STEPS_GOAL_KEY, STEPS_GOAL_TYPE_KEY, SLEEP_GOAL_KEY, CALORIE_GOAL_KEY, CALORIE_TYPE_KEY,
  WATER_GOAL_KEY, WATER_GOAL_TYPE_KEY, TARGET_WEIGHT_KEY, TARGET_BF_KEY,
  loadWaterGoal, loadSleepGoal,
} from '../home-prefs'

const FULL: GoalSeedValues = {
  stepsGoal: 12000, stepsGoalType: 'weekly', sleepGoalHours: 7.5,
  calorieGoal: 2400, calorieGoalType: 'daily',
  waterGoalMl: 3000, waterGoalType: 'daily',
  targetWeightKg: 78.5, targetBfPct: 14,
}

const EMPTY: GoalSeedValues = {
  stepsGoal: null, stepsGoalType: null, sleepGoalHours: null,
  calorieGoal: null, calorieGoalType: null,
  waterGoalMl: null, waterGoalType: null,
  targetWeightKg: null, targetBfPct: null,
}

describe('hydrateGoalSeeds — the server payload owns the localStorage copy (Q-241)', () => {
  beforeEach(() => { localStorage.clear() })

  it('writes every one of the nine keys', () => {
    hydrateGoalSeeds(FULL)
    expect(localStorage.getItem(STEPS_GOAL_KEY)).toBe('12000')
    expect(localStorage.getItem(STEPS_GOAL_TYPE_KEY)).toBe('weekly')
    expect(localStorage.getItem(SLEEP_GOAL_KEY)).toBe('7.5')
    expect(localStorage.getItem(CALORIE_GOAL_KEY)).toBe('2400')
    expect(localStorage.getItem(CALORIE_TYPE_KEY)).toBe('daily')
    expect(localStorage.getItem(WATER_GOAL_KEY)).toBe('3000')
    expect(localStorage.getItem(WATER_GOAL_TYPE_KEY)).toBe('daily')
    expect(localStorage.getItem(TARGET_WEIGHT_KEY)).toBe('78.5')
    expect(localStorage.getItem(TARGET_BF_KEY)).toBe('14')
  })

  // The actual reported shape: this device edited a goal at some point, the server has since been
  // told something else (from another device, or by Coach), and the device copy must lose.
  it('overwrites a device value that disagrees with the server', () => {
    localStorage.setItem(WATER_GOAL_KEY, '1500')
    localStorage.setItem(STEPS_GOAL_KEY, '6000')
    hydrateGoalSeeds(FULL)
    expect(localStorage.getItem(WATER_GOAL_KEY)).toBe('3000')
    expect(localStorage.getItem(STEPS_GOAL_KEY)).toBe('12000')
  })

  // Without this the seed is write-only-on-non-null, and a goal the user cleared on another device
  // would keep rendering here from a value nothing can reach.
  it('a null on the server REMOVES the key rather than leaving the old number', () => {
    hydrateGoalSeeds(FULL)
    hydrateGoalSeeds(EMPTY)
    for (const key of [STEPS_GOAL_KEY, STEPS_GOAL_TYPE_KEY, SLEEP_GOAL_KEY, CALORIE_GOAL_KEY,
      CALORIE_TYPE_KEY, WATER_GOAL_KEY, WATER_GOAL_TYPE_KEY, TARGET_WEIGHT_KEY, TARGET_BF_KEY]) {
      expect(localStorage.getItem(key)).toBeNull()
    }
  })

  // Home reads the seed through these helpers rather than the raw keys, so "the seed converged"
  // only means something if what Home actually calls returns the server's number.
  it('the readers Home uses return the server values afterwards', () => {
    localStorage.setItem(WATER_GOAL_KEY, '1500')
    localStorage.setItem(SLEEP_GOAL_KEY, '6')
    hydrateGoalSeeds(FULL)
    expect(loadWaterGoal()).toBe(3000)
    expect(loadSleepGoal()).toBe(7.5)
  })

  it('and fall back to their own defaults once the server clears them', () => {
    hydrateGoalSeeds(FULL)
    hydrateGoalSeeds(EMPTY)
    expect(loadWaterGoal()).toBeNull()
    expect(loadSleepGoal()).toBe(8)
  })

  // A missing payload is not an instruction to wipe the user's goals — a failed fetch resolving to
  // null must leave the last-known values alone rather than blanking every card.
  it('leaves the seed untouched when there is no payload', () => {
    hydrateGoalSeeds(FULL)
    hydrateGoalSeeds(null)
    hydrateGoalSeeds(undefined)
    expect(localStorage.getItem(WATER_GOAL_KEY)).toBe('3000')
  })
})
