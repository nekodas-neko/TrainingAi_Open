# BF-7 — a 45-minute session: implementation plan

**Status:** plan only. No code in this PR (backlog protocol: PR 1 plans, PR 2 builds).
**Lane:** A for `packages/shared/**` (the model and the prescription branches); B for the control.
**Owner request, 2026-08-23:** *"id like to have the ability to choose a 45min session — maybe we
have a slider — and the default one is shown — but have the option to slide to 15/30/45/60/90
options?"*
**Owner decision, same day:** *"yes I agree lets anchor to session; dont need 15minutes"* — so the
session's configured length stays the anchor, and 15 is dropped.

---

## 1. The decision this plan exists to make

BF-7 asks whether `DurationPreset` stays an enum with more members or becomes a minutes number, and
notes seven call sites depend on the answer. **The entry frames this as a typing question. It is
not.** `short` and `long` do not merely scale a budget — they select *different algorithms*
(`generate-prescription.ts:485` and `:504`):

| preset | what actually runs |
|---|---|
| `short` | `dropToBudget` — removes whole **exercises** |
| `standard` | `fitToBudget` — removes **sets** only |
| `long` | `fitToBudget`, then `expandToBudget` — **adds** sets up to each muscle's MRV |

And `standard` must never expand, for a documented reason worth quoting because it is the thing a
naive refactor destroys:

> *"The duration model is deliberately conservative and that under-fill IS the finish-early margin —
> the owner's sessions land on time because of it. Expanding by default would spend exactly that
> margin."*

**Recommendation: `DurationPreset` becomes a minutes number, and the three algorithms are selected by
direction relative to the anchor.**

```
chosen < anchor  → dropToBudget
chosen = anchor  → fitToBudget          ← the finish-early margin, preserved by construction
chosen > anchor  → fitToBudget + expandToBudget
```

That is why the number is safe: the branches were never really about the *labels*, they were about
whether today is shorter, the same, or longer than the session the user configured. `sign(chosen −
anchor)` reproduces the current behaviour exactly at 30/60/90 on a 60-minute session, and extends to
45 with no new rule. Keeping an enum and adding members (`'shorter' | 'short' | 'standard' | …`)
means inventing a label per rung and re-deciding the algorithm for each, which is the same decision
made worse.

**Reversal cost: low.** Nothing is persisted (see §5), so the type is internal end to end. A revert
is a type change and a mapping function, with no data to migrate.

---

## 2. What the ladder is

**30 / 45 / 60 / 90 minutes, absolute, with the session's configured length as the anchor and the
default.** The owner's decision settles the apparent conflict with the 2026-07-29 relativity call
(*"30 mins +/- the routine's chosen amount"*): relativity is preserved where it matters — the
anchor and the algorithm selection — while the rungs the user picks from are absolute minutes,
which is what makes "45" nameable at all.

- **15 is not offered.** `MIN_PRESET_BUDGET_MIN = 20` stands, and `WARMUP_CEILING_FRACTION = 0.2` is
  documented as chosen so `0.20 × 20 = MIN_WARMUP_MIN (4)` — the two warmup clamps **meet exactly at
  20 and invert below it**. Offering 15 means re-deriving that arithmetic. The owner dropped 15, so
  this costs nothing and the constants are untouched.
- **A session configured to something off-ladder still works.** A 45-minute session anchors at 45 and
  the ladder shows 30/45/60/90 with 45 selected. A 50-minute session anchors at 50; the plan should
  render the anchor as its own rung rather than snapping the user's configured length to the nearest
  ladder value — snapping would silently re-plan a session the user never asked to change.

---

## 3. The constraint that decides the control

**A slider must not fire a prescription per detent.** `generate-prescription.ts:165` passes
`skipCooldown: durationPreset != null`, with the comment *"the user switching presets is exactly that
fast"* — so every intermediate value bypasses the 30-second read-through cooldown by design.
Measured in production: `prescription` AI calls average **2,445 ms** (n = 46, max 4,733 ms). A drag
from 90 to 30 crosses every stop.

