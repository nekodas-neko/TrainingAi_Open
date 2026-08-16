## 2026-07-23 — Score-cards round 3: fixed accent-tick ring, active minutes (v1.207.0)

Third round of the core score-cards + Activity overhaul, again after live owner review of the
previous round's screenshots. Two mockup passes were shown before writing any code this round, per
the owner's explicit request ("potentially some mockups first, to make sure we are on the same
page").

**1. Card ring redesign, round 3.** The round-2 progress-fill ring ("bolder... but still not what I
am after") was replaced after two mockup rounds (7 static/HUD concepts, then 6 more literal
gym-hardware/HUD concepts — weight plate, knurled grip, reticle brackets, medallion+ribbon, full EKG
trace, fixed accent tick). Owner picked **M — fixed accent tick**: a thin white ring plus one
fixed-position, fixed-length accent arc in the card's own identity colour. The key insight from the
owner's feedback that shaped every option this round: a *proportional fill* implies "% complete,"
which is meaningless for a Heart Rate card showing a bpm value — every option this round was static/
non-proportional, with state living only in the small dot (unchanged from round 1). The four accent
colours are NOT new — they're the exact hexes each metric's own detail screen already uses for its
sparkline (`readiness-content.tsx` `#60a5fa`, `sleep-content.tsx` `#818cf8`, `activity-content.tsx`
`#f97316`) or its own trend chart (`heart-rate/page.tsx`'s RHR sparkline `#f87171`), so the ring now
matches the app's existing per-metric palette instead of inventing a new one.

**2. Active minutes ("activity doesn't have the active minutes feature we talked about").** This was
a real correction to round-1 planning, not new scope. The W-B plan had deferred zone-minutes and
move-every-hour as "device-gated, needs the intraday HR series" — but that series (`todayHrRows`) was
already being fetched server-side in `/api/readiness-score` for `hrCurrent`/`hrMin`/`hrMax`/`hrAvg`.
There was nothing to defer. Implementation:
- `lib/health/zone-minutes.ts` already existed on `main` (from an earlier, unrelated PR) as the
  canonical time-in-HR-zone primitive (`accumulateZoneSeconds`, `computeHrZones`-driven). Rather than
  create a second file with the same name (caught by the Write tool's read-before-overwrite guard —
  a near-miss worth recording), added one function to it: `activeMinutesFromZoneSeconds`, WHO-style
  (moderate = Zone 2 counts once, vigorous = Zone 3+ counts double).
- New `lib/health/hourly-movement.ts` for "move every hour" — the app has no hourly step buckets to
  match Oura's exact method, so this uses an honest HR-elevation proxy instead: an hour counts as
  moved if any reading exceeds the same rest/active boundary Body Battery already uses. That
  threshold was a private `REST_THRESHOLD` constant inside `app/api/body-battery/route.ts`; promoted
  to `HR_REST_THRESHOLD` in the shared `lib/health/hr-zones.ts` so both features read one number, not
  two independently-tuned ones.
- Both wired into `/api/readiness-score` and into a new gauge pair on the Activity detail screen
  ("Active minutes today": Zone minutes, Hours moved), alongside the round-2 gauges.

**Found and fixed in the same pass:** while wiring the profile/age lookup for the zone-minutes Karvonen
calc, found that round 1 had created `ageFromDob` in `lib/health/daily-goals.ts` without noticing the
canonical implementation already in `lib/date-utils.ts` (used by 8 other call sites — body-battery,
running-plan, training-stress, baselines page, etc.). Deleted the duplicate, repointed the 2 callers
that used it (`readiness-score/route.ts`, `ai/health-insight/route.ts`), and moved its test coverage
to `date-utils.test.ts` so nothing was lost. This is exactly the "two implementations of the same
metric" class CLAUDE.md's One Formula One Place rule exists to catch — recorded here as a reminder
that a new session picking up someone else's earlier work should grep before adding a helper, even
inside its own prior work.

**Verification:** `tsc` clean, lint clean, full suite **1927 passing** (17 new: `activeMinutesFromZoneSeconds`
WHO-doubling cases, `computeMovedHours` timezone/threshold cases, the relocated `ageFromDob` tests).
Dev-server round-trip on the seeded user, with **synthetic `oura_heartrate` rows inserted directly into
the local dev DB** (3 time blocks: a resting stretch, a moderate walk, a vigorous interval) to prove the
zone-minutes/moved-hours computation end-to-end since the seed has no intraday HR data by default —
confirmed `zoneMinutes: 4`, `moveHours: 3` computed correctly from the synthetic series, with the right
sub-scores in `activityContributors`. Rows deleted after verification (test-only, not a migration).
**Playwright screenshots** (installed standalone via npx, not a project dependency) confirmed: the new
ring renders with the fixed accent arc + dot + no text on every card; the Activity detail's new "Active
minutes today" gauge card renders real values (4 min / 3 hrs) alongside the round-2 gauges and the
contributor chart/deep-dive (now 4 factors: Zone minutes, Move every hour, Training volume, Training
frequency). One debugging note: an initial screenshot appeared to be missing the new gauge card — traced
to a stale render caught mid-Fast-Refresh, not a real bug; a hard reload showed it correctly, confirmed
via a console-log/network check that ruled out an actual client error (the only console error present,
`/api/oura/sync` 400, is the pre-existing no-PAT-configured sandbox limitation, unrelated).

**Not verified (device-gated, unchanged from prior rounds):** Samsung-WebView paint of the new ring,
real-ring zone-minutes/moved-hours on an actual worn day. The "yesterday-completed" home display and the
hourly move-nudge notification remain open — out of scope for this round's ask.
