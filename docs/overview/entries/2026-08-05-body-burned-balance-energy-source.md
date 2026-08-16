# 2026-08-05 — "Burned" and "Balance" now use the correct active-energy source

**Domain:** body — v1.266.4, JS-only (no APK rebuild)

## The report

Owner: the Body tab's "Burned" card reads 0 kcal despite a logged lifting workout and a guided
walk that day — it isn't accounting for workouts or walks, and should really be BMR + Walk + Run +
Workout. Separately, the "Balance" card (food intake vs energy expenditure) has never shown real
data.

## Root cause (Q-96)

Not new domain math to invent — a source swap. "Burned" (`health-sections.tsx`) and "Balance"
(`useEnergyBalance` in `use-health-calcs.ts`) both read `calsBurnedToday`, a bare sum of
`activity_logs.caloriesBurned` computed in `app/api/body-metadata/route.ts`. That column is
populated **only** by Health Connect enrichment: a Guided Walk explicitly writes
`caloriesBurned: null` at completion (its own comment says it "hydrates on the next sync/fetch" —
that hydration never actually happens without Health Connect), and lifting workouts
(`workout_sessions`) aren't queried by this sum at all. So a day with a real walk + a real Push
session correctly read `0`, not "no data" — the row existed, its calorie field was just always
null for these sources.

The correct calculation already existed, wired into a *different* card in a *different* card
group: `computeActiveEnergy()` (`packages/shared/src/health/daily-energy.ts`) already correctly
combines strength-session energy + logged walk/run/cycle activities + de-duplicated passive steps
into one number, already computed in the same route as `activeEnergyKcalToday`, and already
feeding `EnergyBudgetCard` in the "Activity & intake" group. Per "One Formula, One Place": there
was already exactly one correct implementation.

## The fix

Swapped every consumer of `calsBurnedToday` (meaning "calories burned from activity today") onto
`activeEnergyKcalToday`, renaming state/props along the way for clarity: `health-sections.tsx`'s
"Burned" card, `useEnergyBalance`'s burned term, and — found during the sibling-surface check the
task itself asked for — three more genuine siblings sharing the identical broken concept:
`home-card-widget.tsx`'s nutrition-donut "boosted goal", and `nutrition-content.tsx`'s
`MacroRing` "+N from cardio" label (both a `Math.round(x) > 0 ? boost` pattern reading the same
narrow field for the same "extra calories burned" purpose).

**Also relaxed `useEnergyBalance`'s all-or-nothing gate.** It required `metaToday.calories` to be
non-null (food already logged) before computing anything — stricter than `useEnergyBudget`, which
defaults to 0 and never gated on it. No food logged yet today isn't missing data, it's a real,
common state (nothing eaten yet, or a day without tracking) — requiring it was the *other* reason
"Balance" read "No data" far more often than the working Budget card for the same underlying
inputs. Not silently kept the stricter gate per the plan's own instruction to decide, not guess.

**Deliberately not fixed:** `nutrition-content.tsx`'s local-store optimistic paint (ahead of the
network fetch, for instant feedback right after logging an activity) still sums the narrower
`activity_logs.caloriesBurned` locally — it's overwritten moments later by the correct network
value, and a full `computeActiveEnergy` port to the local store (needing profile + local workout
sessions + local pedometer steps) is a materially bigger, separate task. Flagged inline with a
comment rather than silently left unexplained.

**Kept unchanged on purpose:** `app/api/body-metadata/route.ts` still computes and returns
`calsBurnedToday` (now unread by any UI consumer) and `components/nutrition/macro-ring.tsx` keeps
that name as its own generic leaf prop (fed the correct value now, just not renamed) — narrowing
this PR to the actual bug rather than an API-contract cleanup.

## Verification

Typecheck and lint clean (pre-existing, unrelated `exhaustive-deps` warnings in two touched files
confirmed to predate this diff). Full suite: 400 files / 3,171 tests green.

Reproduced the exact bug and fix through the real route against `pnpm dev`, authenticated: seeded
a completed lifting workout + a guided walk (null calories) for today, plus a DOB so the estimator
has what it needs. `GET /api/body-metadata` returned `calsBurnedToday: 0` (the old broken value,
confirming the reproduction) alongside `activeEnergyKcalToday: 402` (the correct value, now what
every UI consumer reads). `useEnergyBudget` and the newly-fixed `useEnergyBalance` are structurally
guaranteed to agree going forward — same inputs, same helper functions, both already in the file.

**Not exercised:** no on-device/native surface — server-side energy math and client display wiring
reached via Railway with no APK rebuild. Did not screenshot every individual UI consumer
(Burned/Balance cards, the home nutrition-donut boost, the nutrition macro-ring label) — verified
the shared source value directly and traced each consumer's wiring by reading, since all four are
simple, type-checked pass-throughs of the same now-correct number.
