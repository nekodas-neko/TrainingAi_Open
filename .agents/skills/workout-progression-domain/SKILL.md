---
name: workout-progression-domain
description: Use this skill when working on workout logging, progression styles, 1RM/PR calculations, phase-based periodization, deloads, baseline weeks, or set/rep/weight targets. Also trigger when the user mentions 1RM, AMRAP, progression style, phase set, deload, baseline, or asks to change how sets, reps, weights, or percentages are calculated, displayed, or rounded.
---

# Workout & Progression Domain Logic

## No hardcoded session names (strict — see CLAUDE.md)

Session identity is the DB `id` (or `position`), never the name. Never write `if (sessionName === 'Push')` or similar — programs are fully user-defined. `components/workout/utils.ts`'s `SESSION_TO_TAB` is a known Sheets-era violation — don't extend it, remove it if you touch that file.

## Core formulas — `lib/1rm.ts`

| Function | Purpose | Notes |
|---|---|---|
| `calc1RM(weight, reps)` | Estimated 1-rep max | Average of Epley and Brzycki formulas. Reps ≥ 37 use Epley only (Brzycki diverges at high reps) |
| `calcAmrap1RM(weight, reps)` | 1RM for an AMRAP set | Applies a rep-band scale-down factor (1.0 at ≤5 reps, down to 0.82 at >20) because fatigue limits AMRAP reps more than true strength above ~10 reps |
| `calculate1RM(weights, reps, style?)` | Estimated 1RM + target80 for a logged exercise | Applies a **prescription-relative correction factor** per set (see below), then takes the max across the `useFor1rm` sets (or all sets if none flagged) |

`components/workout/utils.ts` still holds `mround125(value)` (round to nearest 1.25kg plate increment, clamped to `[5, 250]`) and `formatSetLoad` / `formatSetLoadParts` (display a set's weight/reps, collapsing to "X reps" for bodyweight exercises with zero added load). `lib/1rm.ts` has no "use client" directive and is safe to import from both server routes and client components.

**High-rep guard**: sets with reps > 30 are excluded from `calculate1RM`; AMRAP baseline sets cap reps at 36 before applying `calc1RM`. Don't remove these caps — without them the formulas produce absurd estimates (1.20.9, B12).

**Prescription-relative correction factor (session 1RM-decrease fix)**: Plugging a progression style's prescribed `(pct, reps)` straight into `calc1RM` *understates* the true 1RM for every standard style — e.g. hitting exactly 60%/12reps yields an estimate ~93% of the real 1RM, so estimates silently decayed every session even when the lifter matched the prescription exactly. `calculate1RM` corrects for this: for each set it computes `factor = 1 / ((pct/100) * repFactor(targetReps))` from that set's *prescribed* `pct`/`reps` (independent of what was actually performed), and multiplies `calc1RM(actualWeight, actualReps)` by it. Hitting the prescription exactly now reproduces a stable 1RM; exceeding it raises the estimate, falling short lowers it — recalculated fresh every session (no all-time-PR pinning). Sets with no `pct`/`reps` on the style (or no style at all) get `factor = 1`, i.e. plain `calc1RM`.

## Progression styles

`progression_styles` + `style_sets` tables — each style is a named sequence of per-set `{ pct, reps, restSec, useFor1rm }`. Programs reference styles **by UUID**, never by name. Rest times are percentage-driven (e.g. 80% intensity → 120s rest, 90% → 180s).

## Phase-based periodization

`program_phases` define a sequence (Accumulation → Intensification → Peak → Deload → Testing, plus Accessory) each with a Primary/Secondary progression style and a cycle-count duration. Key rules:
- **Accessory** phase type always uses the Accessory style regardless of the current block phase
- **Deload** sessions are excluded from all stats aggregates (volume, sets, intensity, duration, ACWR chronic window) and marked with an amber "D" badge
- **Baseline week** (optional, toggled in builder): prepends an AMRAP test cycle; exercises show "AMRAP Test" instead of set targets, set card badge shows "A"
- **Phase set ownership** (session 91): customizing a phase's cycle length auto-clones it as a private per-program copy named `"<template> (<program name>)"`; renaming/deleting a program cascades to its owned clones; built-in templates (Strength, Hypertrophy, S+H, Powerbuilding, Baselining, Linear Progression) are read-only "Default" templates — clone before customizing

## Bodyweight exercises

`exerciseType: 'bodyweight'` — UI shows reps as the primary control with a collapsible "Add weight" for weighted/assisted variants. 1RM/PR/intensity % factor in **logged bodyweight + added/assisted load**. Set targets, warmup suggestions, and "Next Session" weight targets are hidden (they don't apply).

## Visual conventions

`SET_COLORS = ["#f59e0b", "#22c55e", "#8b5cf6"]` (amber/green/violet) — used consistently for set index across the timer ring, set cards, and training-load legends. Reuse this palette (indexed `i % SET_COLORS.length`) for any new per-set visualization rather than picking new colors.
