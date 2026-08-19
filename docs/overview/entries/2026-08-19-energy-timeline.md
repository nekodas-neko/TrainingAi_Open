# 2026-08-19 — Q-414: energy in against energy out, on one timeline

**Branch:** `feat/energy-timeline-chart` · **Lane B** · v1.330.0

The owner asked for *"a display of calorie intake over time… could be superset with calorie out too;
so can see what times energy is expended vs refueled."* It shipped on day detail, under the Energy
card.

## The design question, and how it was got wrong first

Q-414's entry said to check what the movement pipeline stores per interval before picking a bucket
width. It stores almost nothing: `step_live_windows` holds **11 rows and 8,261 steps in its whole
history** against 668,749 counted in `body_metrics` — 1.2%. Passive step energy, which is roughly
five times the logged-activity energy, arrives as one number per day.

From that I concluded no honest burn curve could be drawn, and took it to the owner as a choice
between a curve that reconciles (by smearing) and one that refuses to smear (and cannot reconcile).

**That was the wrong question, and the owner said so:** *"Isn't that already being done in the daily
HR chart?"* Two things in that are worth separating —

- **Heart rate is not an input to calories-out.** `computeActiveEnergy` is MET × duration; HR
  appears nowhere in it. The premise as stated was wrong.
- **But the timing data exists, and it is HR.** `oura_heartrate` holds 72,530 samples over 59 days.
  The ring *alone* covers **all 24 hours**, on 11–14 of the last 14 days per hour — a sample every
  3–7 minutes around the clock — plus the chest strap during workouts. No hour is dark.

So the chart **distributes** the day's expenditure rather than recomputing it. The total stays
exactly what `computeActiveEnergy` returned; only the shape comes from HR. Both of the entry's rules
then hold at once: the curve ends on the day's burn *because it is a partition of it*, and it is not
smoother than its data *because its shape is measured*.

## A modelling error caught before it shipped

The first draft weighted each bucket by the **sum** of `bpm − restingHr` over its readings, reasoning
that the ring samples more when you move, so density is evidence of activity.

That holds within one source and breaks across two. Measured over 14 days, the chest strap logged
**26,034** samples to the ring's **3,810**, and it is worn only during workouts — so summing would
hand a strap-worn workout on the order of a hundred times the energy of an equally long, equally
intense ring-only walk. It weights by *which device was on your body*.

It now weights by **mean** elevation per equal-width bucket, which approximates ∫(bpm − resting)dt.
A test pins it in both directions: equal-mean buckets must earn equal energy however many readings
each was assembled from, and a harder hour must still out-earn an easier one.

## What is where

| file | role |
|---|---|
| `components/health/energy-timeline.ts` | the arithmetic — a `.ts`, because both vitest projects are node-env and anything inside a `.tsx` cannot be unit-tested at all |
| `components/health/energy-timeline-chart.tsx` | inline SVG. Not chart.js: canvas cannot resolve `var(--x)` and renders black, which has shipped twice, whereas SVG takes the token directly |
| `app/health/day/day-detail-content.tsx` | wiring — adds a `food-logs:<date>` fetch for meal *times*, which the day payload does not carry |

No new API route. `/api/day-log` already returns the day's HR trace and `/api/nutrition/food-logs`
the meal times, so this stayed wholly in Lane B.

## Verification

Exercised on `pnpm dev` against day detail for 2026-08-17, with the reconciliation the entry demands:

- **Eaten 2,220** — exactly the three seeded logs (600 kcal × 1 + 1.5 + 1.2).
- **Burned 2,380** — exactly the Energy card's own breakdown directly above it (Resting 2,197 +
  Steps 183). The curve agrees with the number it sits under.
- **Three intake bars**, at the three meal times.
- **The curve bends with HR** — per-hour rise varies 1.76 to 5.03 in SVG units, so the 08:00 workout
  hour climbs about three times faster than a quiet one.
- Caveat text renders; zero console errors.
- 4,208 unit tests, 49 of 49 custom rules, `tsc` clean, lint 0 errors.

**Two things the sandbox could not do, and one of them is worth its own entry:**

- **`/api/nutrition/energy-balance` and `/api/body-metadata` 500 in every sandbox session.** They
  read `lib/oura-models/constants/energy-expenditure-features.json`, which is gitignored — removed
  in the public-repo cut — and the loader throws by design (*"a missing constant is a wrong number,
  not a missing feature"*). So **the Energy card on day detail has never been renderable locally**,
  and neither was this chart until a local stub was written. Filed as **Q-361**.
- **The seeded user has no `date_of_birth`**, so `computeEnergyBalance` returns no balance and every
  energy surface is blank locally even with the constants present. Also in Q-361.

**Not verified:** no device run — JS-only, reaches the APK on the next Railway deploy with no
rebuild. The numbers above came from a local **stub** MET table, so they prove the arithmetic and
the reconciliation, not the calorie values. And the HR shape was checked against an injected day
rather than a real one, because the seed carries 21 samples for that date.
