## UI responsiveness fixes — A2 (v1.197.1, 2026-07-21)

The three Category-2/3 offenders the A1 audit found (`docs/reviews/2026-07-21-ui-responsiveness-audit.md`)
that survived the W1–W7 batch. Small, file-disjoint render fixes.

- **A1-1 (Category 2) — `AiInsightCard` full-card spinner on every Health detail open**
  (`components/health/ai-insight-card.tsx`). It seeded from `getCached` (**async**), which always
  misses the first frame, so `loading` started true and a full-card `Loader2` + `animate-pulse`
  skeleton flashed on every open of all four detail screens (readiness/sleep/heart-rate/activity).
  Now seeds synchronously from `readCacheSync` in the mount effect and drops the spinner entirely —
  a repeat open paints the cached insight instantly, and while a first-ever insight loads the card
  renders nothing (it's supplementary, not load-bearing) instead of a skeleton. A refresh keeps the
  old insight visible until the new one lands.
- **A1-2 (Category 3) — `TimeInZoneCard` dragged chart.js into the Health initial bundle**
  (`app/health/health-sections.tsx`). It was the lone health chart statically imported (every sibling
  is already `next/dynamic({ssr:false})`); now lazy-loaded to match, keeping chart.js out of the
  Health screen's initial JS.
- **A1-3 (Category 3) — `TrendChart` animated skeleton over already-seeded data**
  (`components/health/trends-section.tsx`). The parent seeds its data synchronously, so the dynamic
  chart's animated `loading:` skeleton flashed over data already in hand while chart.js downloaded —
  the exact contradiction `trend-sparkline-lazy.tsx:16` was fixed for. Swapped for a static
  fixed-height placeholder.

A1-4 (`LatestBaselineCard` web-branch seed) was left as opportunistic — it's mitigated on the APK
(the primary path reads the local store) and the web branch is a dev/QA surface only.

**Verification:** `tsc` clean (only the pre-existing `onnxruntime-web` sandbox errors), lint 0 errors,
`/health` + `/health/readiness` serve 200 on the dev server with the changes. **NOT verified:** the
actual perceived paint improvement is a render-timing change invisible to sandbox SSR — it needs an
S25 eyeball (open a Health detail screen twice: the AI insight should not flash a spinner the second
time; the Health tab should open without a chart.js hitch). Pure render/bundling change — the same
data renders, only *when* the JS loads and *whether* a skeleton shows changed.
