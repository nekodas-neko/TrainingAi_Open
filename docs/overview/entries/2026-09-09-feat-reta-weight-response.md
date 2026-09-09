## 2026-09-09 — Weight response on the vial sheet, and the colour it refuses to show (OR-102b ④, Lane B)

**What shipped.** The reta tracker's fourth part: over the current vial, the weight-change rate, its
95% interval, and the owner's target band — with a coloured chip **only when the whole interval falls
on one side of the band**. Everything else greys out with *"not enough weigh-ins yet"*, and the
number and interval print either way.

**Two corrections to the request, both of which the entry had already made and measured.** The owner
asked for *"weight delta from last weight on injection day to last recorded day"* with a colour.
Across 87 weigh-ins over 118 days the residual SD about the trend is **1.203 kg**, so a two-point
delta carries **±1.70 kg** — more than twice the width of the entire 0.35 kg-wide band. The colour
would be near-random while looking authoritative. So it is a rate with an interval, not a delta. And
the anchor is **the vial, not the last injection**: seven days resolve a rate to about ±1.3 kg/wk,
while a vial is the span over which the dose is actually constant and typically runs two to four
weeks.

**No third estimator.** The rate is `computeWeightRateFit` — LB-67's, which returns
`stdErrKgPerWeek` precisely because this needed the interval rather than the point estimate. Two
kg/week estimators already existed here and one was wrong; a third is the bug class the One Formula
rule exists for. What this module adds is the *decision*: the floors, the t-quantile and the refusal.

**Three guards that each fix a way of being confidently wrong.**
- **1.96 is the wrong multiplier for three readings.** That is the large-sample limit; at one degree
  of freedom the 95% quantile is **12.7**, so 1.96 would report an interval six times too narrow and
  hand out verdicts on three weigh-ins. A small t-table replaces it.
- **A perfectly straight series measured a residual of 1.2e-13**, which passes a `> 0` guard and then
  makes every difference significant by dividing by nothing. A 0.1 kg scale cannot produce a residual
  under ~0.029 kg, so anything below that is degenerate rather than consistent.
- **A residual SD fitted from four points is itself noisy** and routinely comes out too small,
  narrowing the interval exactly when it should be widest. The measured 1.203 kg is a floor below ten
  readings — a floor, not a replacement, so a genuinely noisier series is not talked down to it.

**The web build can only ever show the empty state, and that is filed rather than papered over.**
The card reads `body_metrics` local-first; `getLocalStore` returns null in a browser, and the only
server read of that table, `/api/body-metadata`, hard-codes `metrics.slice(0, 7)` with no range
parameter. So the e2e has to build its fixture inside seven days, where the interval is about ±4
kg/wk and only an absurd loss rate reaches the coloured branch. The rendering is verified; the
realistic case is reachable only on the device. **LB-96** asks Lane A for a bounded range parameter.

**The band is still a constant.** `DEFAULT_BAND_PCT_PER_WEEK` is 0.5–1 %/wk, threaded as a parameter
so a stored value drops in. No such setting exists anywhere — grepped `users`, the goals tables and
the shared types. **LB-97**, Lane A's, since a preference is storage.

**And no recommendation, by design.** Naming a dose is a medical decision and out of scope per this
entry's parent; a 14-day slope resolves to ±1.30 kg/wk against a 0.35 kg band, so a weekly
increase/hold call would flip on water weight while sounding certain.

**A sibling spec of mine did not clean up, and only a repeat run shows it.**
`vial-dose-calculator.spec.ts` (#1007, mine) creates its supplement through the UI and deleted
nothing, so on any database that survives between runs the second run finds two rows called
`Vial E2E` and the trigger locator dies on a strict-mode violation — three had accumulated locally.
CI never showed it because CI gets a fresh database, so the whole cost lands on whoever runs the
suite twice. It now removes what it made, and the pair was run twice in a row to prove it.

**Verification.** 28 unit tests, including the straddle case, the degenerate-series case and the
band scaling with bodyweight. `e2e/reta-weight-response.spec.ts` drives both branches from one
fixture shape, **mutation-checked twice**: committing on the point estimate instead of the interval
fails the withheld case; never committing fails the coloured one. Run together with
`vial-dose-calculator.spec.ts` twice in a row — **5 passed** each time. `pnpm lint` 0 errors,
`npx tsc --noEmit` clean, `pnpm check:rules` **Ran 70 of 70** — which caught a UTC date slice in my
own test fixture, now `shiftDateStr`.

**Not exercised.** The device: the real multi-week window, the `getLocalStore` branch, and whether
the colour reads at a glance on the S25 — the entry's own device check, alongside the calculator's
arithmetic against the owner's third-party app.

**Version.** 1.444.0 — minor; a new part of the tracker.
