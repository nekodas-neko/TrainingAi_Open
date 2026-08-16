# UI / Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the nutrition module and a few scattered screens up to the app's established UI standard — shared Radix sheets, 44dp touch targets, safe-area insets, aria-labels, and consistent loading/error states.

**Architecture:** The app already has a shared Radix `<Sheet>` (`components/ui/sheet.tsx`), a shared `<Button>` (`components/ui/button.tsx`), `sonner` toasts installed, and a centralized `accentCardStyle()` (Samsung WebView fix). The nutrition module predates these and hand-rolls sheets/buttons. The fix is to migrate it onto the shared primitives, which resolves consistency, a11y, AND safe-area gaps in one move.

**Tech Stack:** Tailwind v4, Radix UI, shadcn/ui, `sonner`, `motion`.

> Target device: Samsung Galaxy S25 Ultra. Verify on-device or at S25-Ultra viewport.

---

## Findings addressed

| # | Sev | Area | Location |
|---|-----|------|----------|
| U1 | **Med** | Hand-rolled sheets bypass Radix | `food-logger-sheet.tsx:269`, `food-library-sheet.tsx:47`, `quick-edit-log-sheet.tsx:56`, `components/ai/chat-overlay.tsx:111` |
| U2 | **Med** | No error UX anywhere (`.catch(()=>{})`) | health/nutrition/stats/more/friends content files |
| U3 | **Med** | Icon-only buttons missing `aria-label` + <44dp | ~15 sites across `components/nutrition/*` |
| U4 | **Med** | Missing bottom safe-area in sheets | `food-logger-sheet.tsx:270`, `stats-content.tsx:259`, `health-content.tsx:1188` |
| U5 | **Med** | Bare "Loading…" / "…" with layout shift | `nutrition-content.tsx:145`, `session-select-content.tsx:1185+` |
| U6 | **Low** | Hand-rolled primary buttons bypass `<Button>` | 11 sites in `components/nutrition/*` |
| U7 | **Low** | Card padding/radius inconsistency | `session-select-content.tsx:909`, `activity/done-activity-screen.tsx:78` |

> Excluded (already ✅ in projectOverview.md): B8 willChange, B11 small Log buttons, B13 done-screen safe-area, B10 sheet back-dismiss. No NEW Samsung WebView compositor violations were found.

---

## Task 1: Migrate the food-logger sheet to the shared Radix `<Sheet>` (U1, U3, U4)

**Files:**
- Modify: `components/nutrition/food-logger-sheet.tsx`
- Reference: `components/ui/sheet.tsx` (the shared primitive), and an existing migrated example — `grep -ln "from '@/components/ui/sheet'" components` to find one.

Migrating to `<Sheet>` fixes three findings at once: focus-trap/`role=dialog` a11y, the missing bottom safe-area, and the competing-pattern inconsistency.

- [ ] **Step 1: Read a reference Sheet usage**

Run: `grep -rln "SheetContent" components | head -3` then Read one (e.g. a health sheet) to copy the open/close prop pattern (`<Sheet open onOpenChange>` + `<SheetContent side="bottom">`).

- [ ] **Step 2: Replace the hand-rolled overlay container**

In `food-logger-sheet.tsx`, replace the `fixed inset-x-0 bottom-0 rounded-t-2xl bg-background` wrapper (≈269-270) and its manual backdrop with:

```tsx
<Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
  <SheetContent
    side="bottom"
    className="rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[90vh] overflow-y-auto"
  >
    {/* existing sheet body */}
  </SheetContent>
</Sheet>
```

Remove the hand-rolled backdrop div and the manual `useSheetBackDismiss` call only if `<Sheet>` already provides back-dismiss (verify; if not, keep the hook).

- [ ] **Step 3: Replace the close button**

Radix `<SheetContent>` provides its own close affordance. Remove the custom `p-1` X button (≈273), or if kept, give it `aria-label="Close"` and bump to `p-2.5`.

- [ ] **Step 4: Visual check + commit**

