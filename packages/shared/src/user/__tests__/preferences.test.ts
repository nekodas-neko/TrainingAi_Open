// The preferences schema is the only type these values ever get — there is no DB column per key
// (Q-392), so anything this schema lets through is stored verbatim and read back forever.
//
// The two properties worth pinning: `.strict()`, because a typo'd key in a free-form bag is
// invisible (it stores fine, reads as absent, and the surface quietly falls back to its default);
// and the patch schema's `null`, because clearing a preference has to be expressible.
import { describe, it, expect } from 'vitest'
import {
  UserPreferencesSchema,
  UserPreferencesPatchSchema,
  DEVICE_LOCAL_PREFERENCES,
  PREFERENCE_STORAGE,
  mergePreferences,
} from '../preferences'

describe('UserPreferencesSchema', () => {
  it('accepts an empty bag — every key is optional', () => {
    expect(UserPreferencesSchema.safeParse({}).success).toBe(true)
  })

  it('rejects an unknown key rather than storing it', () => {
    expect(UserPreferencesSchema.safeParse({ scoreRingStyl: 'arc' }).success).toBe(false)
  })

  it('rejects a value of the wrong shape', () => {
    expect(UserPreferencesSchema.safeParse({ homeWidgets: 'water' }).success).toBe(false)
    expect(UserPreferencesSchema.safeParse({ weightLookback: 0 }).success).toBe(false)
    expect(UserPreferencesSchema.safeParse({ mealReminders: 'yes' }).success).toBe(false)
  })

  it('bounds the collections, so one client cannot grow the bag without limit', () => {
    expect(UserPreferencesSchema.safeParse({ homeWidgets: Array(21).fill('x') }).success).toBe(false)
    expect(UserPreferencesSchema.safeParse({ scoreRingStyle: 'x'.repeat(41) }).success).toBe(false)
  })

  it('rejects null — only the PATCH schema accepts it, and only to clear', () => {
    expect(UserPreferencesSchema.safeParse({ scoreRingStyle: null }).success).toBe(false)
  })
})

describe('UserPreferencesPatchSchema', () => {
  it('covers every key the stored schema has', () => {
    expect(Object.keys(UserPreferencesPatchSchema.shape).sort())
      .toEqual(Object.keys(UserPreferencesSchema.shape).sort())
  })

  it('accepts null on any key, to clear it', () => {
    for (const key of Object.keys(UserPreferencesSchema.shape)) {
      expect(UserPreferencesPatchSchema.safeParse({ [key]: null }).success).toBe(true)
    }
  })

  it('still rejects an unknown key', () => {
    expect(UserPreferencesPatchSchema.safeParse({ nope: 1 }).success).toBe(false)
  })

  it('still enforces the value types', () => {
    expect(UserPreferencesPatchSchema.safeParse({ weightLookback: -1 }).success).toBe(false)
  })
})

describe('mergePreferences', () => {
  it('leaves untouched keys alone', () => {
    expect(mergePreferences({ scoreRingStyle: 'arc' }, { weightLookback: 30 }))
      .toEqual({ scoreRingStyle: 'arc', weightLookback: 30 })
  })

  it('clears on null and does not leave the key behind', () => {
    const out = mergePreferences({ scoreRingStyle: 'arc' }, { scoreRingStyle: null })
    expect('scoreRingStyle' in out).toBe(false)
  })

  it('does not mutate the stored bag it was given', () => {
    const stored = { scoreRingStyle: 'arc' }
    mergePreferences(stored, { scoreRingStyle: null, weightLookback: 30 })
    expect(stored).toEqual({ scoreRingStyle: 'arc' })
  })
})

describe('PREFERENCE_STORAGE', () => {
  it('names a device key for every preference the schema carries', () => {
    // A preference with no entry here is one the seeding helper cannot write, so it syncs to the
    // server and then never paints from cache — a first-paint flash that looks like it did not save.
    expect(Object.keys(PREFERENCE_STORAGE).sort())
      .toEqual(Object.keys(UserPreferencesSchema.shape).sort())
  })

  it('maps each preference to a distinct storage key', () => {
    const keys = Object.values(PREFERENCE_STORAGE).map(e => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('claims no key that is deliberately device-local', () => {
    const deviceLocal = new Set(Object.keys(DEVICE_LOCAL_PREFERENCES))
    for (const { key } of Object.values(PREFERENCE_STORAGE)) expect(deviceLocal.has(key)).toBe(false)
  })
})

describe('DEVICE_LOCAL_PREFERENCES', () => {
  it('gives a reason for every key it excludes', () => {
    const entries = Object.entries(DEVICE_LOCAL_PREFERENCES)
    expect(entries.length).toBeGreaterThan(0)
    for (const [, reason] of entries) expect(reason.length).toBeGreaterThan(20)
  })

  it('is keyed by storage key, not preference name — these never enter the synced bag', () => {
    // Compared against the storage keys rather than the schema's camelCase names: comparing the
    // two namespaces would pass no matter what, which is what this assertion originally did.
    const syncedStorageKeys = new Set(Object.values(PREFERENCE_STORAGE).map(e => e.key))
    for (const key of Object.keys(DEVICE_LOCAL_PREFERENCES)) {
      expect(key.startsWith('ta_') || key === 'theme').toBe(true)
      expect(syncedStorageKeys.has(key)).toBe(false)
    }
  })
})
