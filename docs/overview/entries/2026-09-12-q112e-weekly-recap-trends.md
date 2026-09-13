# 2026-09-12 — Q-112e: the weekly recap gets its numbers, by widening the day review rather than copying it

**Branch:** `feat/q112e-weekly-recap-trends` · **Lane B** · `components/week-trends-section.tsx`
(new), `components/nutrition/end-of-day/day-trends.ts`, `…/day-trends-section.tsx`,
`components/weekly-recap-banner.tsx`.

The recap said its piece in prose and showed none of the numbers it was talking about. The daily
review has had four trend rows since Q-112d; the weekly one was *"deliberately last, so the daily
version settles the layout first"*, then sat blocked on an engine half that LB-64 shipped on
2026-09-09. This is the half that was waiting.

## Widened, not forked

The two routes serve the same shape under different names — `days`/`sevenDayAverages` against
`weeks`/`priorAverages` — and the arithmetic between them is identical. A second copy of a formula
is a bug by definition in this repo, so the day review's module took a window instead of a response:

```ts
export interface TrendWindow { points: TrendPoint[]; priorAverages: TrendPoint }
export function trendRowsFor(window: TrendWindow): TrendRow[]
export function trendRows(data: WeekWindowResponse) =           // the daily caller, unchanged
  trendRowsFor({ points: data.days, priorAverages: data.sevenDayAverages })
```

`TrendRowCard` moved from private to exported and took three optional props. Everything that
genuinely differs between a day and a week is now named at the call site rather than branched on
inside: the sparkline domain (`TREND_WEEK_TIME_DOMAIN` `[0,4]` against the daily `[0,7]` — sharing
one would squash five weekly points into the left five-eighths of the chart), the phrase a delta is
measured against, and what to call a missing reading.

`trendSeries` also stopped taking `WeekWindowDay` and started taking a structural `TrendPoint`. The
`date` field it was carrying was never read by the maths, and it was the only thing making the
function daily.

## The route, and the one it is not

`GET /api/weekly-review/month-window`, not `/api/weekly-digest`. The digest computes these numbers
and throws them away, which makes widening it look cheaper — but it is a POST that runs an LLM,
rate-limited and cached as prose, and a chart wants freshness on a different clock from a paragraph.
LB-64's route note already argued this; the client half now honours it.

`useCachedValue`, not a fetch-once effect, because this renders inside Home — the persistent tab
shell, where `useEffect(…, [])` holds its first payload until the app is killed (Q-402) — and with
an `onError`, because `cachedFetch` swallows `!res.ok` including the route's own 429 (Q-499).

**The request only fires when the banner is opened, and that was checked rather than assumed:**
`dismissible-banner.tsx:81` renders children behind `expandable && expanded && children`, so the
section does not mount on a collapsed banner.

## Verification

Driven against the running app with **only the LLM half stubbed** — the trends read the real route
against the real database, because stubbing the half under test would prove nothing:

```
month-window status: 200
weeks: [… 2026-08-03 … 2026-08-31]   priorAverages: {rhr 58, steps 8550, volume 3240, weight 82.06}
rows: ["No reading this week", "↓ 8,550 below the last 4 weeks",
       "No reading this week", "↓ 0.3 kg below the last 4 weeks"]
sparklines drawn: 4
```

The arithmetic checks by hand: weight 81.767 against a prior mean of 82.061 is −0.294, printed at
the delta's one decimal as **0.3 kg below**. Resting heart rate and session volume have no reading
in the reported week and say so instead of drawing a gap as zero. Rendered at 412×915 and read back
from the DOM.

**Mutation-tested.** Making `trendRowsFor` read `points[0]` instead of the last point — the mistake
this window invites, since five ascending points look nothing like eight — fails **6** of the 19
tests, three of them the new weekly ones. One mutation breaking both surfaces is what "shared, not
forked" is supposed to mean.

`pnpm check:rules` **Ran 74 of 74** · `tsc --noEmit` and `eslint` clean · `pnpm test` **890 files /
8418 tests / 0 failed** by real exit code with `DATABASE_URL` set · `pnpm build` exit 0.

## Not exercised

The S25. This is a 412 dp harness measurement, not glass, and the recap is a banner on Home whose
expanded body now grows by four cards — worth a look on the phone. Carried as the entry's `Keep:`.

The weekly digest's own prose path was **stubbed**, so nothing here says the LLM route still works;
it was untouched and is covered by its own tests.

## One thing left for Lane A

The new cache key `weekly-review-month-window:` uses the shared `TTL_MEDIUM` tier rather than a
named constant. A named one belongs in `packages/shared/src/cache-ttl.ts` beside
`DAY_REVIEW_WEEK_WINDOW_TTL`, and that file is Lane A's. With one call site there is no divergence
for `check-cache-ttl-divergence.js` to find; the day a second site reads this key, promote it.
