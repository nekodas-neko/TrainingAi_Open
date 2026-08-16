# UI Responsiveness Audit — 2026-07-21

**Scope:** Workstream A1 of the app-responsiveness + AI-optimization initiative. Walk the
main nav paths at the S25 viewport (≤640px) and classify every transition that shows a
loading state, so the fixes (A2) can be prioritized against real offenders rather than guesses.

**Method:** static code-mapping sweep of the five nav tabs (Home, Health, Workout, Nutrition,
More) and the Health detail screens, tracing each card's fetch/seed path to first paint. No
on-device timing this session (the web sandbox renders `getLocalStore` as null and safe-area
insets as 0 — perceived-smoothness deltas are S25-only; flagged per the Canonical Runtime rule).

## The classification (per the mission brief)

Most of the app is already local-first (workout logs, food, supplements, body metrics, mood,
activity read from on-device SQLite), so remaining loading is **not** a "move it local" problem.
Every loading state falls into one of three causes, and the fix differs by category:

1. **Cold-cache / post-invalidation flash** — a screen not seeding synchronously from cache on
   mount (`readCacheSync` in a `useEffect`, never a `useState` lazy initializer).
2. **Embedded server-only aggregate blocks paint** — an otherwise-instant screen blocking its
   paint (or flashing a full-card skeleton) on a cross-history server route (weekly-stats,
   muscle-recovery, weights-summary, training-load, or an AI-generated card). These are
   server-computed **by design** — the fix is to make them non-blocking (render the rest
   immediately; the card seeds-then-revalidates), **not** to move them local.
3. **Bundle / render latency** — heavy components (charts, markdown/KaTeX, AI overlay) loading
   JS on open. Looks like loading but isn't network — fix with `next/dynamic({ ssr:false })`.

## Prior art — what is already fixed (do not re-tread)

The **2026-07-20 wiring & caching-perf audit** (`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`,
batch W1–W7) already shipped fixes for the **Category-1 cache-staleness class** (supplements
date-guard, `achievements:` invalidation, `BODY_BATTERY_TTL`) and the **render-rerender class**
(workout hot-path leaves, `useLayoutEffect` seed migration for friend-leaderboard / friend-feed /
heart-rate / profile-tab achievements, stable `clientId` keys). Re-verification for this audit found
**no remaining Category-1 offenders** on the walked paths: the tab-level screens (Home
`session-select-content.tsx`, Health `health-content.tsx`) seed every child card synchronously from
`readCacheSync`/`readTodayCacheSync` before first paint, and the home cold-start skeleton
(`session-select-content.tsx:944/1020`) only shows on a genuinely empty cache, not over seeded content.

This audit therefore reports the **Category-2 and Category-3 offenders that survived** W1–W7.

## Findings — ranked by owner-hit frequency

### A1-1 · `AiInsightCard` flashes a full-card spinner on every Health detail open — **Category 2** (HIGH)

`components/health/ai-insight-card.tsx`

- **Root cause:** the card seeds from `getCached` (**async**, `:20`) rather than `readCacheSync`
  (synchronous). An async cache read always misses the first render frame, so `loading` starts
  `true` (`:14`) and the card renders a **full-card `Loader2` + two `animate-pulse` bars** (`:45–56`)
  on **every** mount — even when the insight is already cached and about to be served one tick later.
- **What it blocks on:** `POST /api/ai/health-insight` (`:26`) — an AI cross-history route (the
  `health-insight` aggregate). The route caches server-side (`ai_health_insights`) and the card
  caches client-side for ~6h (`:35`), so the *network* cost is usually nil — but the paint still
  flashes because the seed is async.
- **Where the owner hits it:** embedded on **all four** Health detail screens —
  `app/health/heart-rate/page.tsx:163`, and `components/health/health-score-detail.tsx:246` which
  backs **readiness** (`app/health/readiness/readiness-content.tsx:8`), **sleep**
  (`app/health/sleep/sleep-content.tsx:53`), and **activity** (`app/health/activity/activity-content.tsx:7`).
  The detail screens themselves paint instantly (they seed their score/trends synchronously) — this
  card is the one thing that flashes. Highest frequency because it recurs on four separate screens.
- **A↔B connective tissue:** this is a self-fetching **AI** card. It re-fetches on every
  `[section, date]` change (`:43`) and its client cache is a bare async `getCached`, so it is also a
  **Workstream-B double-trip candidate** — once B1 instrumentation lands, confirm from `ai_call_log`
  whether tab-switching between detail screens fires `health-insight` more than once per section/day.
- **Fix (A2):** seed synchronously via `readCacheSync` in the mount effect and drop the full-card
  spinner in favor of render-nothing-until-loaded (the card already returns `null` when there's no
  insight, `:68`) or a seed-then-revalidate paint. Do **not** add a `loading:` skeleton back.

### A1-2 · `TimeInZoneCard` drags chart.js into the Health initial bundle — **Category 3** (MEDIUM)

`components/health/time-in-zone-card.tsx:4–11,20` · rendered via `app/health/health-sections.tsx:12,637`

