# 2026-09-09 — the two reads that draw a conclusion (PS-39, 45 → 43)

**Branch:** `test/cardio-sleep-analysis-routes` · **No product change.**

13 cases over `guided-walk/segment-stats` and `sleep-performance-correlation` — the routes that take
months of rows and reduce them to something the app then *states* to the owner. That is the class
where a quiet aggregation bug is least visible, because the answer is always a plausible-looking
number.

Both carry a documented past defect, and each is a case here:

- **Treadmill interval walks count (Q-66).** Same workout, indoors. The fixture pairs an outdoor
  walk at 120 bpm with a treadmill one at 140, so dropping `'treadmill'` from the filter moves the
  average visibly — with outdoor logs alone it would change nothing.
- **Nights, not rows (Q-76).** A 0.1 h evening bout sharing a date with the 7.6 h night that
  followed it. A raw last-write-wins pass put 21% of this correlation's x-values on non-nights. The
  nap is listed *before* its night on one day and *after* it on another, so neither ordering passes
  by luck.
- **One observation per DAY (PS-29).** Points from one day share their `x` exactly, so counting them
  separately inflates `n` in the direction that manufactures significance.

The shared statistics are deliberately **not** mocked — `nightSessions`,
`buildExercise1rmBaseline`, `sessionMean1RmPct`, `bucketize` and `correlationInsight` all run for
real. Mocking them would leave only the plumbing under test, and none of the three defects lived in
the plumbing.

## The PS-29 case did not test PS-29, and the mutation pass is what said so

The first draft used twelve days of **three lifts each** and asserted `n = 12`. That reads like a
test of the rule and is not: `sessionMean1RmPct` already averages within a session, so with one
session per day the day-merge is a no-op. Deleting it changed nothing and the mutation survived.
Two more survived beside it — a day with nothing comparable, and a day with no sleep behind it —
because no fixture contained either.

Rebuilt so that **`n` is the assertion and four different mistakes each move it**: twelve real days,
plus a second session on one of them, plus a workout day with no sleep, plus a day whose only lift
appears once and therefore has no baseline. All three previously-surviving mutations now fail, as
does a fourth written to reproduce the original per-lift shape directly.

This is the fixture trap again, in its sixth form this sweep: **a fixture in which the wrong rule
and the right rule agree tests neither.** Here the two rules were "aggregate by session" and
"aggregate by day", which coincide exactly when every day has one session.

## Also pinned

- The walk read is a ~3-year window ending at the **user's** today, and a failed history read
  answers empty stats rather than a 500 — the card is one panel among many.
- The correlation hands two different date shapes to two repositories from one window (a `Date` for
  workouts, ISO day strings for sleep), which is where a copy-paste puts the wrong one in the wrong
  call.
- `bucketize` returns only buckets that caught a point, so an absent label *is* a count of zero and
  an empty history returns `[]` rather than four zeroes.

## Mutation pass

**16 of 17 caught.** The survivor is an equivalent mutant planted as a control — a no-op TypeScript
cast.

## Not exercised

The repository is mocked, so neither route runs against a database. No device, no native, safe-area,
gesture or notification surface.
