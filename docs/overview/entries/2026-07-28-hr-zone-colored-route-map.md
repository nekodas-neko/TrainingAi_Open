## 2026-07-28 — Route map line colored by HR zone

Follow-up to the map-tile fixes and the Atlas style swap. Owner asked for the route line to be
colored by HR zone (like Strava's segment-effort coloring), so it's visible at a glance where a
run/walk was pushed harder.

### Diagnosis
Route points are stored as an encoded polyline (`activity_logs.route_polyline`), which only carries
lat/lng — the per-point recording timestamp is dropped at encode time (confirmed via
`lib/activity/route-encoding.ts`). So there's no direct point→HR-reading correlation available;
the existing scrub-marker feature (`activePoint` on `ActivityRouteMap`, driven by the hero chart)
already solves half of this problem by converting an elapsed-seconds position to a route point via
`estimateDistanceKmAtTime` (elapsed sec → cumulative distance) + `pointAtDistanceKm` (distance →
point), both in `lib/activity/scrub.ts`.

### Implementation
- Added `estimateTimeAtDistanceKm` to `lib/activity/scrub.ts` — the exact mathematical inverse of
  `estimateDistanceKmAtTime` (distance → elapsed seconds instead of elapsed seconds → distance),
  same bucket-walk structure.
- New `lib/activity/route-hr-zones.ts` (`buildRouteZoneSegments`): for each segment between
  consecutive route points, finds the along-route distance at its midpoint, converts to elapsed
  time via the new inverse function, converts to a wall-clock timestamp using the activity's start
  time, then finds the nearest HR reading by timestamp and classifies its zone
  (`lib/health/hr-zones.ts` — `computeHrZones`/`zoneForBpm`/`HR_ZONE_META`, no new palette).
  Consecutive same-zone segments merge into one run (sharing boundary points, so the drawn line has
  no gaps) rather than drawing one `<Polyline>` per tiny segment.
- `components/activity/activity-route-map.tsx` gained an optional `zoneSegments` prop — when
  present, draws these colored runs instead of the flat single-color `<Polyline>`; omitted/`null`
  keeps today's flat brand-color line unchanged (the owner's explicit choice for activities with no
  HR data to color by).
- `components/activity/activity-detail-sheet.tsx` computes `zoneSegments` via `useMemo` from data
  it already fetches (`hrData.readings`, `log.paceSeries`, `hrProfile`) — no new API calls.
  `log.startTime` is a bare `"HH:MM"` (no date/timezone), same as every other use of that field in
  this file (`formatTime12h` does no tz conversion either), so it's combined with `log.date` and
  parsed in the browser's local time — consistent with how the rest of the screen already treats
  these two fields, and fine here since HR readings only need to land within a sample interval, not
  to the second.

### Scope
Wired into the activity detail sheet (the screen this was requested from) only, for now.
`done-activity-screen.tsx` and `exercise-review-sheet.tsx` also render `ActivityRouteMap` and could
get the same treatment (their HR-reading and pace-series data already exist there too, but neither
currently fetches `hrProfile`) — left as a fast follow rather than expanding this PR's scope.

### Tests
17 new/updated cases across `lib/activity/__tests__/scrub.test.ts` (the new inverse function,
including a round-trip check against the forward function) and the new
`lib/activity/__tests__/route-hr-zones.test.ts` (null-fallback cases, single-zone merge, multi-zone
split with gap-free boundaries). `pnpm typecheck`/`pnpm lint` clean (pre-existing `onnxruntime-web`
sandbox gap and one pre-existing unrelated `react-hooks/exhaustive-deps` warning aside).

### Not yet verified
Correct on a manually-inspected test case and the existing (already-shipped) scrub-marker
infrastructure this reuses, but not checked against a real multi-zone GPS route on-device.
