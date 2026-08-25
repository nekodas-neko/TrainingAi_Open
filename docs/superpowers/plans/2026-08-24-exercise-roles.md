# Exercise roles — the budget-aware recommendation, and the vocabulary

**Status:** design settled with the owner, 2026-08-24. Not implemented.
**Backlog entries:** BF-15 (the rule + defaults), BF-16 (data corrections), BF-17 (labels).
**Domain:** [`workouts`](../../domains/workouts/README.md)

Read this before changing any of the design. Four shapes were proposed and rejected with reasons
during the conversation that produced it; re-proposing one costs a session.

---

## 1. Why the role matters

`resolveStyleForExercise` (`packages/shared/src/phase-engine.ts:147`) selects the progression style
from `exercise_role`, and the style carries the per-set percentages. Measured against the owner's own
phases:

| Role | What it resolves to |
|---|---|
| `accessory` | always the Accessory phase's style — **General: 60% × 12, 60 s rest**, flat, never escalates |
| `primary`/`secondary` in Accumulation | Hypertrophy 80% × 8 · Powerbuilding 80% × 6 · Strength Accumulation 85% × 4 |
| `primary` in a **Peak** phase | **Peak 90% × 3** or **Max Strength 92% × 2** |

**`primary` and `secondary` resolve to the SAME style in every non-Peak phase of the owner's
program.** They diverge only under `peak`, where `secondary` falls back to the preceding phase's
style. So the load cliff is *accessory vs not*, and a primary/secondary mix-up is nearly free outside
Peak. Do not spend effort separating them.

`session-data.ts:299` shows it is not only load:
`lastSetMode = (ex.exerciseRole ?? 'primary') === 'primary' ? 'amrap' : 'plus1'` — an unclassified
exercise also takes an **AMRAP last set**, a set to failure at a percentage chosen for a compound.

---

## 2. The design

### Two creation paths

1. **Building a whole session** (AI generator, program builder) → the app nominates **one anchor as
   Primary** and fills the rest to the session shape. The owner asked for this explicitly: the anchor
   is bench for chest, squat for legs.
2. **Adding one exercise to a session that already has an anchor** → recommend Secondary or
   Accessory. Never take the anchor slot silently.
3. **Fallback for an exercise nobody classified** → `accessory` (already
   `UNCLASSIFIED_EXERCISE_ROLE`), because being wrong there under-loads instead of putting 90% × 3 on
   an unknown movement.

### Session shape scales with the configured time budget

`program_sessions.time_budget_minutes` already exists (`lib/data/postgres/schema.ts:114`, default
60) — read it, do not add a field.

```
n         = max(3, round(mins / 12))
primary   = mins < 80 ? 1 : 2
secondary = max(1, min(mins < 80 ? 2 : 3, n - primary - 1))
accessory = n - primary - secondary
```

| Budget | Exercises | Shape |
|---|---|---|
| 30 min | 3 | 1 P · 1 S · 1 A |
| 45 min | 4 | 1 P · 2 S · 1 A |
| **60 min** | **5** | **1 P · 2 S · 2 A** — matches 9 of 9 of the owner's 60-minute sessions |
| 75 min | 6 | 1 P · 2 S · 3 A |
| 90 min | 8 | 2 P · 3 S · 3 A |

**The 60-minute row is calibrated, not guessed.** An earlier version returned 3 Secondary at 60 min
and scored 83%; correcting it to 2 took the same rule to 90%. Do not re-tune without re-running §4.

### Anchor and role assignment

- **Anchor:** most muscles → barbell → earliest position. Ties on both keys fall to order.
- **Non-anchors:** rank by muscle count descending; the top `secondary` of them are Secondary;
  anything with ≤ 1 muscle is Accessory regardless; the rest are Accessory.

### Ordering is separate from role, and must stay that way

**The generator orders a new session Primary → Secondary → Accessory by default.** That is the
sensible default and the owner asked for it.

**Reordering must never change a role.** The owner's active Legs day opens with a hip thrust as
Secondary before the squat — a deliberate glute-activation choice — and dragging an exercise up the
list must not promote it. Verified 2026-08-24: **nothing in the codebase derives `exercise_role` from
`position`**, so this property holds today by construction. Keep it that way — an implementation that
re-derives roles on reorder would silently overwrite exactly this preference.

