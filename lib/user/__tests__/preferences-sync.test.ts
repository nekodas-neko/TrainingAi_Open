import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { PREFERENCE_STORAGE } from '@trainingai/shared/user/preferences'
import { hydrateUserPreferences, savePreference, savePreferences, writePreferenceLocally } from '../preferences-sync'

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

describe('writePreferenceLocally', () => {
  it('writes the device copy and sends NOTHING — a mirror on mount is not news to the server', () => {
    writePreferenceLocally('goalsProgressView', 'week')
    expect(store.get('ta_goals_progress_view')).toBe('week')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('encodes the same way the PATCH path does, so the two cannot drift', () => {
    writePreferenceLocally('weightLookback', 30)
    writePreferenceLocally('mealReminders', false)
    expect(store.get('ta_weight_lookback')).toBe('30')
    expect(store.get('ta_pref_meal_reminders')).toBe('false')
  })

  it('null clears the key, matching savePreference', () => {
    store.set('ta_brand_hue', '210')
    writePreferenceLocally('brandHue', null)
    expect(store.has('ta_brand_hue')).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

/**
 * LB-29 — a change the server has not seen must survive the reload that reveals it.
 *
 * `savePreference` writes `localStorage` and PATCHes in the background. Before this, hydration on
 * the next load wrote **every** key the bag carried, so if the PATCH had not landed the response
 * still held the *previous* value and overwrote the choice just made. Offline it was not a race
 * but permanent: the PATCH never lands, so every launch re-wrote the old value.
 *
 * The owner chose "the change follows to my other devices" over the simpler "never overwrite a
 * local setting", which is why the fix re-sends rather than merely declining to seed.
 */
describe('LB-29 — an unacknowledged local change beats the server copy', () => {
  /** A fetch that never settles, which is the in-flight window the bug lived in. */
  function hangingFetch() {
    const f = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', f)
    return f
  }

  it('hydration does not overwrite a key whose PATCH is still in flight', () => {
    hangingFetch()
    savePreference('mealLabelStyle', 'deli')
    expect(store.get('ta_meal_label_style')).toBe('deli')

    // The reload: the server answers with what it had before the tap.
    hydrateUserPreferences({ mealLabelStyle: 'classic' })
    expect(store.get('ta_meal_label_style')).toBe('deli')
  })

  it('and it re-sends that value rather than leaving the server behind', () => {
    hangingFetch()
    savePreference('mealLabelStyle', 'deli')

    const resend = vi.fn(() => Promise.resolve({ ok: true } as Response))
    vi.stubGlobal('fetch', resend)
    hydrateUserPreferences({ mealLabelStyle: 'classic' })

    expect(resend).toHaveBeenCalledTimes(1)
    expect(JSON.parse((resend.mock.calls[0][1] as RequestInit).body as string))
      .toEqual({ mealLabelStyle: 'deli' })
  })

  it('once the server acknowledges, it wins again', async () => {
    savePreference('mealLabelStyle', 'deli')
    await Promise.resolve(); await Promise.resolve()

    hydrateUserPreferences({ mealLabelStyle: 'classic' })
    expect(store.get('ta_meal_label_style')).toBe('classic')
  })

  it('a rejected PATCH keeps the mark, so the device keeps winning', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false } as Response)))
    savePreference('mealLabelStyle', 'deli')
    await Promise.resolve(); await Promise.resolve()

    hydrateUserPreferences({ mealLabelStyle: 'classic' })
    expect(store.get('ta_meal_label_style')).toBe('deli')
  })

  it('survives the launch after an offline change — the mark is on disk, not in memory', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    savePreference('weightLookback', 30)

    // A fresh launch reads the same `localStorage`; nothing in module memory carries over.
    hydrateUserPreferences({ weightLookback: 7 })
    expect(store.get('ta_weight_lookback')).toBe('30')
  })

  it('re-sends each encoding in the shape the schema expects, not as a string', () => {
    hangingFetch()
    savePreferences({ weightLookback: 30, mealReminders: false, homeWidgets: ['steps'] })

    const resend = vi.fn(() => Promise.resolve({ ok: true } as Response))
    vi.stubGlobal('fetch', resend)
    hydrateUserPreferences({})

    const body = JSON.parse((resend.mock.calls[0][1] as RequestInit).body as string)
    // Decoded back to real types — a re-send of `"30"` or `"false"` would fail the route's schema.
    expect(body).toEqual({ weightLookback: 30, mealReminders: false, homeWidgets: ['steps'] })
  })

  it('does not clear a mutually-exclusive partner that is itself in flight', () => {
    hangingFetch()
    savePreference('brandHue', 210)

    hydrateUserPreferences({ brandTheme: 'purple' })
    // The server's older preset must not delete the hue the user has just chosen.
    expect(store.get('ta_brand_hue')).toBe('210')
  })

  it('leaves nothing behind once everything is acknowledged', async () => {
    savePreference('mealLabelStyle', 'deli')
    await Promise.resolve(); await Promise.resolve()
    expect(store.has('ta_prefs_unsynced')).toBe(false)
  })
})
