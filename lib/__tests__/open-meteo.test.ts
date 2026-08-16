import { describe, it, expect, vi, afterEach } from 'vitest'
import { mapWeatherCode, fetchWeatherSnapshot } from '../weather/open-meteo'

describe('mapWeatherCode', () => {
  it('maps code 0 to clear', () => {
    expect(mapWeatherCode(0)).toBe('clear')
  })

  it('maps codes 1-3 and unrecognised codes to cloudy', () => {
    expect(mapWeatherCode(1)).toBe('cloudy')
    expect(mapWeatherCode(2)).toBe('cloudy')
    expect(mapWeatherCode(3)).toBe('cloudy')
    expect(mapWeatherCode(4)).toBe('cloudy')
  })

  it('maps codes 45 and 48 to fog', () => {
    expect(mapWeatherCode(45)).toBe('fog')
    expect(mapWeatherCode(48)).toBe('fog')
  })

  it('maps drizzle, rain and rain-shower codes to rain', () => {
    expect(mapWeatherCode(51)).toBe('rain')
    expect(mapWeatherCode(63)).toBe('rain')
    expect(mapWeatherCode(67)).toBe('rain')
    expect(mapWeatherCode(80)).toBe('rain')
    expect(mapWeatherCode(82)).toBe('rain')
  })

  it('maps snow and snow-shower codes to snow', () => {
    expect(mapWeatherCode(71)).toBe('snow')
    expect(mapWeatherCode(77)).toBe('snow')
    expect(mapWeatherCode(85)).toBe('snow')
    expect(mapWeatherCode(86)).toBe('snow')
  })

  it('maps codes 95-99 to thunderstorm', () => {
    expect(mapWeatherCode(95)).toBe('thunderstorm')
    expect(mapWeatherCode(96)).toBe('thunderstorm')
    expect(mapWeatherCode(99)).toBe('thunderstorm')
  })
})

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