The two are orthogonal on purpose: `position` is the order you perform them in, `exercise_role` is
how they are loaded.

### Drift check

The same shape is the after-the-fact check — a session holding 3 Primary, or none, shows a nudge
(*"most sessions have 1–2 main lifts"*). A guideline, never a block.

### Override

Every recommendation is overridable in one tap, at creation or later, and the value is stored on the
slot (`session_exercises.exercise_role`). Nothing re-derives it on a later workout — set once, kept
until changed.

---

## 3. Four shapes that were REJECTED — do not revive them

1. **Position decides the role** (position 0 → Primary). **Rejected by the owner with a live
   counterexample:** their active Legs day is *Barbell Hip Thrust (Secondary) → Barbell Squat
   (Primary)*, glute activation before the main lift. Position would invert exactly the thing they
   programmed deliberately.
2. **Isolation always maps to Accessory.** **Rejected** — Dumbbell Lateral Raise is **Secondary** in
   *Main / Push Strength & Hypertrophy* and Accessory elsewhere. Same movement, different job. A
   chest-focused day can drive volume with an isolation movement.
3. **Never auto-assign Primary.** **Rejected by the owner** — they want the anchor chosen at creation.
4. **A remembered per-exercise role preference.** **Rejected as unnecessary** — the role already lives
   on the slot and never re-derives, so this solves a problem that does not exist.

---

## 4. The test that ships with it

Rebuild the rule as a unit test with the owner's five **active** sessions as the fixture and assert
it does not fall below **90%** (63 of 70 slots across 15 sessions, measured 2026-08-24, excluding the
retired all-primary `Strength + Hypertrophy` program).

```
Shikai (ACTIVE)   Legs 5/5   Push 5/5   Upper 5/5   Lower 4/5   Pull 3/5
AI-Phase1         Legs 5/5   Pull 5/5   Push 5/5    Upper 5/5   Lower 3/5
Main              Legs 4/4   Pull 4/4   Upper 4/4   Lower 3/4   Push 3/4
```

**The seven misses, so a future session does not re-investigate them:**

| Miss | Cause |
|---|---|
| Bulgarian Split Squat ↔ Barbell Good Morning (×2, one session) | **the only systematic fault** — anchor tie-break between two 3-muscle compounds; barbell beat dumbbell |
| Good Morning rec Primary, actual Secondary | *Shikai / Lower* has **no Primary at all**; the rule is arguably right and the stored data wrong |
| Barbell Shrug rec Accessory, actual Secondary | catalogue lists it as **1 muscle** — an under-recorded row, see BF-16 |
| Hammer Curl · Lateral Raise · Pull-Up | genuine judgement calls at the Secondary/Accessory line |