Run: `pnpm dev`, open the food logger from the Health tab. Confirm: opens as a bottom sheet, dismisses on backdrop tap and Android back, footer button clears the gesture-nav bar, focus is trapped.

```bash
git add components/nutrition/food-logger-sheet.tsx
git commit -m "Migrate food-logger to shared Radix Sheet (a11y + safe-area)"
```

---

## Task 2: Migrate food-library and quick-edit sheets (U1, U3)

**Files:**
- Modify: `components/nutrition/food-library-sheet.tsx:47`
- Modify: `components/nutrition/quick-edit-log-sheet.tsx:56`

- [ ] **Step 1:** Apply the same `<Sheet>/<SheetContent side="bottom">` migration as Task 1 to both files. Both already include `pb-[env(safe-area-inset-bottom)]` — preserve it (or rely on `SheetContent`'s).

- [ ] **Step 2:** Add `aria-label` to any retained icon-only buttons (close X, search-clear X) and bump `p-1.5` → `p-2.5`.

- [ ] **Step 3: Visual check + commit**

```bash
git add components/nutrition/food-library-sheet.tsx components/nutrition/quick-edit-log-sheet.tsx
git commit -m "Migrate food-library and quick-edit sheets to shared Radix Sheet"
```

---

## Task 3: Add aria-labels + larger targets to nutrition icon buttons (U3)

**Files:**
- Modify: `components/nutrition/saved-meals-sheet.tsx` (back ≈228, edit/delete ≈265/268, qty ≈322/326)
- Modify: `components/nutrition/meal-type-manager.tsx` (edit/delete ≈38/41)
- Modify: `components/nutrition/meal-builder-sheet.tsx` (qty/trash ≈184/191/197)

- [ ] **Step 1: Add aria-labels**

For each icon-only button, add a descriptive `aria-label` (e.g. `aria-label="Increase quantity"`, `"Decrease quantity"`, `"Edit meal"`, `"Delete meal"`, `"Back"`, `"Remove item"`).

- [ ] **Step 2: Enlarge sub-44dp targets**

Bump quantity +/− buttons `w-7 h-7` → `w-9 h-9` (or `w-10 h-10`); bump `p-1.5` icon buttons → `p-2.5`. Keep icon glyph size; only the hit area grows.

- [ ] **Step 3: Visual check + commit**

Run: `pnpm dev`, exercise the saved-meals / meal-builder flows; confirm taps register comfortably and layout doesn't break.

```bash
git add components/nutrition/saved-meals-sheet.tsx components/nutrition/meal-type-manager.tsx components/nutrition/meal-builder-sheet.tsx
git commit -m "Add aria-labels and enlarge touch targets on nutrition icon buttons"
```

---

## Task 4: Add a shared fetch-error toast (U2)

**Files:**
- Create: `lib/ui/fetch-with-toast.ts` (small wrapper) OR add `.catch` handlers inline
- Modify: representative content files that currently swallow errors

`sonner` is already installed. The goal is that a network failure shows a toast instead of looking like empty data.

- [ ] **Step 1: Confirm the toast API**

Run: `grep -rn "from 'sonner'\|toast(" components app | head`
Confirm `import { toast } from 'sonner'` and a `<Toaster />` is mounted (check `app/layout.tsx`). If no `<Toaster />`, add one in the layout.

- [ ] **Step 2: Add a tiny helper**

Create `lib/ui/fetch-with-toast.ts`:

```ts
import { toast } from 'sonner'

export async function fetchJson<T>(url: string, opts?: RequestInit, errMsg = 'Something went wrong'): Promise<T | null> {
  try {
    const res = await fetch(url, opts)
    if (!res.ok) throw new Error(`${res.status}`)
    return (await res.json()) as T
  } catch {
    toast.error(errMsg)
    return null
  }
}
```

- [ ] **Step 3: Replace silent `.catch(()=>{})` at user-initiated write sites**

Focus on WRITE/action paths first (logging food, saving meals, deleting) where silent failure is most confusing — replace `.catch(() => {})` with a `toast.error(...)`. Leave passive background reads (warm fetches) silent to avoid noise. Do NOT mass-replace every read; target the ~6 action handlers in `health-content.tsx`, `nutrition-content.tsx`, the food/meal sheets.

- [ ] **Step 4: Visual check + commit**

Run: `pnpm dev`, kill the network (DevTools offline), try to log food — a toast appears instead of silent nothing.

```bash
git add lib/ui/fetch-with-toast.ts app/health/health-content.tsx app/nutrition/nutrition-content.tsx components/nutrition/*.tsx
git commit -m "Surface fetch failures with a toast on user-initiated actions"
```

---

## Task 5: Replace bare loading text with skeletons (U5)

**Files:**
- Modify: `app/nutrition/nutrition-content.tsx:145`
- Modify: `app/session-select/session-select-content.tsx` (metric tiles ≈1185-1301)

- [ ] **Step 1: Nutrition screen skeleton**

Replace the bare `"Loading…"` at `nutrition-content.tsx:145` with the `animate-pulse` skeleton pattern used by health/pre-workout (copy their skeleton markup — `grep -rn "animate-pulse" app/health components/workout/pre-workout-screen.tsx`).

- [ ] **Step 2: Height-lock the metric tiles**

For the home metric tiles that render `"…"` before swapping to a value, give the tile a fixed min-height (e.g. `min-h-[...]` matching the loaded state) so the value swap doesn't cause layout shift.

- [ ] **Step 3: Visual check + commit**

Run: `pnpm dev`, throttle network, load Nutrition + Home — no bare text flash, no jump.

```bash
git add app/nutrition/nutrition-content.tsx app/session-select/session-select-content.tsx
git commit -m "Use skeletons and height-locked tiles to remove loading layout shift"
```

---

## Task 6 (Low): Standardize nutrition primary buttons + card padding (U6, U7)

**Files:**
- Modify: the 11 hand-rolled `rounded-xl bg-foreground text-background` buttons in `components/nutrition/*`
- Modify: `session-select-content.tsx:909` (`p-3` → `p-4`), `activity/done-activity-screen.tsx:78` (`rounded-xl`→`rounded-2xl`, `px-2 py-3`→`p-4`)

- [ ] **Step 1: Replace hand-rolled primary buttons with `<Button>`**

Swap `<button className="rounded-xl bg-foreground text-background px-3 py-1.5 ...">` for the shared `<Button>` (default variant). Read `components/ui/button.tsx` for the available variants/sizes first. This gives consistent focus ring + disabled state.

- [ ] **Step 2: Align card padding**

Set the flagged cards to the dominant `rounded-2xl p-4` convention used by their sibling cards.

- [ ] **Step 3: Visual check + commit**

```bash
git add components/nutrition app/session-select/session-select-content.tsx app/activity/done-activity-screen.tsx
git commit -m "Standardize nutrition buttons and card padding on shared primitives"
```

---

## Verification before completion (whole plan)

- [ ] Run: `pnpm exec tsc --noEmit && pnpm lint` — PASS.
- [ ] Manual at S25-Ultra viewport (`pnpm dev`, DevTools device toolbar 1440×3120 / DPR): open every nutrition sheet — all dismiss via backdrop + Android back, footer buttons clear the nav bar, focus is trapped, screen-reader announces icon buttons (check via DevTools accessibility tree).
- [ ] Manual: offline → a write action shows an error toast.
- [ ] Push: `git push -u origin claude/app-comprehensive-audit-goew61`.

## Local testing notes (per CLAUDE.md)
- **Pull:** `git pull origin claude/app-comprehensive-audit-goew61`
- **What to look for:** nutrition sheets now look/behave like the rest of the app; icon buttons are larger and labelled; loading no longer flashes bare text; failed actions toast.
- **Regression to check:** the nutrition logging flow end-to-end (search food → log → appears in today's list) after the sheet migration.
