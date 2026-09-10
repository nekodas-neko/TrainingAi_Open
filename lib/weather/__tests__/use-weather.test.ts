import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { weatherCacheKey } from '../use-weather'

const ROOT = path.resolve(__dirname, '../../..')

/**
 * PS-35b ④ — the weather cache was ONE unkeyed entry, read before any coordinates were known.
 *
 * A device that had moved therefore showed the previous location's weather for up to 30 minutes,
 * and the fetch that would have corrected it was skipped as a fresh hit. The keying is the fix; the
 * ordering is the other half, and neither works without the other.
 */
describe('weatherCacheKey', () => {
  const brisbane = { lat: -27.4698, lon: 153.0251 }
  const sydney = { lat: -33.8688, lon: 151.2093 }

  it('gives two places two entries — the whole point', () => {
    expect(weatherCacheKey(brisbane)).not.toBe(weatherCacheKey(sydney))
  })

  it('rounds to ~1.1 km, so walking around a suburb still hits the cache', () => {
    expect(weatherCacheKey(brisbane)).toBe(weatherCacheKey({ lat: -27.4703, lon: 153.0254 }))
  })

  it('has bucket EDGES, and that is accepted rather than papered over', () => {
    // 153.0251 rounds to .03 and 153.0249 to .02, so two points 20 m apart can land in different
    // buckets. Inherent to any rounding, and the cost is one extra fetch — where the alternative,
    // no key at all, was half an hour of another city's weather.
    expect(weatherCacheKey({ lat: -27.4698, lon: 153.0251 }))
      .not.toBe(weatherCacheKey({ lat: -27.4698, lon: 153.0249 }))
  })

  it('uses the same rounding as the in-flight dedup key, not a second rule', () => {
    // `fetchWeatherSnapshotShared` keys on `toFixed(2)` of the same pair. Two roundings would
    // dedup a fetch the cache then stored under a different name.
    const src = readFileSync(path.join(ROOT, 'lib/weather/use-weather.ts'), 'utf8')
    expect(src.match(/toFixed\(2\)/g) ?? []).toHaveLength(4)   // lat+lon, twice
  })

  it('is namespaced, so it cannot collide with the old unkeyed entry', () => {
    expect(weatherCacheKey(brisbane).startsWith('ta_weather_cache:')).toBe(true)
    expect(weatherCacheKey(brisbane)).not.toBe('ta_weather_cache')
  })
})

describe('the hook reads the cache only once it knows where it is', () => {
  const raw = readFileSync(path.join(ROOT, 'lib/weather/use-weather.ts'), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('resolves coordinates before reading the keyed cache', () => {
    const coordsAt = code.indexOf('const device = await getDeviceLocation()')
    const readAt = code.indexOf('const cached = readCache(coords)')
    expect(coordsAt).toBeGreaterThan(-1)
    expect(readAt).toBeGreaterThan(coordsAt)
  })

  it('still paints instantly from the last known place', () => {
    // Keying by coordinates costs the synchronous seed, and a skeleton flash on a repeat visit is
    // a bug here. In a useEffect, not a useState initializer — which is what the old code used.
    expect(code).toMatch(/readCache\(readLastCoords\(\)\)/)
    expect(code).not.toMatch(/useState<WeatherSnapshot \| null>\(\(\) =>/)
  })

  it('reports a failure instead of pulsing forever', () => {
    expect(code).toMatch(/setFailed\(true\)/)
    expect(code).toMatch(/return \{ snapshot, loading, failed \}/)
  })

  it('prefers a stale snapshot for THIS place over an error state', () => {
    expect(code).toMatch(/if \(cached\) setSnapshot\(cached\)\s*\n\s*else setFailed\(true\)/)
  })
})

/** PS-35b ① — the PWA launched into a bare `redirect()`. */
describe('the manifest start_url is a real route', () => {
  const manifest = readFileSync(path.join(ROOT, 'app/manifest.ts'), 'utf8')
  const startUrl = /start_url:\s*"([^"]+)"/.exec(manifest)?.[1]

  it('points at /workout, not the redirect that forwards there', () => {
    expect(startUrl).toBe('/workout')
  })

  it('names a page that is not itself a redirect', () => {
    const page = readFileSync(path.join(ROOT, `app${startUrl}/page.tsx`), 'utf8')
    expect(page).not.toMatch(/^\s*redirect\(/m)
  })
})

/** PS-35b ② — the warm must share `cachedFetch`'s in-flight map, or it doubles the request. */
describe('the boot warm does not issue its own requests', () => {
  const raw = readFileSync(path.join(ROOT, 'components/sync-provider.tsx'), 'utf8')
  const warm = raw.slice(raw.indexOf('async function warmCache'), raw.indexOf('interface SyncProviderProps'))
  const code = warm.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('has no bare fetch left in it', () => {
    expect(code).not.toMatch(/\bawait fetch\(/)
    expect(code).not.toMatch(/\bres\.json\(\)/)
  })

  it('picks the fetcher that matches the key\'s envelope', () => {
    // A `today: true` key is read back through `unwrapToday`; warming it with the plain fetcher
    // would store a payload every reader then rejects.
    expect(code).toMatch(/task\.today \? cachedFetchToday : cachedFetch/)
  })
})
