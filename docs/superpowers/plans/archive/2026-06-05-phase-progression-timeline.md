> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Phase Progression Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the phase progression (Accumulation → Intensification → Peak → Testing → Deload) in the AI builder review screen so users can see what their program will cycle through before saving.

**Architecture:** Add a `phases` array to the `GeneratedProgram` type and populate it in the `generate-program` API route by resolving style UUIDs to names. Render a compact read-only phase block in `builder-review.tsx` between the header and the sessions list.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS v4

---

## Files

| File | Action |
|------|--------|
| `lib/types/builder.ts` | Add `GeneratedPhase` interface; add `phases` field to `GeneratedProgram` |
| `app/api/generate-program/route.ts` | Build `styleById` reverse map; populate `phases` in response |
| `components/workout-builder/builder-review.tsx` | Render phase block between header and sessions list |

---

### Task 1: Add `GeneratedPhase` type and `phases` field

**Files:**
- Modify: `lib/types/builder.ts`

- [ ] **Read the file first**

```bash
cat lib/types/builder.ts
```

- [ ] **Add `GeneratedPhase` interface and `phases` to `GeneratedProgram`**

Open `lib/types/builder.ts`. After the `GeneratedSession` interface, add:

```ts
export interface GeneratedPhase {
  name: string
  durationCycles: number
  phaseType: string
  primaryStyleName?: string
}
```

Then add `phases: GeneratedPhase[]` to `GeneratedProgram`:

```ts
export interface GeneratedProgram {
  name: string
  sessions: GeneratedSession[]
  phaseStructureName: string
  phaseSetId: string
  reasoning: string
  phases: GeneratedPhase[]
}
```

- [ ] **Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors (the field is new, no existing code references it yet).

- [ ] **Commit**

```bash
git add lib/types/builder.ts
git commit -m "feat: add GeneratedPhase type and phases field to GeneratedProgram"
```

---

### Task 2: Populate `phases` in the generate-program API response

**Files:**
- Modify: `app/api/generate-program/route.ts`

- [ ] **Read the relevant section**

The `programJson` object is built around line 376. The `styleByName` map (name → id) is defined at line 357. The `phaseSet` variable (type `PhaseSetWithPhases`) is resolved around line 361 and has a `.phases` array of `ProgramPhase` objects, each with `primaryStyleId?: string`.

- [ ] **Add `styleById` reverse map directly after `styleByName`**

Find this line (around line 357):
```ts
const styleByName = new Map(userStyles.map(s => [s.name, s.id]))
```

Add immediately after:
```ts
const styleById = new Map(userStyles.map(s => [s.id, s.name]))
```

- [ ] **Add `phases` to `programJson`**

Find the closing of `programJson` (around line 414–416):
```ts
      phaseStructureName: phaseSet.name,
      phaseSetId: phaseSet.id,
    }
```

Replace with:
```ts
      phaseStructureName: phaseSet.name,
      phaseSetId: phaseSet.id,
      phases: phaseSet.phases
        .filter(p => p.phaseType !== 'accessory')
        .sort((a, b) => a.position - b.position)
        .map(p => ({
          name: p.name,
          durationCycles: p.durationCycles,
          phaseType: p.phaseType,
          primaryStyleName: p.primaryStyleId ? styleById.get(p.primaryStyleId) : undefined,
        })),
    }
```

- [ ] **Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add app/api/generate-program/route.ts
git commit -m "feat: include resolved phase progression in generate-program response"
```

---

### Task 3: Render the phase block in builder-review

**Files:**
- Modify: `components/workout-builder/builder-review.tsx`

- [ ] **Read the file around the STYLE_DISPLAY map (lines 25–40) and the return JSX (around line 200)**

The `STYLE_DISPLAY` map values look like `'4 × 8 @ 70% · 75s rest'`. The phase display should show only the part before ` ·`, e.g. `'4 × 8 @ 70%'`.

The scrollable content area starts at line ~213 with `{/* Sessions */}`.

- [ ] **Add `phaseStyleShort` helper function**

Add this pure function above the component (after the `STYLE_DISPLAY` constant):

```ts
function phaseStyleShort(styleName?: string): string {
  if (!styleName) return ''
  const full = STYLE_DISPLAY[styleName]
  if (!full) return styleName
  return full.split(' · ')[0]
}
```

- [ ] **Add the phase progression block to the JSX**

Find this in the return JSX (around line 213–215):
```tsx
      <div className="flex-1 overflow-y-auto">
        {/* Sessions */}
        <div className="px-4 py-3 space-y-4">
```

Replace with:
```tsx
      <div className="flex-1 overflow-y-auto">
        {/* Phase Progression */}
        {(program.phases?.length ?? 0) > 0 && (
          <div className="px-4 pt-3 pb-1 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phase Progression</p>
            <div className="rounded-xl bg-muted p-3 space-y-1.5">
              {program.phases.map((phase, i) => {
                const cycleLabel = `${phase.durationCycles} ${phase.durationCycles === 1 ? 'cycle' : 'cycles'}`
                const styleLabel =
                  phase.phaseType === 'testing' ? 'Test day'
                  : phase.phaseType === 'deload' ? 'Recovery'
                  : phaseStyleShort(phase.primaryStyleName)
                return (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{phase.name}</p>
                    <p className="text-xs text-muted-foreground text-right">
                      {cycleLabel}{styleLabel ? ` · ${styleLabel}` : ''}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Sessions */}
        <div className="px-4 py-3 space-y-4">
```

- [ ] **Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add components/workout-builder/builder-review.tsx
git commit -m "feat: show phase progression timeline in builder review"
```

---

### Task 4: Push to main

- [ ] **Push**

```bash
git push origin main
```

Expected: remote accepts the push and Railway auto-deploy triggers.

- [ ] **Manual test checklist**
  1. Open the AI builder and generate a program with any goal
  2. On the review screen, confirm a "Phase Progression" section appears above the sessions list
  3. Each phase row shows: phase name (left) + "N cycle(s) · sets×reps@%" (right)
  4. Testing row shows "Test day", Deload row shows "Recovery"
  5. Generate with a different goal (e.g. Strength vs Hypertrophy) — confirm phase names and styles differ
  6. Confirm no phase row for "Accessory" (it is filtered out)