**Commit on release, never on change.** Whatever the control is, the prescription request fires once,
on the value the user settles on. Intermediate values must not be requested at all — not debounced,
not cancelled-after-send.

**Cache-key growth is the second cost.** The preset is part of the dedup key
(`generate-prescription.ts:160`), so 3 rungs → 4 rungs multiplies entries per session per day. Four
is fine; this is noted so a later "why not a continuous slider" is answered with the number rather
than a shrug.

---

## 4. Work, in order

**PR 2a (Lane A, engine).**
1. `packages/shared/src/workout/duration-model.ts` — `DurationPreset` becomes `number` (minutes).
   Keep `budgetForPreset(sessionBudgetMin, chosenMin)` as the one place that resolves a choice to a
   budget, clamped at `MIN_PRESET_BUDGET_MIN`. `DURATION_PRESET_DELTA_MIN` loses its role as the
   ladder's step and should be deleted rather than left as a stale constant — grep it first.
2. `warmupGoalSecFor` takes the same number. It already derives from `budgetForPreset`, so this is a
   signature change, not a behaviour change — and it is what keeps the countdown the lifter watches
   equal to the budget the plan was built against (Q-212).
3. `generate-prescription.ts` — replace the two equality branches with the direction rule from §1.
   **Write the comparison against the session's configured budget, not against a constant**, or a
   45-minute session's "60" would read as `standard`.
4. Cache key: the preset segment becomes the chosen minutes. A stale `'standard'` string in a key is
   harmless (different key → miss), so no migration of in-flight keys is needed.

**PR 2b (Lane B, surface).** `session-duration-picker.tsx`, `use-duration-preset.ts`,
`pre-workout-screen.tsx`, `workout-screen.tsx`, `mood-checkin-sheet.tsx` — the control, showing the
anchor as the default and committing on release.

The split is the standing lane rule (both lanes → Lane A first). 2a is shippable alone: with the
control still sending three values, the direction rule reproduces today's behaviour exactly, which
is the test.

---

## 5. What makes this unusually cheap

**Nothing is persisted.** There is no `duration_preset` column in the Postgres schema, in the local
SQLite tables, or in `lib/local-store/types.ts` — the hook's own comment says *"the choice is never
written to the program, it only tags the plan it produced"*. **No migration, no sync work, no
local-store change**, which is rare for a change this visible. It also means the type can change
freely: there is no stored value to be compatible with.

---

## 6. Verification

- **The direction rule reproduces today's behaviour.** On a 60-minute session, 30/60/90 must select
  `dropToBudget` / `fitToBudget` / `fitToBudget+expandToBudget` respectively — assert the algorithm
  selected, not the budget, since the budget was never the part that broke.
- **`standard` never expands.** Pin it explicitly at the anchor: this is the finish-early margin and
  it is the single most valuable invariant here.
- **A 45-minute session anchors at 45**, and choosing 60 on it expands rather than fits — the case
  that proves the comparison is against the session's own budget and not a hardcoded 60.
- **The floor holds.** A 30-minute rung on a session configured at 30 must not fall below
  `MIN_PRESET_BUDGET_MIN`.
- **On device:** choose 45 on a real session; the plan is trimmed against 45, the warm-up countdown
  shows the 45-minute warm-up rather than the configured session's, and dragging the control fires
  exactly one prescription request (watch the network tab or `error_events` for a burst).

---

## 7. Out of scope, deliberately

- **Persisting the choice.** It is a choice about today; §5 is a feature, not an omission.
- **A continuous slider.** §3's cache and latency costs are per distinct value; a fixed ladder of
  four is what the owner asked for (*"15/30/45/60/90 options"*), minus 15.
- **Re-deriving `WARMUP_CEILING_FRACTION`.** Only needed to offer sub-20-minute sessions, which the
  owner dropped.
