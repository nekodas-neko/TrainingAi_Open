import { describe, it, expect, vi, afterEach } from 'vitest'
import { geocodeLocations } from '../weather/geocode'

describe('geocodeLocations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('combines name, admin1, and country into the display name', async () => {
    const mockJson = {
      results: [{ latitude: -27.42, longitude: 152.96, name: 'Mitchelton', admin1: 'Queensland', country: 'Australia' }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockJson) }))

    const result = await geocodeLocations('Mitchelton')

    expect(result).toEqual([{ lat: -27.42, lon: 152.96, name: 'Mitchelton, Queensland, Australia' }])
  })

  it('falls back to just the name when admin1 and country are missing', async () => {
    const mockJson = { results: [{ latitude: 51.5, longitude: -0.12, name: 'London' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockJson) }))

    const result = await geocodeLocations('London')

    expect(result).toEqual([{ lat: 51.5, lon: -0.12, name: 'London' }])
  })

  it('returns multiple results so the user can disambiguate', async () => {
    const mockJson = {
      results: [
        { latitude: -27.42, longitude: 152.96, name: 'Mitchelton', admin1: 'Queensland', country: 'Australia' },
        { latitude: 51.39, longitude: -0.16, name: 'Mitcham', admin1: 'England', country: 'United Kingdom' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockJson) }))

    const result = await geocodeLocations('Mitch')

    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({ lat: 51.39, lon: -0.16, name: 'Mitcham, England, United Kingdom' })
  })

  it('returns an empty array when there are no results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ results: [] }) }))

    const result = await geocodeLocations('Nowhereville')

    expect(result).toEqual([])
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await expect(geocodeLocations('Mitchelton')).rejects.toThrow('Geocoding request failed: 500')
  })
})
