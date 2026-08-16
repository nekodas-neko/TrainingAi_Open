## 2026-07-23 — Score-cards round 2: bolder ring, Activity detail depth (v1.206.0)

Follow-up to the core score-cards + Activity overhaul (v1.204.0, `docs/overview/entries/2026-07-22-core-cards-workouts-upgrades-ffp5mg.md`).
Owner reviewed v1.204.0 on-device (screenshots) and gave two pieces of concrete feedback, both
implemented and shipped this round.

**1. Card visual — "too plain," remove the band word.** The v1.204.0 white-bordered circle was
replaced with a bolder SVG **progress ring**: a faint track + a coloured arc that fills to the
score (or, for the non-0–100 Heart Rate card, a tier-based fill — low/steady/elevated/high — so it
stays visually consistent without fabricating a fake percentage on a raw bpm value). The visible
band word (MODERATE/HIGH/etc.) was dropped per the owner's ask — state now reads from the arc fill +
a small coloured dot only. The word is preserved in the button's `aria-label` so the state is still
programmatically available (screen readers), keeping the "never convey state by colour alone" rule
satisfied via the arc-length + icon + dot combination. `components/oura-score-chip-row.tsx` rewritten.

**2. Activity detail screen — "no details, needs gauges like the other cards."** Investigation found
two real, pre-existing gaps, not just missing UI:
- `activityContributors` on `/api/readiness-score` was wired to `ouraToday?.activityContributors` —
  the frozen-since-re-key Oura Cloud field, always `null`. The Activity detail's generic
  `ContributorChart`/`ContributorDetails` (the same shared components Readiness/Sleep already use for
  their rich "what drives this + how to improve it" sections) were therefore silently empty. Fixed by
  falling back to `activityResult.components` (the Activity Score v2 own sub-scores) — the same
  precedence pattern `sleepContributors` already used. Added 6 new guide entries
  (`lib/health/contributor-guide.ts`) and labels (`lib/oura/contributors.ts`) for the new component
  keys (`steps`, `activeEnergy`, `zoneMinutes`, `moveHours`, `strengthFreq`, `strengthVolume`) so the
  existing deep-dive UI renders real "what it measures / measured against / how to improve it" content
  instead of falling back to raw key names.
- The `/api/ai/health-insight` activity section had the same bug: it read `todayOura?.activityScore`/
  `activeCalories`/`activityContributors` (all frozen `null`), so the AI insight always opened with
  "Your activity data is currently missing" even when the real score was showing e.g. 74/HIGH on the
  home card — an owner-visible, actively misleading AI response. Rewired to assemble the same
  goal-anchored inputs the readiness route uses (profile → `getDailyGoals`, 7-day workout window →
  `computeActivityScore`) so the model gets real steps/active-energy/training numbers.
- Added a new goals-vs-actual gauge card to `app/health/activity/activity-content.tsx` (reusing the
  shared `MetricScale` component, the same "gauge" primitive Sleep/Heart-Rate detail already use — no
  new gauge component invented): Steps and Active energy vs today's goal (hidden together when neither
  has data today — verified via screenshot after an initial version left an orphaned header), Sessions
  and Volume vs the rolling-7-day goal (always shown — these are never null), and an amber
  "eased back today" note when the over-exertion taper is active.
- New response fields on `/api/readiness-score`: `activityGoals`, `activitySignals`,
  `activityTaperApplied` (the raw inputs the gauges render from).

**Verification:** `tsc` clean, lint clean, full suite **1910 passing** (2 new: a `formatContributors`
label test, plus the existing suite re-verified against all changes). **Playwright screenshot
verification in the dev sandbox** (installed standalone via `npx`, not added to the project's
dependencies — pre-installed Chromium binary, no project footprint): confirmed against the seeded
`test@local.dev` user — (a) the four rings render with proportional arcs, a colour dot, and **no visible
band-word text**; (b) the Activity detail screen's contributor chart + deep-dive guide render real
content (Training volume 33/100, Training frequency 49/100, each with a `ZoneGauge` + "how to improve
it" bullets); (c) the new goals-vs-actual gauge card renders (Sessions 1/3, Volume 1440/4320 kg); (d)
the AI insight now cites the real goal ("target of three strength sessions per week") instead of
"missing" — confirmed via a forced (`force:true`) real Gemini call. One rendering caveat found and
noted, not a regression: the home hero's dynamic weather background doesn't render in this sandbox
(`useWeather()` has no network path here), so the white ring/icon/number were checked against a plain
white fallback background rather than the app's real blue-gradient hero — the ring/dot/no-text
behaviour was still clearly visible and correct; the on-device look (white-on-gradient, already
confirmed working by the owner's own v1.204.0 screenshots) still wants a fresh on-device check for this
round's ring redesign specifically.

**Not verified (device-gated, unchanged from round 1):** Samsung-WebView paint of the new ring at the
real S25 width/safe-area, and real-ring-data scores. The W-B device lanes (zone-minutes,
move-every-hour, yesterday-completed home display) remain open, unchanged by this round.
