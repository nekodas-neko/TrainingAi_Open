# Handoff — one calorie budget across every surface, and a bar you finish

**Date:** 2026-08-20 · **Agent:** Implementation Lane B · **Branch:**
`claude/implementation-lane-b-0o7kb9` · **Version:** v1.334.0 · **Domain:** `nutrition`

---

## What the session set out to do

Work Lane B's queue. It cleared the `calorie-budget-surface` batch (**Q-417** + **Q-415**) together
with **Q-323**'s remaining Lane B half, which the entries themselves required to ship as one PR —
Q-323's progress bar fills toward the budget Q-415 fixes, so landing either alone points the bar at
the wrong number.

Earlier in the same session (already merged, before this work): **#184** Q-411+Q-358, **#192/#199/#203/#209**
Q-359 slices 1–4, **#213/#219/#226** Q-414, **#239** Q-416, **#260** Q-391.

## The defect, in one table

Three calorie budgets were on the owner's screen at the same moment, from the same data:

| surface | what it computed | 2026-08-19 |
|---|---|---|
| both Energy Balance cards | `restingBase + targetNet + activeKcal` | **2,180** ✅ |
| Home's nutrition donut (Q-415) | `users.calorie_goal + activeEnergyKcalToday` | 2,451 (+271) |
| Nutrition tab's ring (Q-417) | `nutrition_targets.calories + <local activity sum>` | 2,001 (−179) |

The ring printed **"Goal reached"** at 2,014 eaten because 2,014 clears its 2,001, while the card two
rows above said *"166 kcal left today"*.

## What shipped (all in this one PR — see the journal entry for the full list)

- **`components/nutrition/ring-targets.ts`** (new, 7 tests) — the one place a client resolves the
  day's calorie budget and macro grams, both from `/api/nutrition/energy-balance`.
- **`components/home/home-nutrition-card.tsx`** (new) — Home's donut lifted out of the card switch
  and onto that same payload, self-fetching via `useEnergyBalanceToday`.
- **`CalorieZoneBar` → `CalorieProgressBar`** + `components/nutrition/calorie-progress.ts`
  (10 tests) — Q-323's zone-bar-becomes-a-progress-bar.
- Home's ring sweeps to `eaten / budget` with a grey remainder and a `left`/`over` centre.
- The Nutrition ring renders `macroTargets.scaled`; `+N from cardio` → `+N from movement`.
- `docs/module-map.md`, `docs/domains/nutrition/README.md`, `projectOverview.md`, the journal entry
  and the backlog all updated in the same diff.

## Decisions made, and why — do not re-litigate these

**Q-417's fix is deliberately not the one its entry proposed.** The entry asked for a
"which source last wrote" guard so the optimistic local paint could not overwrite an arrived server
value. What actually shipped removes the ring's budget derivation entirely, which kills the race
*and* the disagreement at once and lets the optimistic `activity_logs` read be deleted rather than
sequenced. If you find yourself adding a ref to order two fetches, re-read this paragraph first.

**No budget beats a wrong budget.** Where there is no derived baseline — incomplete profile, payload
not arrived — the calorie budget renders as *absent* rather than falling back to the stored goal.
Substituting the stored goal for a derived baseline **is** the defect. Macro grams still fall back to
the stored row, because a macro target is a target and not something derived from movement.

**The progress bar's bands are the existing thresholds reflected, not a tuned tail.** Over-side amber
and red are each `OUTER_KCAL − ON_TARGET_KCAL` wide, mirroring the under side; the under-side red
looks longer only because it runs back to zero eaten. Band edges and the fill's colour come from
`balanceZone()`/`ON_TARGET_KCAL`/`OUTER_KCAL`, so there is no second definition of "on target".

**One payload for the whole calorie story.** Home's card takes *eaten* from `balance.intakeKcal` when
a balance exists, not from `body-metadata`. Two independently-refreshed numbers in one fraction is a
smaller version of the defect being fixed. The macro grams still come from `body-metadata`; they are
not part of that sum.

## ⚠️ THE STATE THE PR IS IN — read this before anything else

**The PR is open and NOT merged. That is deliberate, not an oversight.** It is CI-checkable and every
mechanical gate is green, but the standing "tested" bar was not met and I will not claim it was:

| gate | state |
|---|---|
| `tsc --noEmit` | clean |
| `pnpm build` | green |
| `npx vitest run` | 419 files / 3,744 tests, 0 failing (119 DB files skipped — no `DATABASE_URL` that run) |
| `pnpm check:rules` | **Ran 50 of 50**, all passed |
| `pnpm dev` — `earned = 0` path | ✅ exercised live through `/api/nutrition/energy-balance` |
| `pnpm dev` — `earned > 0` path | ❌ **never exercised** — see below |
| anything rendered in a browser | ❌ headless login did not complete in-session |
| device | ❌ not verified |

**The blocker.** Against `trainingai_dev`, `/api/nutrition/energy-balance` returned `activeKcal: 0`
for the local today with a 60-minute `walk` activity (`calories_burned = 300`) **and**
`body_metrics.steps = 18000` seeded — while the *same window's* food logs resolved perfectly
(`intakeKcal: 2014`). So "the window excludes today" is not the explanation on its own:
`lib/health/energy-balance-service.ts:95-98` fetches metrics, food and activities over
`windowStart … date` inclusive, and only the food one produced anything.

