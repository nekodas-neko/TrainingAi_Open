# 2026-08-15 — Nutrition's date-blind food-log guard, the deload bar, and the day screen's missing energy summary

Three owner-reported items from the 2026-08-14 batch. Q-245, Q-246 and Q-247; PR #1375, v1.317.0.
Q-246 and Q-247 shared a branch in the backlog, which is why they ride together.

## Q-245 — swiping back to a fresh today showed the previous day's meals

`app/nutrition/nutrition-content.tsx`'s `loadFoodLogs` keeps the previously rendered logs whenever a
fetch comes back empty. That guard is deliberate and stays: it is what stops a transient empty read
wiping food that is logged locally and not yet synced. But it compared only lengths — three times,
in three copies — so it had no way to tell "this empty result is a hiccup for the day on screen"
from "this empty result is the correct answer for a different, genuinely empty day". Swiping to a
past day with food and back to a fresh today hit the second case and kept the first day's meals,
with nothing to re-trigger the fetch, so it stuck until the component fully remounted — matching the
owner's "it doesnt reset until app close and reopen" exactly.

The decision now lives in one pure function, `app/nutrition/food-log-application.ts`, taking the
date the resolved fetch was for, the date on screen, and the date the rendered logs belong to. It
returns `drop` / `keep` / `replace`. The three copies collapsed into a single `applyLogs` helper.

Two things worth keeping in mind for whoever touches it next:

- **The `drop` case is not in the backlog entry's fix direction, and it is needed.** The entry said a
  fetch for a different date must always overwrite. That is right for the reported bug but wrong for
  a response that resolves *after* the user has swiped away — overwriting there paints one day's
  food under another day's header, which is the same bug approached from the other side. Both are
  handled.
