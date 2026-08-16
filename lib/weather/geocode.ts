import type { ManualLocation } from './types'

interface GeocodeResult {
  latitude: number
  longitude: number
  name: string
  admin1?: string
  country?: string
}

interface GeocodeResponse {
  results?: GeocodeResult[]
}

function formatLocationName(result: GeocodeResult): string {
  return [result.name, result.admin1, result.country].filter(Boolean).join(', ')
}

export async function geocodeLocations(query: string, count = 5): Promise<ManualLocation[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${count}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Geocoding request failed: ${res.status}`)
  const data = (await res.json()) as GeocodeResponse
  return (data.results ?? []).map((result) => ({
    lat: result.latitude,
    lon: result.longitude,
    name: formatLocationName(result),
  }))
}
