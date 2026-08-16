# Public Launch Checklist — read this before sharing the app beyond personal use

**Purpose.** This app currently runs as a personal-use-only tool, which makes some shortcuts and
deferred compliance items acceptable that would NOT be acceptable for a public release. When the
owner asks "what violations do we need to fix" (or similar) before opening the app up more broadly,
this is the list to check.

---

## 1. Map tile attribution is hidden (license violation if left this way for public use)

- **What:** The activity route map's Leaflet attribution control (`"Leaflet | Maps © Thunderforest,
  Data © OpenStreetMap contributors"`) is hidden via `attributionControl={false}` on the
  `MapContainer` in `components/activity/activity-route-map.tsx`.
- **Why it's fine for now:** Personal-use-only, single user, no public distribution.
- **Why it's a real problem for public use:** OpenStreetMap's data license (ODbL) and
  Thunderforest's Terms of Service (both apply even on the free Hobby tier this app uses) require
  visible on-map attribution. Shipping this to other users without it is a license violation, not
  just a style preference.
- **Fix before public launch:** Remove `attributionControl={false}` (restores the default control),
  or — for a less obtrusive look — build a compliant custom treatment (e.g. a small collapsed
  info-icon that expands to show the same required text) rather than removing it outright. See the
  note in `docs/module-map.md` §12 (Activity/GPS/weather) for the full context and prior debugging
  history (the CSP `connect-src` fix that made tiles render at all, `docs/overview/entries/2026-07-28-*`).

---

*(Add further items here as they come up — anything deferred specifically because the app is
personal-use-only belongs on this list, not silently left for someone to rediscover later.)*