- **`logsDateRef` is read outside the `setLogs` updater, on purpose.** Reading it inside would let
  React's dev-mode double-invoke observe its own write and flip a `replace` into a `keep` on the
  second pass — the exact bug being fixed, reintroduced through the back door. It is read once per
  `applyLogs` call (not once per `loadFoodLogs` run: `applyLogs` fires twice in a run, and the
  second call needs the first's write).

## Q-246 — a real deload day rendered identically to a rest day

`app/api/weekly-stats/route.ts` zeroes a deload day's `volume`, and that is correct: `totalVolumeKg`
is summed straight from `days[].volume`, so a deload counted there would inflate the week's headline
"total lifted". The bar in `components/stats/weekly-stats-hub.tsx` had `volume` as its only input,
so a logged deload collapsed to the flat 6px grey sliver that means "nothing happened here".

The held-out volume now travels as its own field, `deloadVolume`. The bar draws from it at a true
height with a striped fill; `volume` and therefore the total are untouched. Verified end to end
against the local dev DB by flipping a seeded session's `phase_type` and calling the route: the
deload day came back `volume: 0, deloadVolume: 1440, isDeload: true` with `totalVolumeKg` unchanged.

**A second bug surfaced while checking the entry's `isTesting` question, and is fixed here too.**
`isDeloadSession` returns true for `phaseType === 'testing'` as well as `'deload'`, so
`every(isDeloadSession)` was true for a testing-only day — which set `isDeload`, and `isTesting` was
gated on `!isDeload`. A pure testing day therefore rendered the amber "D". The "T" marker could only
ever appear on a day mixing a testing session with a normal one. Testing is now decided first and
wins; a testing day gets "T".

The day classification moved out of the route into `app/api/weekly-stats/classify-day.ts` so it
could be tested — a `route.ts` cannot export a runtime helper without tripping Next's route-export
validation.

### The stripes carry no colour

`repeating-linear-gradient(45deg, currentColor 0 3px, transparent 3px 6px)` used as a mask. A mask
reads only the gradient's alpha, so any opaque value works and none of it is theme-dependent — an
overlay would have needed a black/white-alpha literal and broken in one theme or the other. The
first attempt used `#000` and the hex-literal check was right to fail it; `currentColor` removes the
literal rather than raising the baseline.

`maxVolume` now takes `Math.max(volume, deloadVolume)` per day. Without that, a week containing
nothing but deloads leaves `maxVolume` at its 1 floor and the bar runs off the chart.

## Q-247 — no calories in vs out, and activity rows showing a title and a duration

The owner asked for three things: calories in vs out on the day overview, the calorie expenditure of
workouts and activities, and more on an activity row than a title and a time.

**The formula was never missing.** `computeActiveEnergy` already combines strength sessions
(`estWorkoutKcal` by duration), logged activities (MET by type) and passive steps — with an outdoor
activity's own steps subtracted so a walk is not counted twice — and `computeEnergyBalance` wraps it
with resting burn and intake. It powers Nutrition's Energy Balance card. The day screen simply never
asked for any of it.

It now reads `/api/nutrition/energy-balance?date=…`, which already accepted an arbitrary date, and
reuses the `energy-balance:<date>` key and `ENERGY_BALANCE_TTL` that Nutrition uses for the same
endpoint — so the two screens share one cached answer rather than racing two of their own. Fetched
separately rather than folded into `/api/day-log` on purpose: the balance reads a 30-day window to
calibrate maintenance, and the day payload is re-fetched on every swipe.

**The section stays hidden on a day with nothing logged.** Resting burn computes for every day the
profile supports, so without that gate the "Nothing logged on this day" empty state would sit
underneath a full set of numbers. `hasAnything` was deliberately left alone for the same reason —
an energy balance existing is not evidence the day had anything in it.

**Activity rows needed no new data at all.** `DayLogResult.activityLogs` is the full `ActivityLog`
type, so `distanceKm`, `caloriesBurned`, `avgHr`, `maxHr`, `steps`, `avgPaceSecPerKm`,
`elevationGainM` and `notes` were already arriving and being dropped on the floor. They render now.

Per-workout kcal in `TrainingSection` (the entry's third, "consider" item) is **not** done. It would
need `estWorkoutKcal` per session, and that module is the Q-230 bundle hazard — importing it from a
client component drags `node:path` into the browser bundle and fails the Build job while tsc and the
suite stay green. Doing it properly means computing it server-side in `/api/day-log`, which needs the
profile and latest weight fetched there. The day-level `Workouts` figure in the new breakdown answers
the owner's actual question ("the calorie expenditure for workouts or activities"), so this was left.

## Verification

Local `pnpm dev` with the seeded DB: logged in over the credentials flow, called `/api/weekly-stats`
before and after flipping a seeded session to `deload` and another to `testing`, and loaded
`/nutrition`, `/health` and `/health/day?date=…` (all 200, no errors in the dev log).

For Q-247 the energy route was called for real days. The seeded user has no date of birth, so it
first returned `balance: null` with `missingProfileFields: ['date of birth']` — worth knowing, since
that is also what a real user with an incomplete profile sees. With the profile filled it returned
`intake 0 / expend 2675 / resting 2197 / net −2675` and `workoutKcal: 290` on the day carrying a
logged session — the day's workout expenditure, which is what the new breakdown row shows. (Not a
per-workout figure; that is the piece deliberately left undone above.)

`pnpm build` · `npx tsc --noEmit` · `pnpm lint` (0 errors) · `pnpm check:rules` — **35 of 35** ·
full suite **476 files / 3,931 tests, none skipped** under the TCP `DATABASE_URL`.

All three new tests were mutation-verified against the pre-fix logic: `food-log-application` fails
2 of 6 (the reported bug case and the stale-response case), `classify-day` fails 5 of 7, and
`energy-summary` fails 2 of 7 (the nothing-logged gate and the surplus/deficit label).

**Not exercised.** No section on the day screen appears in the server-rendered HTML — they all
render from a client fetch — so `curl` cannot confirm the Energy section or the enriched activity
rows *visually*; what is verified is the route's numbers and the display logic behind them. The
Q-245 repro is a swipe gesture driving React state, and Playwright's npm package is not a dependency
here (only the browsers are installed), so that interaction was never driven in a browser — the
decision it turns on is covered by the pure-function test, and the wiring around it is not. None of
the three has been seen on the S25: the striped mask in particular is a Samsung WebView rendering
question, and `-webkit-mask-image` behaviour there is assumed, not observed. All three carry a
⚠️ not-device-verified row in `projectOverview.md`.
