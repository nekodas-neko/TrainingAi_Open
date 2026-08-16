## 2026-07-23 — Zone-minutes into the Activity score + per-walk time-in-zone (v1.205.2)

**Branch:** `claude/guided-walk-uplifts-1gou5m` — continuation of the same-day guided-walk
uplift session. Follow-up to the Phase G finding in
[`docs/superpowers/plans/2026-07-23-guided-walk-uplift.md`](../../superpowers/plans/2026-07-23-guided-walk-uplift.md)
that the Activity score never included any signal from logged activities.

### What shipped

- **Zone-minutes wired into the Activity score.** `computeActivityScore` (`lib/health/activity-score.ts`)
  already had a `zoneMinutes` input and weight (`W_ZONE_MINUTES`) — it was simply never fed a
  real value; `app/api/readiness-score/route.ts` always passed nothing, with a comment claiming
  the intraday HR series needed for it was "device-gated." That claim turned out to be stale:
  the route already fetches the day's continuous HR series (`todayHrRows`) for other stats
  (current/min/max/avg HR). Added: `resolveHrProfile` (canonical zone-profile resolver, same one
  `/api/hr-profile` and `/api/zone-minutes` use) + `accumulateZoneSeconds`/`computeHrZones` to
  turn that same series into moderate (Zone 2-3) + 2×vigorous (Zone 4-5) minutes — the CDC/AHA
  convention the interface docstring already specified — and pass it in.
- **This sidesteps the double-counting risk the plan flagged**, because it isn't reading
  `activity_logs` at all — it's one continuous per-timestamp HR series that already includes
  whatever zone-time accrued during any activity (a workout, a walk, general daytime wear), so
  there's nothing to double-count against. That risk still applies to **steps** (a separate,
  still-open item — `body_metrics.steps` is a daily total, not a time series, so there's no way
  to isolate "steps during this activity's window" from it the same way).
- **Per-walk time-in-zone breakdown on the guided walk summary.** `components/guided-walk/walk-summary.tsx`
  now renders the same `ZoneBreakdown` component (`components/health/zone-breakdown.tsx`) the
  regular activity detail view already uses — fed from the walk's own collected HR samples plus
  a `/api/hr-profile` fetch, exactly mirroring `activity-detail-sheet.tsx`'s existing pattern. No
  new persistence; it's the same "compute from readings already in memory/re-fetched" approach
  used everywhere else this component appears.

### Verification

- `tsc --noEmit` clean (2 pre-existing, unrelated `onnxruntime-web` errors only); `eslint` clean.
- Full `lib/health` suite: 458 tests passing, no regressions.
- **Live dev-server pass**: `GET /api/readiness-score` returns 200 with a real score
  (zone-minutes lane renormalises out when `todayHrRows` is empty, as in the seeded dev DB —
  expected, no crash). Completed a full guided walk end-to-end via a scripted Playwright
  walkthrough; the summary screen rendered without error (the zone breakdown correctly stays
  hidden with zero live-HR samples, since the sandbox has no ring/strap — same as every other
  HR-dependent card in the sandbox).
- Not verified with real HR data (needs a device with a ring/strap actually recording during a
  walk) — same standing gate as every other HR-derived feature in this app.

### Next

Steps remain unwired into both the Activity score and the day's step total — genuinely blocked
on either Phase A (GPS/cadence for the guided walk specifically) or a broader intraday
step-source design for activity logs in general. Tracked in the plan's Phase G section.
