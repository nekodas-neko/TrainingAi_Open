## 2026-07-27 — Sleep Score vs how it actually felt (v1.220.0, audit finding Q-16)

Owner decision: *"I want the sleep quality feel to be more something to look back on historically for
tuning rather than affecting the score."* So `day_checkins.sleep_quality_feel` stays **out** of the
Sleep Score, and this builds the place to look back from.

### What shipped

**A calibration view over a window** — `GET /api/admin/sleep-feel-calibration`, rendered as a card at
the top of Admin → Day Review. Per night it pairs the model's Sleep Score with the rating given the
next morning, and over the window reports rank agreement, the range each side actually uses,
mean score per rating, and the nights the two most disagree about.

**The single-day audit now carries it too** — `context.morningCheckin` on `/api/admin/day-review`, so
one day's review reads "scored 91 · you said Terrible" without cross-referencing anything.

### Why the comparisons are rank-based

The two scales are not commensurable. The rating spans its full 1–5 range; the model's observed range
in production is **81–98**. A raw `modelScore − feelAsScore` difference would read as a huge
disagreement on nearly every night and mean nothing. Rank correlation and per-bucket means are
scale-free, so they measure the thing that matters: does the model order nights the way the owner
does? The stored scale (1 = great … 5 = terrible, which the on-screen selector reverses) is converted
in exactly one place, with a test pinning the direction — getting it backwards would invert every
number the view reports.

### What it says about the real data

Run against production (2026-07-03 → 2026-07-27, 24 rated mornings, scores from the live day-review):

| rating | nights | mean Sleep Score | range |
|---|---|---|---|
| Great | 2 | 91.0 | 90–92 |
| Good | 8 | **92.5** | 81–98 |
| OK | 12 | 88.1 | 75–98 |
| Poor | 1 | 92.0 | 92 |
| Terrible | 1 | 76.0 | 76 |

**Spearman +0.42** — agreement in direction, but weak. Three concrete things fall out, and they are
what the view exists to make visible:

1. **Compression.** 22 of 24 nights score 81–98. The worst night the owner has recorded scores 76
   and a great one scores 91 — 15 points apart, while the owner uses the whole scale.
2. **Non-monotonic.** "Good" nights average *higher* (92.5) than "Great" nights (91.0).
3. **A flat contradiction.** 2026-07-21, rated **Poor**, scored **92** — the model's joint-4th-best
   night in the window.

None of this changes a score. It is the target list for whoever tunes the curves.

### A residual of F-1, fixed in the same pass

`computeSleepScore` has **no minimum-duration guard**, so whatever it is handed gets scored. The
F-1 night-selection fix (v1.216.0) wired `nightSessions` into the readiness route, the day audit and
the rollup — but **`lib/health/sleep-trend.ts` and `app/api/weekly-digest/route.ts` still passed raw
sessions**, so a 20-minute nap was scored as a night and dragged the trend ratio and the weekly
average. Both now go through `nightSessions` first.

That trend feeds `signals.sleepScoreTrend` → the AI periodization prompt, so a nap could shift a
prescription. Two regression tests: interleaving naps leaves the trend bit-identical, and three
recent naps no longer collapse it (naive scoring would have given ≈0.06).

### Verification

Full CI-equivalent suite **2,350 passing** (26 new), typecheck, lint and both custom-rule checks
clean. `pnpm dev` against local Postgres with seeded morning check-ins: the route returns correct
buckets/notes/disagreements, and its guards all behave — 180-day range cap, invalid date rejected,
**slash-form `YYYY/MM/DD` accepted** (the date-param rule), 401 unauthenticated. `/admin` renders 200
with the card mounted, and `/api/admin/day-review` returns the new `morningCheckin` block.

**Not exercised — on-device.** Admin-only surface, no native path, but the card has not been seen on
the S25.

### Bookkeeping

- **F-1's queue entry was still in the backlog** despite shipping in v1.216.0 — removed. It had been
  sitting at the top of the queue, so it was also blocking the top-down read.
- **Dependabot standing item checked, below threshold, skipped.** `pnpm audit` now reports **2 high**
  (both `sharp`'s inherited libvips advisory, transitively via `next > sharp`) — a change from the
  2026-07-06 clean result, but under the ≥5 trigger and not critical. Recorded on the item rather
  than fixed: the remedy is a `next` major bump, which this project's own rule says gets its own PR.