**Simulated fresh builds** (rule applied to plausible generator output; exercise *selection* is the
generator's job, only role assignment is in scope here):

```
PUSH 60min   Primary  Barbell Bench Press
             Secondary Barbell Overhead Press, Cable Chest Dips
             Accessory Dumbbell Lateral Raise, Tricep Cable Combo

LEGS 60min   Primary  Barbell Squat
             Secondary Barbell Romanian Deadlift, Barbell Hip Thrust
             Accessory Barbell Calf Raise, Hanging Leg Raise

LEGS 30min   Primary  Barbell Squat
             Secondary Barbell Romanian Deadlift
             Accessory Barbell Calf Raise

LEGS 30min, glute-first
             Secondary Barbell Hip Thrust      ← listed first, still Secondary
             Primary   Barbell Squat
             Accessory Barbell Calf Raise
```

---

## 5. The vocabulary (BF-17)

Two unrelated axes share near-synonymous vocabulary and collide on `secondary`:

| Axis | Stored in | Values |
|---|---|---|
| **Muscle** role | `exercise_library.muscles` JSONB | `main` \| `secondary` |
| **Exercise** role | `session_exercises.exercise_role` | `primary` \| `secondary` \| `accessory` |

**The UI already labels them backwards from each other, in the same card.**
`components/config/program-editor-sheet.tsx` renders both twenty lines apart: line 846 labels the
*exercise* value `primary` as **"Main Compound"**, line 872 labels the *muscle* value `main` as
**"PRIMARY"**. And the same exercise value renders differently per screen —
`components/workout-builder/builder-review.tsx:33` maps `primary → 'Main'` and
**`secondary → 'Compound'`**.

### The agreed vocabulary — one word per concept, matching the stored value

| Concept | The word, everywhere | Stored as |
|---|---|---|
| The lift the session is built around | **Primary** | `primary` |
| A compound that supports it | **Secondary** | `secondary` |
| Isolation / finishing work | **Accessory** | `accessory` |
| The muscle a lift is for | **Target** | `main` |
| A muscle that assists | **Assisting** | `secondary` |

`"Main"`, `"Main Compound"`, `"Secondary Compound"` and `"Compound"` are retired. **"Compound" is
actively wrong** as a label for `secondary` — an accessory can be compound too.

**Five files carry a visible label:** `components/config/program-editor-sheet.tsx` (both axes),
`components/workout-builder/builder-review.tsx`, `components/exercises/add-exercise-sheet.tsx`
(`title=` tooltips), `components/exercise-history-sheet.tsx:269` (*"Primary Muscles"*),
`components/admin/exercise-manager.tsx`.

### The data rename is DECLINED — do not implement it

Renaming the stored muscle value `main` → `target` was proposed and turned down on measured scope:
**85 non-test sites across 44 files**, 52 test sites, **149 production catalogue rows / 323 muscle
assignments**, one AI prompt string (`app/api/exercises/generate/route.ts:30`), and — the reason it
loses — **three hand-written raw-SQL copies** of `muscle_entry->>'role' = 'main'`
(`lib/data/postgres/slices/periodization.ts:415`, `app/api/muscle-tonnage-trend/route.ts:42`,
`app/api/weekly-muscle-sets/route.ts:45`). Missing one silently halves every muscle-volume number in
the app. `muscles.ts:29` calls itself "the canonical JS-side definition" and its own comment admits
the duplicates exist.

The labels above already stop the collision being visible, which is what the owner asked for. Revisit
only if the muscle system is being reworked for another reason.

---

## 6. The data corrections (BF-16)

**The owner's ACTIVE program needs no role corrections.** Split by program, 2026-08-24:

| Program | Active | Primaries per session |
|---|---|---|
| **Shikai** | **yes** | 1, 1, 1, 1, **0** |
| AI-Phase1 | no | 1 each |
| Main | no | 1 each |
| **Strength + Hypertrophy** | no | **5 of 5, 6 of 6, 6 of 6** |

An earlier count of "11 isolation movements at `primary`" was real but unsplit — almost all of it is
inside the retired `Strength + Hypertrophy`, where every exercise is `primary`: the old column
default doing exactly what BF-15 describes. Correcting a program nobody trains on may not be worth
doing; present it and let the owner decide.

**`Shikai / Lower` has no Primary at all** — the only live-program anomaly. BF-15's rule would
nominate Barbell Good Morning.

**Catalogue rows recorded thinner than their own sibling movement** — the real defect behind the
owner's *"hip thrusts and dumbbell shoulder press should be able to be a secondary"*, and a data
problem rather than a threshold problem:

| Exercise | Recorded | Its sibling | Missing |
|---|---|---|---|
| **Cable Chest Dips** | chest, triceps (2) | Barbell Bench Press (3) | shoulders |
| **Dumbbell Shoulder Press** | shoulders, triceps (2) | Barbell Overhead Press (3) | traps |
| **Barbell Hip Thrust** | glutes, hamstrings (2) | — | quads, lower back, adductors |
| **Cable Pulldown** | lats, biceps (2) | Chin-Up (3) | rear delts / rhomboids |
| **Barbell Shrug** | traps (1) | — | rhomboids, forearms |

These also feed the muscle heatmap and every weighted-set / tonnage tally (`roleWeight`,
`packages/shared/src/muscles.ts:29`, plus the three raw-SQL copies above), so fixing them is worth
more than the role recommendation alone.
