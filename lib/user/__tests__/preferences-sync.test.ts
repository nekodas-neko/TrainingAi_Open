import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { PREFERENCE_STORAGE } from '@trainingai/shared/user/preferences'
import { hydrateUserPreferences, savePreference, savePreferences } from '../preferences-sync'

/**
 * Seeding and saving preferences (Q-392).
 *
 * The encoding is the part that bites — `ta_ss_widgets` is JSON, `ta_weight_lookback` a bare
 * number, and the reminder toggles `String(boolean)` compared at their read sites against the
 * literal `'false'`. A value seeded in the wrong shape reads as a default, silently.
 */

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
  vi.stubGlobal('window', {})
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true } as Response)))
})
afterEach(() => vi.unstubAllGlobals())

describe('hydrateUserPreferences', () => {
  it('writes each encoding in the shape its read site expects', () => {
    hydrateUserPreferences({
      homeWidgets: ['weightKg', 'steps'],
      weightLookback: 30,
      scoreRingStyle: 'arc',
      mealReminders: false,
    })
    expect(store.get('ta_ss_widgets')).toBe('["weightKg","steps"]')
    expect(store.get('ta_weight_lookback')).toBe('30')
    expect(store.get('ta_score_ring_style')).toBe('arc')
    // `String(boolean)`, because the read sites compare against the literal 'false'.
    expect(store.get('ta_pref_meal_reminders')).toBe('false')
  })

  it('an absent key is LEFT ALONE — a write in flight has not reached the bag yet', () => {
    // The regression CI caught: pick a meal-label style, the PATCH is still in flight, the page
    // reloads, and hydration wiped the choice. Offline it would never come back at all.
    store.set('ta_meal_label_style', 'deli')
    hydrateUserPreferences({ homeWidgets: [] })
    expect(store.get('ta_meal_label_style')).toBe('deli')
  })

  it('a mutually-exclusive partner IS cleared, so a stale hue cannot beat a preset set elsewhere', () => {
    store.set('ta_brand_hue', '210')
    hydrateUserPreferences({ brandTheme: 'purple' })
    expect(store.get('ta_brand_theme')).toBe('purple')
    expect(store.has('ta_brand_hue')).toBe(false)
  })

  it('does nothing at all when the server has no bag', () => {
    store.set('ta_score_ring_style', 'chosen-here')
    hydrateUserPreferences(null)
    // Not the same as an empty bag: null means the fetch gave us nothing, so the device keeps what
    // it has rather than being wiped by a failed request.
    expect(store.get('ta_score_ring_style')).toBe('chosen-here')
  })

  it('leaves the wallpaper envelope alone — nothing writes it, so the bag never carries it', () => {
    // `backgroundSettings` is a Zustand `persist` envelope no write site sends to the server, so it
    // is permanently absent. It needed an explicit exclusion under the old absent-clears rule; under
    // this one it is simply an absent key, and this pins that it stays that way.
    store.set('ta_background_settings', '{"state":{"wallpaper":"dunes"},"version":0}')
    hydrateUserPreferences({ scoreRingStyle: 'arc' })
    expect(store.get('ta_background_settings')).toBe('{"state":{"wallpaper":"dunes"},"version":0}')
  })

  it('covers every key in the map, so a new preference cannot be seeded under no name', () => {
    const full = Object.fromEntries(
      Object.entries(PREFERENCE_STORAGE).map(([name, { encoding }]) => [
        name,
        encoding === 'json' ? {} : encoding === 'number' ? 1 : encoding === 'boolean' ? true : 'x',
      ]),
    )
    hydrateUserPreferences(full as never)
    for (const [name, { key }] of Object.entries(PREFERENCE_STORAGE)) {
      // `brandHue` loses to `brandTheme`: a full bag has both, and they are exclusive.
      if (name === 'brandHue') continue
      expect(store.has(key), `${name} should be seeded`).toBe(true)
    }
  })
})

describe('savePreference', () => {
  it('writes the device copy and PATCHes the server', () => {
    savePreference('weightLookback', 7)
    expect(store.get('ta_weight_lookback')).toBe('7')
    expect(fetch).toHaveBeenCalledWith('/api/user/preferences', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ weightLookback: 7 }),
    }))
  })

  it('null clears the device key and sends null — the route reads that as "clear"', () => {
    store.set('ta_brand_theme', 'purple')
    savePreference('brandTheme', null)
    expect(store.has('ta_brand_theme')).toBe(false)
    expect(fetch).toHaveBeenCalledWith('/api/user/preferences', expect.objectContaining({
      body: JSON.stringify({ brandTheme: null }),
    }))
  })

  it('a failed PATCH does not throw — the tap already applied locally', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect(() => savePreference('scoreRingStyle', 'arc')).not.toThrow()
    expect(store.get('ta_score_ring_style')).toBe('arc')
    await Promise.resolve()
  })
})

describe('savePreferences', () => {
  it('a mutually-exclusive pair is ONE patch, so the two cannot land out of order', () => {
    store.set('ta_brand_hue', '210')
    savePreferences({ brandTheme: 'purple', brandHue: null })
    expect(store.get('ta_brand_theme')).toBe('purple')
    expect(store.has('ta_brand_hue')).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/user/preferences', expect.objectContaining({
      body: JSON.stringify({ brandTheme: 'purple', brandHue: null }),
    }))
  })
})