**First thing to check** (filed as **LB-4**): `activeEnergyFor(day)` filters with `a.date === day`
and `metricByDate.get(day)` — plain string equality against whatever `rowToActivityLog` /
`rowToBodyMetric` put in `.date`. If either mapper returns a `Date`, both filters miss silently and
forever. Then rule out a local-only data difference. **Production is known to work** — the owner's
2026-08-19 screenshots carried a live `551 earned from movement`, which is this exact field — so if
it is code, it is data-shape-dependent rather than universal.

**The second unverified thing, which is device-only anyway.** Home's donut now draws a **four-stop**
`conic-gradient` where it drew three (the grey remainder is the fourth). Samsung's WebView compositor
is this repo's standing hazard for gradients inside card grids. This is a JS-only change, so it
reaches the device through a Railway deploy with no new APK.

## Filed, not fixed

- **LB-2 (Lane A)** — `logFoodEntries` *awaits* `invalidateNutritionWrite()` and only then starts
  `pushMutations()`, so the invalidation-driven refetch reaches a server that does not hold the row
  yet, and the fresh-but-pre-write answer settles for a full `ENERGY_BALANCE_TTL`. **This is the
  measured root cause of Q-417(a)** — the 42 kcal gap between two identical Energy Balance cards. The
  entry guessed a missing group member; `energy-balance:` has been in `invalidateNutritionWrite()`
  all along, so the eviction was never the problem. The correct shape already exists in this repo:
  the food-log *delete* path invalidates inside `pushMutations(...).then(...)`. Same defect in
  `logMealItems`. Left to Lane A because it is the outbox/push path.
- **LB-3 (Lane A)** — `barBands`/`barPosition`/`BAR_SCALE_KCAL` in
  `packages/shared/src/nutrition/calorie-balance.ts` now have no callers.
- **LB-4 (Lane A)** — the `activeKcal: 0` finding above.

## Deliberately NOT done

- **The PR was not merged.** Merging is the successor's call once the `earned > 0` path is exercised.
- **Nothing in `packages/shared/` was touched.** LB-2 and LB-3 both live there and both are Lane A's.
- **`MacroRing`'s own ring was not changed.** Q-323's "show grey for what's left" reads on Home's
  donut, which was the full-360°-split-by-macro ring the entry describes; `MacroRing` already drew a
  grey track behind a progress arc.

## Pickup prompt

```
You are Implementation Agent (B) 🚧 on nekodas-neko/TrainingAi_Open — the standing Lane B agent.
Keep that exact session title.

Read, in this order:
  1. projectOverview.md  (top Known-Issues row is mine, v1.334.0 — read it, it names two open checks)
  2. docs/domains/nutrition/README.md
  3. docs/handoff-2026-08-20-nutrition-one-calorie-budget.md   (this handoff)
  4. docs/agents/state/implementation-lane-b.md                (your baton)

Then: git fetch origin && git checkout claude/implementation-lane-b-0o7kb9 && git merge origin/main

YOUR FIRST ACTION is not a new feature. There is an OPEN, UNMERGED PR on that branch
(v1.334.0 — Q-415 + Q-417 + Q-323, one calorie budget across every surface). Every mechanical gate is
green: tsc, pnpm build, `pnpm check:rules` Ran 50 of 50, and 3,744 tests. What is missing is the
"tested" bar: the `earned > 0` path was never exercised on a running server, because
/api/nutrition/energy-balance returns activeKcal: 0 on the local dev DB even with a 60-minute walk
and 18,000 steps seeded for the day — while the same window's food logs resolve fine.

  a) Work LB-4 first (it is in docs/implementation-backlog.md). Start at
     lib/health/energy-balance-service.ts:131-150 — activeEnergyFor(day) filters activities with
     `a.date === day` and reads `metricByDate.get(day)`, both plain string equality against whatever
     rowToActivityLog / rowToBodyMetric put in `.date`. If either returns a Date, both miss silently.
     LB-4 is tagged Lane A; if the fix is in the adapter, hand it over rather than taking it.
  b) Once activeKcal is non-zero locally, run `pnpm dev` and check the four surfaces show ONE budget:
     Home's nutrition donut, Home's Energy Balance card, the Nutrition tab's ring, the Nutrition tab's
     Energy Balance card. `donut total − eaten` must equal the Energy Balance card's "left" figure
     exactly — that equality is the test, and it is what failed originally. Then log a food item and
     confirm all four move together (that second step is what Q-417(a) failed; expect it still to
     fail until Lane A ships LB-2).
  c) Re-merge origin/main, re-confirm CI green on the updated head, then merge. It is a display
     change on already-shipped features, so it needs no confirmation — but do not merge a stale green.

Constraints you would otherwise rediscover:
  - Lane B owns app/** (except app/api/**), components/**, app/globals.css, lib/hooks/**,
    lib/stores/**. packages/shared/** is Lane A's — LB-2 and LB-3 both live there, do not take them.
  - Your entry IDs are LB-N, counting up forever. LB-4 is taken; find the next with
    `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`.
  - No migration numbers and no local SQLite versions — those are Lane A's alone.
  - Nothing in this PR is device-verified. Home's donut now draws a four-stop conic-gradient where it
    drew three, and Samsung's WebView compositor is the standing hazard for gradients in card grids.
    It is a JS-only change, so it reaches the device on a Railway deploy — no new APK needed.
  - `pnpm check:rules` is the custom-rules gate; quote the "Ran N of N" count it prints, never a
    number from memory.

After that, `node scripts/next-item.js --lane B` for the queue. PS-1 and PS-2 are docs-only
agent-contract fixes at the top; Q-362, Q-423, Q-359 (12 latent fetch-once sites left) follow.
Q-362 was filed as inferred rather than observed — confirm it reproduces before building it.
```
