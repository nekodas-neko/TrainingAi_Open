export interface TileProvider {
  url: string
  attribution: string
}

const OSM_TILES: TileProvider = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}

// The key is inlined into the client bundle by Next.js (NEXT_PUBLIC_*), so it is public — restrict
// it by domain/referrer in the Thunderforest dashboard if your plan offers that (not available on
// all tiers, e.g. Hobby Project). Reading it as a default param (not at module top level) keeps the
// function pure and unit-testable for both branches.
export function getTileProvider(
  apiKey: string | undefined = process.env.NEXT_PUBLIC_THUNDERFOREST_API_KEY,
): TileProvider {
  // A key that tests as valid standalone but still 401s in the deployed app is a classic
  // copy-paste artifact — a trailing newline/space picked up when pasting into Railway's env
  // var editor, invisible in the dashboard but baked byte-for-byte into the URL. Trim it so a
  // whitespace-corrupted value can't silently fall through as "present but wrong".
  const trimmed = apiKey?.trim()
  if (!trimmed) return OSM_TILES
  // Thunderforest's own docs/dashboard show example tile URLs like
  // "https://api.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=<key>" — pasting that whole
  // URL into the env var instead of just the trailing key is a real Railway misconfiguration
  // that produces this exact blank-tile symptom. Extract the apikey param if the value looks
  // like a URL rather than a bare key.
  const apikeyMatch = trimmed.match(/[?&]apikey=([^&]+)/)
  const key = apikeyMatch ? apikeyMatch[1] : trimmed
  return {
    url: `https://{s}.tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey=${key}`,
    attribution:
      'Maps &copy; <a href="https://www.thunderforest.com">Thunderforest</a>, Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }
}
