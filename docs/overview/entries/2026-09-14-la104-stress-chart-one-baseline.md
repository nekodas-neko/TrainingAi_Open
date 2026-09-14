# 2026-09-14 — the stress chart reads one baseline, and gets a past day to compare against (LA-104)

**Branch:** `feat/stress-chart-stored-series` · **Lane B** · v1.456.0

## What it was

TN-3b (2026-09-13) shipped a 24-hour stress chart on the Body Battery card, fed from
`battery.stress.series` — the **live** series `/api/body-battery` computes from `restingHr` plus a
28-day HRV mean. LB-102 (the same day, Lane A) shipped `GET /api/body-battery/stress-day?date=`,
which serves the **stored** buckets the rollup writes from `latest.rhrLowBpm` + `nightHrvMs`.

Two producers, one metric. `app/api/body-battery/route.ts:349` records what that costs: over the
eight days in production that carried both, **the sign differed on six of them and high-stress
minutes by 4–8×**. TN-3a had already refused to persist the live series for exactly this reason —
*"persisting both would put two numbers behind one metric"*.

So a chart drawing today live and a past day from storage would put two metrics on one axis, in
precisely the dimension the owner's approved pass test compares: *"open a past day, read a stressed
window off the axis, and say whether it matches what you were doing."*

## What shipped

- **`StressDayChart` fetches `/api/body-battery/stress-day` itself** (`useCachedValue`, key
  `stress-day:<YYYY-MM-DD>`, `BODY_BATTERY_TTL`) instead of taking buckets as a prop. Every day,
  today included, comes from storage.
- **It takes an optional `date`**, and is now **mounted on `/health/day`** beneath the read-through,
  swiping with the day. That is not padding: without a past-day surface the entry's pass test could
  not be run, and the one-baseline change would have had no observable effect at all.
- **`throughMs` is printed** — *"Measured through 15:15 — the last reading stored, not the end of
  your day."* This is the honest cost of serving today from storage, and Lane A returned the field
  so the surface could say it rather than imply the day stopped.
- **An error state**, because `cachedFetch` swallows `!res.ok` including the route's own 30/60s rate
  limit, and a card that vanishes reads as "no stress recorded".
- The caption stopped pointing at *"the reading above"* — the strip is only above it on the Home
  card — and names the `High` threshold directly, which is the same word `stress-strip.tsx` uses.

Four e2e tests. The load-bearing one leaves the **live** series full and empties the **stored** day:
the chart must not draw. Before this change it did.

## The finding worth more than the change: `Reference:` had never been documented

LA-104 sat in `next-item.js`'s `REFERENCE — read by other entries, not implemented. Never "next"`
section, carrying an explicit `Lane: B`. The field means *this entry is read, not built*. Lane A had
used it for *"here is supporting reading"*.

Nothing documented it. The only place its meaning was written down was
`check-backlog-pointers.js`, which enforces the *opposite* direction — a prose-only "not
implementable" must carry the field. So the name was all anyone had, and the name invites the other
reading.

**The tell is a printed reason that is a bare link**, where a real one reads as a sentence. Seven
entries have that shape. Three were opened and **all three were work, not reading**:

| Entry | What it actually was |
|---|---|
| `LA-104` | this change |
| `LA-102` | 64 lines of unbuilt Lane B nutrition surface — now READY #3 |
| `TN-28` | unbuilt Lane B card copy — now READY #4 |

Both were sitting under *"never next"* while Lane B's READY list held two items. Same shape as
`Gate: device` on unbuilt work (BF-45) and `Verify:` on unshipped work (OR-105): a field whose name
invites a second reading, and a queue that goes quiet rather than wrong.

The field is now documented in the backlog's fields section, with the misuse and the count. The four
remaining `TN-` entries are **left alone** — a Tuning entry can legitimately be read-only, and
guessing which from outside the lane is how this started — and tracked as **LB-104**.

**This is the fourth instance in two days** of the same class: work that exists but no queue shows,
because a field's meaning was carried in prose. TN-3b's unparking, Q-305's `push:pull` dependency,
LA-104's `Reference:`, now LA-102's and TN-28's.

## Also filed

**LB-105** — `day-review-read-through.spec.ts`'s first test fails on a clean checkout of
`origin/main`, confirmed by stashing and re-running. Probably the local seed (every read-through
section self-hides when empty), which is why the entry's first step is to read CI's E2E job rather
than to patch.

## What was NOT exercised

- **No device.** Home's card and `/health/day` were driven at 412 dp on `pnpm dev` through
  Playwright. Safe-area, the Samsung WebView compositor and native SQLite were not touched.
- **No real stored buckets.** The e2e stubs the route; the dev-server run confirmed the *wire* —
  `GET /api/body-battery/stress-day?date=2026-08-12 200` and `?date=2026-09-14 200` — against a
  local database with no ring data, so the chart rendered nothing there. The drawn output has only
  ever been seen against fixtures.
- **No past day with real data.** Which means the owner's pass test — matching a stressed window to
  what he was doing — is now *possible* and has not been *run*.
