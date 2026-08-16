## 2026-07-29 — HR-zone route coloring: constant-pace fallback + completion-screen coverage

Follow-up to the HR-zone-colored route map (2026-07-28). Owner tested it against a real
historical walk and it stayed flat-colored; investigation found the walk's HR chart was already
rendering via the plain fallback chart (not the richer scrub-enabled one) — a pre-existing
distinction in `activity-detail-sheet.tsx` gated on `log.paceSeries` being present. That log simply
had no pace series stored, which is also exactly what the zone-coloring feature needs to correlate
route position to elapsed time. Owner pushed back correctly: HR readings do carry timestamps, so
why is a pace series needed at all?

### Answer / fix
A pace series is needed because *route points* don't carry timestamps (the encoded polyline format
only stores lat/lng) — HR-reading timestamps alone don't tell you *when* a given route point was
reached. `paceSeries` was the only way to bridge that gap. Added a fallback: when no pace series is
available but a start and end time both are, `buildRouteZoneSegments` (`lib/activity/route-hr-zones.ts`)
now assumes constant pace across the whole route (elapsed time ∝ cumulative distance) instead of
giving up. Less precise for an uneven-effort route, but every GPS activity has a start/end time,
so this makes the feature apply far more broadly than "only logs with a captured pace series."

### Also requested: wire into the completion screen, and confirm calendar coverage
Owner asked for the same coloring on the activity completion screen (not just the historical
detail view), for walk/run/treadmill, and to see it when browsing past activities via the
calendar. Findings:
- The "browse past activities" screen *is* `activity-detail-sheet.tsx` (confirmed via its callers,
  `app/health/health-content.tsx` and `components/health/activity-history-card.tsx`) — already
  covered by yesterday's work, no separate calendar surface exists.
- Wired the same logic into `components/activity/done-activity-screen.tsx` (the completion
  screen) — it didn't previously fetch the full HR time series or zone profile at all (only a
  one-off avg/max for the treadmill distance flow), so both were added.
- Also wired into `components/activity/exercise-review-sheet.tsx` (the "review a passively-detected
  walk/run" sheet) — these sessions never have a pace series at all, so this surface exercises the
  new constant-pace fallback exclusively.
- Treadmill activities have no GPS route at all (indoor, no lat/lng), so there's no map to color
  for them — the completion-screen wiring applies to walk/run only, same as the map itself already
  only renders when a route exists.

### Aside: "today's walk has no map at all"
Traced to an unrelated, already-independently-fixed gap: guided/interval walks never captured GPS
at all until a concurrent session's PR (#882, merged today) added it. Any guided walk logged before
that merged has no route to show, map or otherwise — not something this feature broke.

### Tests
Two new cases in `lib/activity/__tests__/route-hr-zones.test.ts` (constant-pace fallback coloring
correctly, and returning null for a zero-duration edge case) — 7 tests in that file, 102 across
`lib/activity/` as a whole. `pnpm typecheck`/`pnpm lint` clean (pre-existing `onnxruntime-web`
sandbox gap aside).
