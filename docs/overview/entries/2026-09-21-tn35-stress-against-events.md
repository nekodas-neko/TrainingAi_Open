# 2026-09-21 — TN-35's overlay: reading the day's stress against what he was doing

**Lane B** · `feat/tn35-stress-against-events` · **v1.462.0**

## How this came to be startable

TN-35 was parked on `Needs: TN-3b` — *"do not build the join before the axis exists"*. The axis
existed twice over by this point, but TN-3b stays in the queue for a `Keep:`, and `Needs:` clears
only when its target *leaves*. So a satisfied dependency went on blocking.

That was filed as #1362 rather than edited away: unparking your own next item is how a queue stops
being a queue. **The owner then said to continue with the backlog, which is the authorisation this
build ran on.** The structural question — whether `Needs:` should clear on buildable work, or
whether a residue-only entry should stop counting as a blocker — is still open and still the
Orchestrator's. This entry shipping is not an answer to it.

## What it does

The day screen already rendered TN-3b's stress chart for whatever day you swiped to. It now also
fetches that day's timeline and places the events on the same axis: a thin tick where each one sits
on the clock, and beneath the chart a list of `time · title · level`.

**The negative case is the feature.** Coverage averages 26.6 buckets a day — **13.3 of 24 hours** —
with real multi-hour holes, so events routinely fall where nothing was measured. The entry is
explicit: *"Render that as absent, never as calm."* An event with no bucket within half a
bucket-width prints **`no reading`**, never `0.00`. A zero there would be the single invented number
the owner would act on. The list header carries `N of M with a reading` for the same reason — a
sparse day must not read as an uneventful one.

**No verdict, and none should be added.** Ranking causes needs many marked instances per event type;
one month of one user will not support it, and an automatic *"X stresses you"* is TN-16's shape,
which is parked.

**The `tag` lane is excluded in code.** `oura_tags` holds zero rows and its feed was removed on
2026-08-13. Rendering it would promise a marker mechanism that does not exist.

## Two decisions worth not re-litigating

**Marks in the SVG, labels in HTML.** The chart's viewBox is `0 0 1440 200` with
`preserveAspectRatio="none"` — one unit per minute, stretched to the container. Any text inside it
is drawn horizontally distorted. So the ticks are SVG lines with `vectorEffect="non-scaling-stroke"`
and every label is HTML beneath.

**The cache key is a child of Home's prefix, and that is the important line in the diff.**
`invalidateCache` matches `key LIKE 'prefix%'`, and six write groups in `lib/cache-groups.ts`
already clear `home-day-timeline`. `home-day-timeline:<date>` is therefore cleared by all six for
free. A fresh `day-timeline:` prefix would have been a *second* invalidation contract that every one
of those writers had to remember — and the day one did not, a deleted meal would sit beside a stress
reading looking like data. It also kept the change inside Lane B: adding a group entry means editing
`lib/cache-groups.ts`, which is Lane A's.

`stress-day-timeline-key.test.ts` pins both halves — that the key is a child of the prefix, and that
the groups still clear it *as* a prefix. Either changing alone breaks the guarantee silently, and
missed invalidation is this repo's most repeated bug class.

## Verification

- `components/body-battery/__tests__/stress-at-events.test.ts` — 14 cases, killed by six mutations:
  drop the gap guard · first-match instead of nearest · absence reads as `0` · render the `tag`
  lane · unsorted · a measured zero counted as absent.
- `e2e/tn35-stress-against-events.spec.ts` — drives a **past** day, which is the entry's own pass
  test, and seeds one event inside a measured run and one inside a gap. Proven red with the prop
  unwired, failing at the join assertion.
- Gate: `Ran 75 of 75` Custom Rules · 7841 vitest passed, 0 failed · tsc clean · lint 0 errors ·
  tests-typecheck at baseline · `check-cache-ttl-divergence` and `check-fetch-once-effects` clean.

## Two mistakes, both caught by running things rather than reading them

**The nearest-bucket mutation survived the first draft.** My test claimed to pin "picks the nearest
of two buckets in reach" and could not: buckets are nominally 30 minutes apart and the window is
±15, so at most one is ever in reach and first-match and nearest are indistinguishable. The test now
uses irregular spacing — which is the real case, since a back-filled day is assembled from stored
rows and nothing enforces the interval. **A mutation that survives is the test telling you it is
describing something other than what it claims.**

**The e2e fixture guessed the schema and wrapped the guess in a fallback.** It inserted
`activity_logs.started_at` as a timestamptz; the real column is `start_time time`, and `title` is
NOT NULL. Worse than the guess was the `.catch()` retry I put around it — a second wrong query
standing by to hide the first. Removed. A fixture that cannot insert must fail loudly.

## Not exercised

- **The marker half, which is Lane A's and unbuilt.** A timestamped moment row is a migration.
  Meetings, commutes, arguments, caffeine and screens remain invisible to the app, and they are most
  of what the owner means by "events". This half attributes stress only to training, food, walks and
  sleep.
- **The device look** — a list of the day's events under the chart at 412 px.
- **The pass test itself**, which only the owner can run: open a past day and say whether a stressed
  window matches what he was doing — **or say it does not**, which is an equally valid result and
  the one that would retire the metric.
