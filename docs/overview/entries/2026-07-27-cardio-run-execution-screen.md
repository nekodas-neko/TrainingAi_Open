## 2026-07-27 — Dedicated run execution screen

Implements `docs/superpowers/plans/2026-07-27-cardio-run-execution-screen.md`, completing the
"Dedicated run execution screen" cardio backlog item (spec phase 5,
`docs/superpowers/specs/2026-07-26-cardio-system-spec.md`).

### What shipped
- **`RunActiveScreen`** (`components/activity/run-active-screen.tsx`) replaces the generic
  `ActiveActivityScreen` specifically for runs (`activityType === 'run'`), branched in
  `components/activity/activity-screen.tsx`. Adds a live HR + zone hero
  (`components/activity/run-hr-zone-hero.tsx`) — the first place live HR from `lib/live-hr/`
  (already used by the workout screen) is wired into the activity flow — plus splits-so-far and
  elevation-so-far derived from the existing `computeSplits`/`computeElevationChange` functions,
  a larger live map, and the existing cadence readout. When the run has a linked prescription
  (started from `/running`), the hero shows whether the current HR zone matches the target.
- **No new stored data, no new API route, no sync-chain changes** — the screen reads the
  `running-plan` client cache key `RunningPlanContent` already warms, and reuses the existing
  `activity-store`/GPS/cadence/map machinery verbatim.
- Extracted two small pieces of logic out of `ActiveActivityScreen` so both screens share the same
  code instead of a duplicate: the elapsed-clock leaf (`activity-elapsed-clock.tsx`) and the
  cadence-tracker lifecycle (`lib/activity/use-cadence-tracking.ts`). Non-run activities are
  otherwise completely untouched — verified via a direct store-state injection test that "yoga"
  still renders the original, unmodified `ActiveActivityScreen`.

### Verification
- Full suite green (2200 tests). Isolated production build succeeded.
- Manual/Playwright end-to-end: created a running plan, started a run from `/running`, confirmed
  the new screen renders (elapsed clock, distance/pace, cadence readout, HR/zone hero in its
  waiting state since no strap/ring is connected in the sandbox, live map). Drove the full
  Start → active → Finish → Save flow and confirmed via `psql` the resulting `activity_logs` row
  persisted correctly, with the redirect to `/workout-select` completing (the first attempt raced
  a cold dev-server compile of `/workout-select`, not a real navigation bug — confirmed by waiting
  on the URL change explicitly on a retry, and by the server log showing the route request
  actually completed).
- **Not verified:** on-device (APK) — live HR requires a real Polar strap or Oura ring, and the
  GPS/map path needs a real device fix; neither is reachable in the sandbox.

### Known, pre-existing, out-of-scope
`ActivityRouteMap`'s viewport does not auto-recenter as new GPS points stream in — react-leaflet's
`bounds` prop is effectively mount-time-only. This is inherited from the existing component (not
introduced by this change) and was explicitly out of scope for this plan.
