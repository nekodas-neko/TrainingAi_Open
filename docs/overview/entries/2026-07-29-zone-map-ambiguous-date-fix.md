## 2026-07-29 — Fix ambiguous date parsing collapsing the zone map to one color

Follow-up to the constant-pace fallback (#887). Owner tested the fallback against the same
2026-07-24 walk and it now showed *a* zone color instead of the flat brand line — but the entire
route rendered as one uniform color (Z3/yellow), despite the "Time in Zone" breakdown for the same
walk showing real time in all four other zones (Z1 2:04, Z2 3:03, Z4 0:31). That breakdown is
computed from the exact same `hrData.readings` + `hrProfile`, so the readings and zone bands
themselves were confirmed correct — the bug had to be in how route points were being correlated to
elapsed time.

### Root cause
`components/activity/activity-detail-sheet.tsx`'s `zoneSegments` computation built a bare
date-time string — `` `${log.date}T${log.startTime}:00` `` (e.g. `"2026-07-24T08:12:00"`, no
timezone offset) — and handed it straight to `new Date(...)`. A date-time string with no offset is
supposed to parse as local time per spec, but this is a long-standing, engine-dependent ambiguity
(bare ISO-like strings have historically been a common source of UTC-vs-local parsing bugs across
JS engines, including WebViews). If parsed as UTC instead of AEST, every query point in the
9-minute activity would land ~10 hours away from `hrData.readings`' real absolute timestamps —
uniformly, since a 10-hour shift dwarfs the activity's own duration. `nearestBpm`'s clamp-to-edge
behavior would then return the *same* boundary reading for every single query, regardless of the
real distance-based variation — exactly the observed symptom. The three other callers of
`buildRouteZoneSegments` (`done-activity-screen.tsx`, `exercise-review-sheet.tsx`) were never at
risk: they build their timestamps via `new Date(numericMs).toISOString()`, which is always
UTC-suffixed and unambiguous.

### Fix
Replaced the bare string construction with the multi-argument `Date` constructor
(`new Date(y, mo - 1, d, sh, sm, 0)`), which is unambiguously local time in every JS engine per
spec — no string-format parsing involved at all — then immediately converts to an absolute,
unambiguous ISO string via `.toISOString()` before it ever reaches `buildRouteZoneSegments`. This
mirrors the pattern the server's own `date + HH:MM → UTC` conversion already uses in
`/api/oura/hr-window` (`new Date(y, mo - 1, d, sh, sm, 0)` there too, before applying
`fromZonedTime`).

### Why the existing tests didn't catch this
`lib/activity/__tests__/route-hr-zones.test.ts` tests `buildRouteZoneSegments` directly and always
passed fully-qualified `Z`-suffixed timestamps — the pure function itself was never buggy. The bug
lived entirely in how one specific *caller* constructed the string it passed in, which a unit test
of the pure function can't exercise. No new test added for this reason; the fix itself removes the
ambiguity structurally (there's no string format left to get wrong) rather than working around a
symptom.

### Tests
`npx vitest run lib/activity/` — 102/102 passed (unchanged; confirms the fix didn't regress the
pure-function behavior). `pnpm lint`/`pnpm typecheck` clean.

### Not yet confirmed
Owner to re-check the same 2026-07-24 walk and confirm the route now shows real color variation
matching its "Time in Zone" breakdown, plus the completion-screen and passively-detected-session
paths from #887 that hadn't been confirmed yet either.
