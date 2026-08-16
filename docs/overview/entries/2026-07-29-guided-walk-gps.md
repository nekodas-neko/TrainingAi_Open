## 2026-07-29 — Guided walk: live GPS, pace-primary UI, and recorded per-phase stats

Implements the "GPS/speed/pace/elevation/cadence" guided-walk backlog item
(`docs/superpowers/plans/2026-07-23-guided-walk-gps-speed-pace.md`), picked up after the owner
reported the mid-walk screen was missing live map/speed/HR-zone stats and that fast/slow segments
had no real metrics to compare against each other.

### Reconciliation before implementing
The backlog flagged a possible overlap with the shipped `RunActiveScreen` (dedicated run execution
screen, cardio-redesign batch item). Read `components/activity/activity-screen.tsx` before writing
any code: it gates `activityType === 'run' ? <RunActiveScreen /> : <ActiveActivityScreen />` — only
the manual "run" activity type gets the rich screen. The guided *interval* walk is a fully separate
flow (`lib/stores/guided-walk-store.ts` + `components/guided-walk/`) that was never folded into it.
The plan was not redundant.

Also found live cadence (the plan's Task 3) had already shipped independently since the plan was
written — `walk-active.tsx` already used the newer fused `CadenceTracker` (ring + Polar strap), and
`walk-summary.tsx` already recorded `cadenceSpm`/`cadenceSeries`/`cadenceSource`. Only Tasks 1, 2,
and 4 remained.

### What shipped
- **`lib/stores/debounced-storage.ts`** — extracted `activity-store.ts`'s inline debounced
  localStorage helper (writes coalesced to one `setItem` per 2s) so `guided-walk-store.ts` could
  reuse it for the same reason: `appendPoint` now fires every few GPS seconds.
- **GPS point stream + live map** (`guided-walk-store.ts`, `walk-active.tsx`) — `rawPoints`,
  `distanceKm`, `currentPaceSecPerKm` + `appendPoint`, mirroring `activity-store.ts`'s pattern
  exactly. Wired `startGpsWatcher` into the active-walk lifecycle and rendered `ActivityRouteMap`
  + a distance readout alongside the existing phase/timer UI.
- **GPS-derived fields actually recorded on finish** (`walk-summary.tsx`) — `routePolyline`,
  `splits`, `bestEfforts`, `paceSeries`, `avgPaceSecPerKm`, `elevationGainM/LossM`,
  `elevationProfile` are now computed from `rawPoints` at save time (mirroring
  `activity-store.ts`'s `finish()`) and threaded through both the local-store write +
  outbox-mutation payload and the web-fallback `fetch('/api/activity-logs')` body — previously all
  eight fields were hardcoded `null`, so a walk's route/pace data was silently never saved.
- **`lib/walk/segment-window.ts`** — a small shared `samplesInWindow(samples, getTimeMs, from, to)`
  helper, used for both the existing per-segment HR filter and the new per-segment GPS-point
  filter in `walk-summary.tsx`, instead of writing the same `[from, to)` filter twice. Unit tested
  (empty input, single sample in/out of window, multiple samples, exact-boundary inclusivity).
- **Per-phase avg pace** — the "Per interval" summary rows now show avg pace next to avg HR per
  fast/slow segment (`Set N · Fast — 8:45/km · 132bpm`), giving fast and slow segments an actual
  number to compare, per the owner's ask.
- **Pace-primary live UI** (`walk-active.tsx`) — once a GPS fix exists, live pace is shown at the
  same visual weight bpm used to have (the headline stat), with HR demoted to a secondary line —
  the owner's decision from the original uplift notes (walking HR drifts set-over-set and doesn't
  cleanly separate fast from slow; pace is the real signal). No pace *target*/grading exists yet
  (no walker pace baseline anywhere in the app) — this ships the readout only, per the plan's
  explicit "don't invent a number" guidance; the phase in/push/ease verdict still grades off HR,
  unchanged. Degrades cleanly to today's exact HR-primary layout when no GPS fix exists (indoor
  walk, treadmill).
- Task 5 (real step counts from a windowed raw-BLE-frame reader) intentionally **not** built —
  the plan explicitly scopes it as a separate follow-on needing its own scoping pass.

### Verification
- Full gate: lint (0 errors, pre-existing warnings only), `tsc --noEmit` (clean after clearing a
  stale `.next/types` cache unrelated to this change), full test suite (2547 passed; one
  `oura-ble/live-steps` failure was DB-connection-pool flakiness — passed clean in isolation per
  the documented full-suite-flake pattern; one `claude-ro-readonly-role` failure is this sandbox's
  local `DATABASE_URL` unix-socket format not being parseable by the WHATWG `URL` constructor the
  test itself uses — unrelated file, would run fine in CI's docker-postgres). New
  `segment-window.test.ts` (5 tests) all pass.
- **Real end-to-end dev-server verification via Playwright**, not just unit tests: authenticated as
  the seeded local test user, started a guided walk, and mocked `navigator.geolocation` movement
  (the web fallback `gps-tracking.ts` path used off-device) — confirmed the live map rendered with
  a tracked polyline, pace-primary UI showed `1:45/km` at headline weight with bpm demoted below
  it, and distance updated live. Ended the walk and confirmed the save `POST /api/activity-logs`
  returned **201** (not the 400 it would throw on a schema mismatch) with real computed
  `routePolyline`/`distanceKm`/`avgPaceSecPerKm` in the request body, and the summary screen showed
  a real per-segment pace (`51:53/km · —`). Also confirmed the no-GPS-fix path (default headless
  browser, no mocked location) renders the original HR-primary layout with no map/pace section and
  no crash — the intended graceful degradation for indoor walks.
- **Not verified:** real on-device GPS via the native `BackgroundGeolocation` Capacitor plugin —
  only the browser `navigator.geolocation` web-fallback path in `gps-tracking.ts` was exercised.
  Real ring/strap cadence running concurrently with real GPS movement was also not exercised (both
  existed and were verified independently before this PR).
