## 2026-07-28 — Hide map attribution (personal-use only, deliberately deferred)

Follow-up to the Atlas style swap and the earlier map-tile fixes. Owner asked to remove the
"Leaflet | Maps © Thunderforest, Data © OpenStreetMap contributors" line from the activity route
map. Flagged first that this text is a license requirement (OpenStreetMap's ODbL, Thunderforest's
ToS — both apply even on the free Hobby tier), not a styling choice, and that removing it is a real
compliance gap rather than a cosmetic one. Owner's explicit decision: hide it for now since the app
is personal-use-only, and revisit before any public release.

### Change
`components/activity/activity-route-map.tsx`'s `MapContainer` now sets `attributionControl={false}`,
which removes Leaflet's attribution control entirely. `lib/map-tiles.ts` still builds an
`attribution` string (unused while the control is disabled) so re-enabling is a one-line revert.

### Tracking
Created `docs/public-launch-checklist.md` — a new, purpose-built file for exactly this kind of
"deferred because personal-use-only" item, so the owner's stated future workflow ("when I want to
go public I'll ask what violations we need to fix") has one clear place to check rather than relying
on a future session rediscovering this from scratch. Added it to `projectOverview.md`'s Document Map
and updated the `docs/module-map.md` row for map tiles to point at it.

### Tests
No logic changed (`attributionControl` is a Leaflet/react-leaflet prop, no test coverage exists or
is warranted for it). `pnpm lint` clean.
