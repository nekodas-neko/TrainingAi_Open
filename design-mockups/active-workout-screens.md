# Active Workout Screen Redesign — Mockups

> Live preview: navigate to `/workout-mockup` on the deployed app.
> Source: `app/workout-mockup/page.tsx`

---

## Overview

Three screen states to redesign. Current implementation is functional but the visual hierarchy is flat — everything has similar visual weight. The goal is to make each state feel distinct and purposeful.

---

## Screen 1 — Ready (before starting the set clock)

**What it is:** Shown when you tap an exercise before starting. Currently: centred text, small set targets block, small 1RM chart, muscle chips.

**Redesign direction:**
- Gradient hero header (brand colour bleeds from top ~30% then fades to background)
- Exercise name in large black type (`text-4xl font-black`)
- 1RM badge + set count inline below name
- **Set targets card** — each set row shows:
  - Set number chip (brand-tinted square)
  - Horizontal weight bar (width = % of 1RM, brand colour)
  - `{pct}% of 1RM` label below bar
  - `{weight} kg × {reps} reps` right-aligned
- **1RM trend chart** — small area chart, same as current but in a card with "Last 6 sessions · X → Y kg" footer
- **Muscle chips** — main muscles filled/brand, secondary muscles outlined/muted
- Footer: Skip button (outline square) + large "Start Set 1" pill

**Key changes from current:**
- Gradient header makes exercise name feel like the hero
- Weight bars give an at-a-glance intensity profile across all sets
- Targets card is more compact and visually structured than the current list

---

## Screen 2 — Active Set (timer running, logging in progress)

**What it is:** After tapping Start. Currently: exercise name, warmup strip, stacked set cards (done/active/upcoming).

**Redesign direction:**
- Header: back arrow | exercise name + elapsed | 1RM calculator icon
- **Progress dots** just below header — dots widen for current set, green for done, grey for upcoming
- **Current set hero card** (brand border, brand-tinted background):
  - "▶ Active" pill badge top-left + `{pct}% 1RM` top-right
  - Weight column: +/− buttons above/below a large `text-4xl` number
  - Reps column: same +/− pattern
  - Separator `×` between them
- **Done sets** — compact green chips: tick icon | "Set N" | `{weight} kg × {reps}` | set time
- **Upcoming sets** — dimmed rows (`opacity-55` for next, `opacity-25` for rest)
- Footer: Skip (outline square) + large "Log Set N" gradient pill

**Key changes from current:**
- Progress dots give positional context without cluttering the screen
- Current set takes 50%+ of content area — weight/reps are the focus
- Done sets collapse to small chips (was full-height cards — caused scroll with 4+ sets)
- Upcoming sets are clearly deprioritised but still visible

---

## Screen 3 — Rest Timer (between sets)

**What it is:** After logging a set, rest timer runs. Currently: compact horizontal row inline with set cards (60px ring + progress bar).

**Redesign direction:**
- Header: back arrow | exercise name + elapsed
- Progress dots (same as active, now shows N sets done)
- **Large circular timer hero** (~200px diameter):
  - Thin track ring behind
  - Brand-colour arc fills as rest elapses
  - Large `text-[42px] font-[800]` countdown seconds in centre
  - "seconds" label below
  - "tap to skip" hint
  - Entire circle is a tap target (skip rest)
- **Next set preview card** below the timer:
  - "Up next — Set N" label
  - Three values side by side: `{weight} kg` | `×` | `{reps} reps` | `{pct}% 1RM`
- Footer: "Start Set N early" button (brand ghost style — not full fill, avoids accidental taps)

**Key changes from current:**
- Rest timer is now the entire screen — makes the rest feel intentional, not an afterthought
- Next set info is immediately visible so athlete can mentally prepare
- Ghost-style CTA reduces accidental early starts vs. a full-fill button

---

## Design Tokens Used

All screens use existing CSS variables — no new colours:

| Token | Usage |
|---|---|
| `var(--color-brand)` | Active accents, progress arcs, CTAs |
| `color-mix(in oklch, var(--color-brand) N%, ...)` | Tinted backgrounds, borders |
| `var(--background)` | Screen base |
| `var(--muted-foreground)` | Secondary labels |
| `rgba(34,197,94,...)` | Done/logged state (green — fixed, not themed) |

---

## What's Not Addressed Yet

- **Exercise summary screen** (after all sets logged, before next exercise) — current design is fine, low priority
- **Swipe to skip/go back** between exercises — would need gesture handling
- **Volume/intensity feedback** during the set (e.g. "this is your heaviest set") — could appear in the active card header
- **Warmup weights** — currently on the active screen as a strip above set cards. Not yet placed in the redesign (could go in the Ready screen's set targets card as a "Warmup" section above the working sets)
