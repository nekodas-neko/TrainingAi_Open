# 2026-09-26 — three from one Home screenshot: a button that does nothing, a button nothing makes room for, and a wall of grey text (BF-205 / BF-206 / BF-207)

The owner's second pass over Home after trying the cat collection produced three separate reports.
Each traced to a different cause, so each got its own entry.

## BF-205 — "Reorder sections" cannot reorder

Not a broken drag. **There is no drag.** `HomeSortableSection` is named *Sortable*, takes an `id`,
and is thirty lines holding one hide button — no `useSortable`, no `DndContext`, no pointer handler.
`@dnd-kit` is a dependency and `components/config/sortable-row.tsx` uses it; the Home surface never
imports it.

Everything around the gesture exists, which is why it reads as broken rather than missing: the
header button, `aria-pressed`, the persisted `sectionOrder`, and a `sectionOrderRef` whose comment
says *"so drag/sync handlers can read it synchronously"*. Only the `/sync` half was written.

Settled by enumeration rather than by reading around it: `setSectionOrder` has four call sites — the
initial state, two loads from storage, and the reconciliation that runs when a widget is toggled in
More. No code path anywhere turns user input into a new order.

## BF-206 — the Coach button, two problems in one control

**The reserved space is one control short.** Home's scroll container uses `pb-nav-safe`
(`3.5rem + inset + 0.75rem`) — the nav bar only. The FAB is `bottom-fab-safe` and `h-14`, so its top
edge is **56 px above the reserved padding**, and the bottom 56 px of the scroll on the right can
never clear it. On the screenshot that is the day-timeline's workout row.

**Nothing identifies it.** A sparkle in a filled circle, named only by `aria-label`. The sparkle is
the app's generic AI mark — it also appears on the weekly-recap banner, the meal-source row and the
profile tab — so it names a category, not a destination.

**One suspicion checked and dropped:** the stark white circle looked like a contrast outlier.
`bg-foreground text-background` is the repo's standard filled-control treatment across segmented
tabs, coach messages, macro targets, the goal toggles and the calendar's today cell. Consistent, so
not the thing to change. Checking it first is what kept it out of the entry.

## BF-207 — the explanation is the wrong shape, not the wrong words

`Rules()` is four paragraphs, **177 words**, all at 12 px in `text-muted-foreground`. The prose is
good and interpolates every number from the engine's constants, so it cannot drift from the fold —
a property worth keeping through any redesign. What it explains is four pictures: three small cats
becoming one big one says the merge rule without words.

Filed `Lane: O` because it is a judgement about looks, with a recommendation attached and the
sequencing noted — PS-49 changes every number on that page, so the redesign belongs after it.

## Not exercised

Docs-only; nothing ran. BF-205 and BF-206 both owe a device check, and BF-206's needs **both**
navigation modes: a three-button nav reports every safe-area inset as `0`, which makes a broken
clearance look correct.
