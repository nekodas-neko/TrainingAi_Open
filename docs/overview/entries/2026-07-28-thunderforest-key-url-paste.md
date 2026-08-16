## 2026-07-28 — Thunderforest map key: tolerate a full URL pasted as the key

Follow-up to the whitespace-trim fix (PR #840). Owner confirmed CSP was fixed and the key tested
valid standalone, yet the activity route map was still a blank grey background after the trim fix
deployed. Owner then identified the likely real cause: they had pasted the *full example tile URL*
from Thunderforest's docs into the `NEXT_PUBLIC_THUNDERFOREST_API_KEY` env var —
`https://api.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=<key>` — instead of just the bare
key.

### Diagnosis
`getTileProvider()` builds the tile URL as `...apikey=${key}`. With the full URL as the "key"
value, that produces a doubly-nested, malformed URL
(`...apikey=https://api.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=<realkey>`), which never
resolves to a valid tile image — exactly the blank-grey symptom, with correct attribution text
(attribution doesn't depend on the key) and no console-visible CSP violation (the URL is
syntactically still under the CSP-approved host as a prefix).

### Fix
`getTileProvider()` now checks whether the (trimmed) key value contains an `apikey=` query
parameter and, if so, extracts just that parameter's value instead of using the whole string. A
bare key (the normal case) is unaffected. This is a real, already-observed misconfiguration rather
than a hypothetical one, so it's handled defensively instead of only being called out in docs.

### Tests
New case in `lib/map-tiles.test.ts`: passing the full example URL (with a real-looking key)
resolves to the correctly-formed tile URL using just the extracted key. All 6 tests pass. `pnpm
lint` clean, no new tsc errors.
