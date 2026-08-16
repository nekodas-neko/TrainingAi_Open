# 2026-08-09 — Body Battery stops guessing its anchor (Q-42)

**Branch:** `refactor/shared-readiness-composite` · **Domain:** `readiness` (also `body`,
`platform`) · **v1.274.1**

## What was wrong

`/api/body-battery` anchors the day's curve on our own derived readiness. That row
(`oura_daily_derived.readiness_score`) only existed once `/api/readiness-score` had run and
persisted it — so the **first** Body Battery read of any day fell back to the sleep score and
painted an anchor marked *provisional*, which then moved once the Health screen was opened. The
owner confirmed on 2026-08-03 that this bothers them.

## None of the entry's three shapes were right

Q-42 described the fix as "one shared function both routes call". Taken literally that means
`/api/body-battery` running `buildReadinessScore` — **~11 repository reads** — on every request, on
a route the sync provider warms at every app open. That was the design problem worth stopping for.

Reading the two routes properly changed the shape:

- The readiness route **already** compute-and-persists (`upsertOuraDailyDerived`, gated on a real
  composite having formed).
- Body Battery **already** prefers that persisted row.
- The formula was never inline anyway — `computeReadinessComposite` has lived in
  `@trainingai/shared/health/readiness-composite` all along. What was inline is the *orchestration*.

So the gap is only the first read of the day, and the fix is compute-and-persist **on demand**, not
compute-on-every-request. The owner chose this over a non-blocking background variant.

## What changed

- `lib/health/readiness-payload.ts` — `buildReadinessPayload` (the old `buildReadinessScore`, body
  moved verbatim; only the `NextResponse.json(...)` wrapper became a plain return) plus
  `ReadinessScoreResponse` and `computeBlendedScore`.
- `app/api/readiness-score/route.ts` — now 31 lines: auth, rate limit, call, wrap, error report. It
  re-exports the payload type, because five call sites already import it from that path.
- `app/api/body-battery/route.ts` — when today's derived readiness is missing *and* no snapshot is
  frozen yet *and* readiness could plausibly compute, call the builder, then **re-read** the
  persisted row.

## The re-read is the important part

My first version used the builder's returned `.score` directly, and it broke all three
`anchor-source.test.ts` cases: with no data the builder still returns a number (5), and I had
turned an honest `default: 50` anchor into a confident-looking wrong one.

The builder persists **only** when it formed a real composite. Re-reading the row therefore takes
exactly the signal the persisted path has always used and adds no new judgement of my own about
what counts as "enough data". Cheap, and it cannot drift from the readiness route's own rule.

There is also a plausibility pre-check (`ouraToday || ownSleepScore != null || bodyMetrics.length`)
so a user with nothing recorded doesn't pay for a builder call that could never persist — which,
without the check, would repeat on *every* read rather than once a day.

## Measured, not assumed

`pnpm dev` against the seeded DB, alternating cold/warm so dev-server drift hits both arms equally
(a first attempt ran all-warm-then-all-cold and produced nonsense — warm ranging 3.3 s to 26 s):

| path | median |
|---|---|
| warm — persisted row present, builder skipped | **134 ms** |
| cold — computes and persists | **182 ms** |

**~48 ms added, once per day.** Far from the route-doubling the entry's shape implied.

End to end, signed in, with the derived row cleared first:

```
body-battery #1  anchor 54 | source readiness | provisional false
readiness-score  score  54 | Moderate
body-battery #2  anchor 54 | source readiness | provisional false
```

Readiness and the anchor now report the **same number** — the property that makes the two Home cards
agree, and the thing the provisional label existed to apologise for.

## Verification

- `tsc --noEmit` clean · `eslint` clean (one pre-existing `yesterdayIso` warning, confirmed present
  on `main` before this change) · full suite **424 files / 3382 tests** green.
- New `anchor-on-demand-readiness.test.ts` pins the fix: readiness anchor without the readiness
  route having run, `provisional: false`, and the row persisted. **Verified it fails without the
  change** — `expected 'sleep' to be 'readiness'`, exactly the reported symptom.
- The test clears its user's derived row and battery snapshot in `beforeAll`, not just `afterAll`.
  A first version passed only on a clean DB and failed on a re-run — the same order-dependence class
  as Q-146. Proved order-independent by running the directory twice back to back.

**Not exercised: the device.** Body Battery is a Home card on the APK; nothing here ran on the S25.
Also untested: the failure branch where the builder throws (it logs and falls through to the old
provisional anchor) — reasoned, not forced.