- **Root cause:** the file **statically** imports `chart.js` (`:4–10`), `react-chartjs-2`'s `Bar`
  (`:11`), and calls `ChartJS.register(...)` at module-eval (`:20`) — and is itself **statically
  imported** into `health-sections.tsx:12`. So chart.js is pulled into the Health screen's initial JS
  chunk on every Health→Body ("Heart & recovery") load, even though the card only draws when
  `totalSec > 0`. It is *not* a Category-2 problem — it correctly seeds via `readCacheSync` (`:58`).
- **Every other health chart is already `next/dynamic({ ssr:false })`** — `trend-chart.tsx`,
  `hr-day-chart.tsx`, `trend-sparkline.tsx`, `workout-load-comparison-chart.tsx`,
  `weekly-nutrition-chart.tsx`. `TimeInZoneCard` is the lone static leak.
- **Fix (A2):** import `TimeInZoneCard` via `next/dynamic({ ssr:false })` in `health-sections.tsx`,
  matching its siblings, so chart.js stays out of the Health screen's initial bundle.

### A1-3 · `TrendChart` shows an animated skeleton over already-seeded data — **Category 3 contradiction** (LOW/MEDIUM)

`components/health/trends-section.tsx:11–14,53`

- **Root cause:** `TrendChart` is `next/dynamic({ ssr:false, loading: () => <animate-pulse skeleton> })`
  (`:13`), but the parent card **seeds its data synchronously** from `readCacheSync` (`:53`). With the
  data already in hand, the chart area still shows a pulsing skeleton while the chart.js chunk
  downloads — a `loading:`-skeleton-on-a-seeded-card contradiction (banned by the CLAUDE.md
  "Instant paint" rule). The sibling wrapper `components/health/trend-sparkline-lazy.tsx:16` was
  already fixed for exactly this (it uses a **static**, non-animated `h-[152px]` placeholder — see
  its A-10 comment at `:11–15`).
- **Where:** Health→Progress tab (`health-sections.tsx:714`).
- **Fix (A2):** swap `TrendChart`'s animated `loading:` skeleton for a static fixed-height
  placeholder, matching `trend-sparkline-lazy.tsx:16`.

### A1-4 · `LatestBaselineCard` web-only branch has no sync seed — **Category 2** (borderline / LOW)

`components/fitness-tests/latest-baseline-card.tsx:24–27,47–48` · rendered `health-sections.tsx:643`

- The web-only branch uses `cachedFetch` with no `readCacheSync` seed and shows an `animate-pulse`
  value skeleton (`:48`). **Mitigated**: the primary APK path (`:18–22`) reads the on-device store
  (local, fast) and `fitness-tests` is not a cross-history aggregate. Flagged for completeness only —
  the web branch is a dev/QA surface per the Canonical Runtime policy, so this is low priority.

## Not offenders (verified — no action)

- **Category-2 cards that correctly seed-then-revalidate** via `readCacheSync`:
  `AiPeriodizationStatusCard`, `AiWeeklyVolumeCard`, `TrendsSection` (data), `TimeInZoneCard` (data),
  `ObservedHrCard`, `StrengthProgressCard`, `ActivityHistoryCard`, `WeeklyMuscleSetsCard`.
- **Cards whose skeleton is gated on parent-seeded props** (parent seeds in `health-content.tsx:226–256`
  / `session-select-content.tsx:239–334`): `TrainingLoadCard`, `WeeklyStatsHub`, `StrengthTrendCard`,
  `SleepCard`, `RhrHrvSpo2Card`, `InjuryCard`, `BodyBatteryCard`.
- **Heavy libs already `next/dynamic`:** react-markdown/KaTeX (`components/ai/response.tsx`) loads only
  via `next/dynamic` (ai-chat-overlay, chat, day-review-sheet, weekly-recap-banner); the AI chat overlay
  itself is dynamic in both `session-select-content.tsx:19` and nutrition's `EndOfDayReview`. No static
  path into a top-level screen. `components/ui/sparkline.tsx` and `contributor-chart.tsx` are pure
  SVG/HTML (no chart.js) — the many Body-tab sparklines do NOT drag chart.js in.

## Prioritized fix plan (→ A2)

| # | Fix | Category | Priority | File |
|---|-----|----------|----------|------|
| A1-1 | `AiInsightCard`: sync `readCacheSync` seed + drop full-card spinner | 2 | HIGH | `components/health/ai-insight-card.tsx` |
| A1-2 | `TimeInZoneCard`: static chart.js import → `next/dynamic({ssr:false})` | 3 | MEDIUM | `app/health/health-sections.tsx` |
| A1-3 | `TrendChart`: animated `loading:` skeleton → static placeholder | 3 | LOW/MED | `components/health/trends-section.tsx` |
| A1-4 | `LatestBaselineCard` web branch sync seed (opportunistic) | 2 | LOW | `components/fitness-tests/latest-baseline-card.tsx` |

A1-1/A1-2/A1-3 are file-disjoint and small; they are batched into a single A2 fix PR (see the
backlog entry). A1-4 is opportunistic (web/QA surface only). No large refactor is implied — the app's
render/cache discipline is already strong post-W1–W7; these are the residual leaks.
