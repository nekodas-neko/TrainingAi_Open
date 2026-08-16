import { describe, expect, it } from 'vitest'
import { getTileProvider } from './map-tiles'

describe('getTileProvider', () => {
  it('returns Thunderforest Atlas tiles when an API key is provided', () => {
    const provider = getTileProvider('abc123')
    expect(provider.url).toBe(
      'https://{s}.tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey=abc123',
    )
    expect(provider.attribution).toContain('Thunderforest')
    expect(provider.attribution).toContain('OpenStreetMap')
  })

  it('falls back to OpenStreetMap tiles when no key is provided', () => {
    const provider = getTileProvider(undefined)
    expect(provider.url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(provider.attribution).toBe(
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    )
  })

  it('treats an empty-string key as absent and falls back to OSM', () => {
    const provider = getTileProvider('')
    expect(provider.url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
  })

  it('trims a key with incidental whitespace (a common paste-into-env-var artifact)', () => {
    const provider = getTileProvider('\nabc123 \t')
    expect(provider.url).toBe(
      'https://{s}.tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey=abc123',
    )
  })

  it('treats a whitespace-only key as absent and falls back to OSM', () => {
    const provider = getTileProvider('   \n\t  ')
    expect(provider.url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
  })

  it('extracts the apikey param when the full example tile URL is pasted as the key (a real Railway misconfiguration)', () => {
    const provider = getTileProvider(
      'https://api.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=38e20b6b21d849cb999c9f8898a8648e',
    )
    expect(provider.url).toBe(
      'https://{s}.tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey=38e20b6b21d849cb999c9f8898a8648e',
    )
  })
})
