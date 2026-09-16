# 2026-09-16 — `feat/bf5-week-in-review-page`

**BF-5 PR 2b** — the week in review is a page, not a banner that expands. v1.457.0.

Owner, 2026-08-23: *"rather than chevron type display; id rathee its own page that you can get to
from a banner notifcation; or a permanent link in the health tab somewhere - the page shohld be more
indepth; kinda like the training calendar entry; but for the whole week. so it can visually compare
the week based on the metrics its talking about."*

PR 2a (2026-09-15) made `/api/weekly-digest` return the metrics it used to flatten into a prompt and
throw away, on the cached path as well as the fresh one. This is the surface half.

## What shipped

- **`app/health/week/`** as `page.tsx` + `week-detail-content.tsx`, beside `app/health/day/` — the
  shape the owner named.
- **The week drawn, not described.** `WeekVolumeChart` (tonnage per day, a rest day as a real zero
  rather than a gap) and `WeekMetricCard` (readiness, sleep score, sleep hours, HRV, high-stress
  minutes — each the week-over-week pair the paragraph states, over the seven daily readings that
  average to it). Both `react-chartjs-2`, per the plan; nothing hand-rolled.
- **Reused rather than rebuilt:** `WeeklyMuscleSetsCard` for muscle volume, and `WeekTrendsSection`
  (Q-112e) for the month around the week — it answers a different question from this page's own
  metrics, five *weekly* points against the four completed weeks before them, so it moves here
  rather than being dropped or duplicated.
- **The banner becomes the entry point.** A tap opens the page; the once-per-week fetch, the
  `localStorage` dismissal and the error state all stay, because they are what make it a banner.
- **A permanent Health entry** (`weekInReview` in `TRAINING_ORDER`, beside the calendar). The banner
  is dismissible and fires once a week, so a page reachable only from it is unreachable for the rest
  of the week — and permanently so for anyone who dismissed it.
- **The reminder lands on the page** (`/health/week`) instead of Home with a param.

## Two of the plan's own PR-2b instructions did not survive contact

Both for one reason, found by reading the route before building against it: **`/api/weekly-digest`
computes the recap week itself and reads nothing from the body but `force`.**

1. **The plan suggested keeping a query param so `reminder-deep-links.test.ts` could stay as-is** —
   *"the cheaper option that keeps the test as-is: keep a param the page reads."* That param would
   have been a control the route cannot honour: the exact "valid link that does nothing" that test
   was written to catch. Inventing one to satisfy the test would have been the tail wagging the dog.

   **The test was generalised instead.** A query-less row asserts what actually makes a route land
   somewhere real: it has its own `page.tsx`, **and it is not a tab href** — read from `TABS`, so
   adding a tab cannot quietly approve a reminder that lands on it. That second half is the original
   failure restated: `/` was wrong because it opens a tab and leaves the user to find a banner, and
   so would `/nutrition` be. Query-bearing rows keep their assertion unchanged. Proven load-bearing
   by pointing the reminder at `/nutrition` and watching it go red.

2. **The page therefore takes no `?week=`.** I had written one in before checking the route. Removing
   it also keeps the plan's §6 — *"an arbitrary past week is a real query-range change and its own
   entry"* — true rather than half-implemented behind a parameter that silently did nothing.

## The stray trailing `*` was neither a metrics problem nor this page's

`Response`'s `parseIncompleteMarkdown` is a **streaming** repair: it counts single asterisks and
appends a closing one when the count is odd. That is right mid-stream and wrong for a string that is
already finished, where an unterminated `*` is text the model wrote.

The prop already existed and defaults to `true`, so the fix is to pass `false` where the string is
complete. **Sibling-surface sweep:** the weekly digest (this page) and the daily digest card are both
finished strings; the coach's transcript genuinely streams and keeps the default. `DismissibleBanner`'s
unused `href` prop gained a comment rather than a change — it renders a bare `<a>`, which inside the
WebView reloads the app and discards every mounted tab, so the banner navigates via the transition
router.

## What was verified, and what was not

- `components/health/week/__tests__/bf5-week-in-review-page.test.ts` — **10 of 13 assertions fail
  against `main`**. The three that pass on both sides are deliberate preservation pins: the
  once-per-week fetch, the dismissal, and the banner's error state. Stated rather than counted.
- `e2e/bf5-week-in-review-page.spec.ts` — **3 passed** in the browser: the failure path (which is
  what a harness run actually reaches, since `/api/weekly-digest` 5xxs here without an LLM key), the
  render against a stubbed payload, and the Health entry point navigating. The stub proves the page
  draws what it is given and says nothing about the route computing it — PR 2a owns that half, and
  the spec says so.
- `card-429-error-state.spec.ts` and `tabs-instant-paint.spec.ts` — **passed unchanged**, which is
  the check that the banner is still a banner: it still fails loudly and still POSTs on Home mount.
- `reminder-deep-links.test.ts` — 7 passed, with the generalised branch proven red.
- Full suite **7526 passed**, `pnpm check:rules` **Ran 75 of 75**, lint 0 errors, build clean.

**NOT exercised: the device, and specifically the notification.** No harness run can fire a
Capacitor local notification, so that the reminder actually lands on `/health/week` is settled only
on the S25. Also unexercised: safe-area insets under the page's scroll container, Samsung WebView
canvas rendering for the two charts at 412 dp, native SQLite, and drifted production data — the
charts were driven from a synthetic fixture, so a real week's shape (long muscle names, many PRs,
a week with no readings at all) has not been seen. BF-5 carries `Verify: device`; Q-112e's own
`Keep:` was rewritten, because it pointed the owner at a banner expansion that no longer exists.
