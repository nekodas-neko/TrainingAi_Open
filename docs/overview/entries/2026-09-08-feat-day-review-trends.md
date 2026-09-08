## 2026-09-08 — The day review draws its week (Q-112d)

**Branch:** `feat/day-review-trends` · **Lane B**

### What shipped

Step 1 of the End of Day wrap-up gains **Against the last week**: resting heart rate, steps, session
volume and weight, each with an eight-point sparkline and a sentence saying how far today sits from
the seven-day mean.

- **`components/nutrition/end-of-day/day-trends.ts`** — every display decision as a pure function, so
  the judgements are testable without a DOM (both vitest projects run in `node`). `trendDelta`,
  `deltaSentence`, `trendSeries`, `trendRows`, and `TREND_SPECS`.
- **`components/nutrition/end-of-day/day-trends-section.tsx`** — the render. A child of
  `SheetContent`, not a hook in `EndOfDayReview`, for the reason `DayReadThroughSection` already is:
  that component is rendered unconditionally by `nutrition-content` and `open` only drives Radix, so
  a hook in its body would fetch on every Nutrition visit.
- **`DAY_REVIEW_WEEK_WINDOW_TTL`** in `packages/shared/src/cache-ttl.ts`, and
  `day-review-week-window:` registered in `invalidateWorkoutSummaries`, `invalidateOuraSync` and
  `invalidateBodyMetricWrite` — the three groups whose writes move any of the four stats.

Consumes `/api/day-review/week-window`, which Q-112c shipped and nothing had called until now.

### Three decisions worth not re-litigating

**No valence colouring.** Three of the four stats have no fixed good direction — session volume is
*meant* to fall in a deload, and body weight rising is the point of a `build_muscle` goal and the
problem under `lose_weight`. Only resting heart rate reads one way, and colouring one row by valence
while three are neutral teaches that the colours mean nothing. Each stat keeps an identifying colour;
direction is carried by an arrow **and** a word, which is also what the colour-only-state rule wants.

**A stat with no reading anywhere in eight days is omitted; a stat with history but nothing today
keeps its row.** A permanently blank row is worse than an absent one, but a gap in a week that has
data is itself worth seeing. Confirmed live: the local seed has weight only, and exactly one row drew.

**`trendDelta` returns `null` when either side is missing.** "No reading today" and "exactly the
week's average" are different statements, and flattening a null to 0 renders them identically. The
test for this is the one a `0` default would pass.

### Two defects the screenshot caught and the tests could not

Rendered at 412 dp against `pnpm dev`, which found both:
- **"No reading today" was styled as a value** — coloured and semibold, like an actual reading, and
  it wrapped to three lines. An absence is now muted and regular weight.
- **A two-column grid was wrong at this width.** ~170 px cards could not hold a label, a value and a
  sparkline side by side, and with a single visible row half the grid sat empty. One column now.

### Verification

- `pnpm check:rules` — **Ran 70 of 70**. `tsc --noEmit` clean · `pnpm build` exit 0 ·
  `check-test-typecheck` at baseline · `check-component-size` clean · full unit suite green.
- **12 unit tests, mutation-checked three ways**: flattening a missing reading to `level` fails two;
  re-averaging the eight points the row was handed (instead of using the route's today-excluding
  mean) fails one; closing the gaps in a sparse series fails one.
- **One new e2e case**, written against the *request* rather than the rendered rows: the Nutrition
  tab must issue no `week-window` request, and opening the wrap-up must issue one. Whether any row
  draws depends on the seed; whether the fetch is gated on the sheet does not. It passes.

### Also found — the route-coverage ratchet is overstated by 15

`pnpm check:rules` failed on `check-route-test-coverage`, saying the count had *dropped* by one. The
route that came off is `day-review/week-window`, and it came off because this PR's unit test imports
its response **type** — an import that tests nothing. The route already had a real handler test, in
`app/api/day-review/week-window/__tests__/`, which the check could not see: it loads the handler as
`await import('../route')`, and the check asks whether any test file contains the substring
`app/api/<route>/route`, which a relative specifier never produces.

Measured rather than assumed: **15 of the 141 routes on that list have a co-located test importing
the handler relatively** — `sync/push`, `sync/pull`, `next-session`, `user/goals` and eleven others.
The real debt is nearer 126. `BASELINE` is lowered to 141 as the check demands, and both the script
comment and **PS-39** now carry the measurement and the named fifteen, because a list asserting that
`sync/push` is untested is a list somebody will act on.

*(`scripts/**` is Lane A. A one-constant ratchet update that the failing check itself instructs the
PR to make is the same class of crossing as a doc-size baseline; the fix to the matching rule is
left to Lane A, written up on PS-39.)*

### Not exercised, and two things checked that turned out not to be defects

**Not exercised:** the APK. This is a WebView-rendered surface, so a Railway deploy carries it with
no rebuild, but it was confirmed at the S25 *viewport*, not on the S25.

**A tap on Nutrition's "End of Day" button did not open the sheet** in a hand-rolled Playwright
context — six attempts. It reproduced on unmodified `main`, and then a probe showed **zero** click
events reaching *any* button on the screen, "Add food" included, while a programmatic
`element.click()` worked. That is the emulated context, not the app: the e2e harness taps buttons on
this screen every run. Nothing filed, because there is nothing there.

**`the wrap-up shows the day it is wrapping up` fails locally when its file is run alone** — also on
unmodified `main`. That is the isolation-versus-full-run entanglement LB-56 already records from the
2026-09-04 shard experiment, not a regression.

Minor bump — a new surface.
