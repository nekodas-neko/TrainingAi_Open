# Phase Progression Timeline in Builder Review

**Date:** 2026-06-05  
**Status:** Approved

## Goal

Show the phase progression (Accumulation → Intensification → Peak → Testing → Deload) in the AI builder review screen so users understand what their program will cycle through before saving.

## Affected Files

| File | Change |
|------|--------|
| `lib/types/builder.ts` | Add `GeneratedPhase` interface; add `phases` field to `GeneratedProgram` |
| `app/api/generate-program/route.ts` | Populate `phases` in the response using resolved style names |
| `components/workout-builder/builder-review.tsx` | Render the phase block between header and sessions |

## Data Flow

The `generate-program` route already holds:
- `phaseSet.phases` — the ordered phases for the selected phase set
- `userStyles` — all user progression styles (id + name)

A reverse map `styleById: Map<string, string>` (id → name) is built from `userStyles`.

The response includes a new `phases` array, filtered to exclude accessory phases (phaseType `'accessory'`, always duration 0), mapped to:

```ts
interface GeneratedPhase {
  name: string            // e.g. "Accumulation"
  durationCycles: number  // e.g. 4
  phaseType: string       // 'normal' | 'peak' | 'deload' | 'testing'
  primaryStyleName?: string // resolved style name, e.g. "General 4-set"
}
```

## UI Block

Positioned between the sticky header and the sessions list inside the scrollable area.

**Layout per row:**

```
Phase name (sm, normal weight)   N cycle(s) · style info (xs, muted)
```

- Phase name: `text-sm font-medium`
- Right side: `text-xs text-muted-foreground` — `N cycle · <style>`
- Style text: derived from `STYLE_DISPLAY[primaryStyleName]` by stripping everything from ` ·` onward (removes rest time)
- Testing phases: fixed label "Test day" (ignore style)
- Deload phases: fixed label "Recovery" (ignore style)
- No separator arrows — clean list rows are sufficient at this density

**Container:** `rounded-xl bg-muted p-3 space-y-1.5` inside `px-4 py-3`, same card style as session cards.

**Section label:** `text-xs font-semibold text-muted-foreground uppercase tracking-wide` above the card, consistent with the "Chat with AI" label below.

## Edge Cases

- If `phases` is missing or empty (e.g. old cached responses): block is not rendered — guarded with `program.phases?.length > 0`
- Single-cycle phases: "1 cycle" (not "1 cycles")
- Style name not in `STYLE_DISPLAY`: show the raw style name as fallback

## Out of Scope

- No interactivity (non-tappable)
- No collapsing
- No editing from this screen
