import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWeatherSnapshot } from '../weather/open-meteo'

describe('fetchWeatherSnapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds the request URL and maps the response into a WeatherSnapshot', async () => {
    const mockJson = {
      current: { temperature_2m: 16.2, weather_code: 3 },
      daily: { sunrise: ['2026-06-11T06:32'], sunset: ['2026-06-11T17:08'] },
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockJson),
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await fetchWeatherSnapshot({ lat: -27.4006, lon: 152.9595 })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('latitude=-27.4006&longitude=152.9595'),
    )
    expect(snapshot).toMatchObject({
      condition: 'cloudy',
      temperatureC: 16.2,
      sunrise: '2026-06-11T06:32',
      sunset: '2026-06-11T17:08',
      lat: -27.4006,
      lon: 152.9595,
    })
    expect(typeof snapshot.fetchedAt).toBe('number')
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await expect(fetchWeatherSnapshot({ lat: 0, lon: 0 })).rejects.toThrow(
      'Open-Meteo request failed: 500',
    )
  })
})
