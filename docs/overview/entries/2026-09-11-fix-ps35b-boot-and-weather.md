# 2026-09-11 — four boot and chip fixes, and a report claim that did not hold (PS-35b)

**PR:** `fix/ps35b-boot-and-weather` · **Lane B** · `app/manifest.ts`, `components/sync-provider.tsx`,
`lib/stores/workout-store.ts`, `lib/weather/use-weather.ts`, `components/weather-chip.tsx`.

Four independent items from the 2026-09-05 app checkpoint, split out of PS-35 by OR-106 because a
`Gate: owner` scoped in prose to the page deletions was parking all four behind a decision none of
them needs.

## ① The PWA launched into a redirect

`start_url` was `/session-select`, which is a bare `redirect("/workout")` — so every launch from the
installed icon paid a hop before showing anything. It points at `/workout` now: the same destination,
no redirect. Whether the Workout tab is the right place for a launch to *land* is PS-35's
page-consolidation question and the owner's; this only removes the hop.

## ② The boot warm bypassed the in-flight map

`warmCache` used a bare `fetch`, which `cachedFetch`'s in-flight map cannot see — so the warm and a
component mounting at the same moment issued two requests for one URL. It now goes through
`cachedFetch` / `cachedFetchToday`, which is also CLAUDE.md's standing rule with a measurement
attached. The skip-if-fresh early return is untouched, so the shared fetcher runs only when nothing
is cached — which is exactly when a revalidation is wanted, and why no `freshWithinTtl` is involved.

**A/B on identical runs: 34 → 29 requests on boot** (32 → 27 distinct URLs), stable across two runs
of the fixed build.

**It also closed a mismatch the rewrite surfaced.** The hand-rolled envelope stamped
`todayInTz(tz)` — the user's zone — while every reader unwraps with `unwrapToday`, which compares
against `todayInTz()` (the Brisbane default). Outside Brisbane the warm write was unreadable the
moment it landed. Writer and reader now share one function and cannot disagree.

## ③ The dead branch was stale prose, not a missing feature

The E1-4 comment said a workout *"whose start anchor is >4h old **or from a previous day**"* is
abandoned. `dateRolledOver` is false at the only production call site: `onRehydrateStorage` passes
`today: null` **on purpose**, because the store runs before any provider mounts and guessing Brisbane
would clear a Kiritimati user's morning (Q-477). The day's ticks roll over separately and correctly
in `WorkoutDayRollover` → `rolloverDay(today)`, from the user's real zone.

So the code is right and the comment was wrong. Corrected, and the surviving behaviour pinned by
tests: a workout started at 23:50 and resumed at 00:10 **survives**, which is the right answer for
someone training across midnight, while a >4h anchor is still dropped.

## ④ The weather chip pulsed forever, and its cache was unkeyed

Two defects in one hook. No failure state meant a failed fetch rendered as an eternal skeleton — the
Q-499 shape, where the user cannot tell "loading" from "this broke". And the cache was **one unkeyed
entry read before any coordinates were known**, so a moved device showed the old place's weather for
up to 30 minutes *and* skipped the fetch that would have corrected it.

The cache is keyed by coordinates rounded to 2 dp — the same rounding `fetchWeatherSnapshotShared`
already used, so there is one rounding rule rather than two — and read **after**
`getDeviceLocation()` resolves, which is the half that makes the key mean anything. A stale entry for
*this* place still beats an error state; `failed` is only set when there is nothing to show.

Keying costs the synchronous seed, and a skeleton flash on a repeat visit is a bug here, so a
`ta_weather_cache:last` entry remembers where the last fetch was and seeds the paint from it — in a
`useEffect`, not the `useState` initializer the old code used.

## The report's palette claim did not hold

PS-35b said *"drop the two unreachable palette keys named in the report"*, and the report explained
that `pathname-routing.ts:26` (`/workout`) precedes `:45` (`/workout-select`).

**Those two lines are in different functions.** `:26` is in `pathnameToSection`; `:45` is in
`pathnameToPaletteKey`, and nothing in the latter matches `/workout-select` before it. Evaluated:
`/workout-select` → `workoutSelect`, `/stats` → `stats`, `/workout` → `null`. Both keys are live, and
deleting them would have removed the palette from two real routes. Not dropped; the entry records the
correction.

Worth stating as a habit rather than a one-off: **a shadowing claim is about one function's branch
order, so check the two lines are in the same function before trusting it.**

## Verification

- 13 new unit cases on the weather key, the read-after-coords ordering, the seed, the failure state,
  the manifest target, and the warm's fetcher choice; 2 behavioural cases on the midnight workout.
- **Rendered**: with geolocation granted and `api.open-meteo.com` aborted, the chip shows its `—`
  state at 32 × 24 px instead of pulsing.
- Boot request counts A/B'd as above.
- `pnpm check:rules` — **Ran 73 of 73**.

**Not exercised:** the S25, and the weather **success** path. The sandbox has no outbound route to
`api.open-meteo.com`, so only the failure branch could be rendered — the keyed cache and the seed are
unit-tested, not observed end to end. The device check is on the entry.
