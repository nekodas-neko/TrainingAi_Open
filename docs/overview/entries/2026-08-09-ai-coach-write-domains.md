# 2026-08-09 — AI Coach Phase 3a: nutrition targets, goals and injuries

**Branch:** `claude/health-metrics-button-designs-hy6cyv` · **Q-157 phase 3, part 1 of 2** ·
**v1.272.0**

## What shipped

Coach could change one thing: an exercise in a session. It can now change four domains, through the
same confirmation, the same per-row toggles, the same staleness refusal and the same undo.

- **`lib/coach/domains/`** — `session-exercise.ts`, `goals.ts`, `injury.ts` behind a `DomainHandler`
  interface, with `apply.ts` and `consequences.ts` reduced to dispatchers.
- **`nutrition_targets`** (calories, protein, carbs, fat) and **`user_goals`** (steps, calories,
  water), including the **localStorage write-through** Home and Profile read from.
- **`injury`** — log one, update an existing one, mark it recovered.
- **`getGoalsAndInjuries`** tool, so the model has a real source for every `from` value.
- Numbers render with units and separators in the confirmation (`2,540 kcal → 2,340 kcal`).

## Decisions worth not re-litigating

- **Every domain is a scalar field change, even the creates.** Logging an injury is
  `Area: — → left shoulder`, `Severity: — → moderate`. Keeping one shape means the confirmation UI,
  the toggles, the drift check and the undo record were written once; a new domain is a case in a
  switch rather than a new screen.
- **`targetId` is uuid-or-null.** Nutrition targets and goals are singletons the user already owns,
  and an injury log creates. A placeholder uuid would have made "create" and "update someone else's
  row" look identical to the apply path.
- **A cross-domain guard** (`fieldsMatchDomain`) rejects a patch whose fields belong to a different
  domain, so a model that mixes them cannot aim a calorie field at an exercise row.
- **Coach logs an injury and stops.** The owner asked it to behave like manual entry, and that
  behaviour already exists end to end: `signals.ts` derives `activeInjuredMusclesInSession`, the
  periodization prompt weighs it via `session_swap_recommended`/`deload_recommended`,
  `emergency-deload.ts` deliberately excludes injuries as a blunt standalone trigger (AI-4), and
  `injurySafeAlternatives` drives workout-time swaps. The round-3 mockup's "flag N exercises"
  toggle would have been a second implementation of all of that; it is not built. The confirmation
  *states* what will follow instead.
- **An unusually large calorie jump is flagged, not blocked.** ≥500 kcal gets a warn line; the user
  can still accept it.
- **A second injury for the same muscle updates rather than stacks** — two active rows would make
  `activeInjuredMusclesInSession` count one problem twice.

## Found while verifying

**The affected-exercise count read zero for every side-qualified injury.** The program stores
`shoulders`; a person says `left shoulder`. `normalizeMuscle` does not bridge that, so the "N
exercises train this" line silently never appeared — and a missing line looks identical to "nothing
in your program trains this", which is a different and wrong statement. Fixed by stripping the side
and the plural before matching, with a test.

## Verification

Signed in against the dev server at 412×891:

| Check | Result |
|---|---|
| Full suite | 421 files / 3329 tests green |
| `pnpm build` | compiles |
| Lint + all 12 custom-rules scripts | pass |
| "drop my daily calorie goal to 2340" | `2,540 kcal → 2,340 kcal`; DB **and** localStorage both 2340 |
| "my left shoulder is bothering me…" | three toggleable fields; row landed with the right severity |
| Drift, ownership, undo, cross-domain | covered by 13 new DB-backed tests |

**Not verified on device** — the existing Coach Known-Issues row covers it; this adds no new
surface, only new rows inside the confirmation card that was already there.

## Left open — Phase 3b

The tier-3 pushed confirmation screen (phase changes, early deload), the `NumberDial` and `Handoff`
widgets, cardio goals, and the T2/T4 chart-pairing rule. All of it is UI on top of the domains this
lands. `/api/ai-chat/route.ts` is still unreferenced and still awaiting removal.
