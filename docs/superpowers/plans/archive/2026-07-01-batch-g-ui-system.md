# Batch G — UI System & Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the missing shared UI primitives (SegmentedTabs, ConfirmDialog, EmptyState, ScreenHeader, Skeleton), fix the gym-floor ergonomics gaps (workout-tab guard, 44px tap targets, tiny text, color-only status), add root error/loading states, standardize back navigation, delete dead UI, and split the two largest screen components — all with zero behaviour change except where a fix is the point.

**Architecture:** Each primitive is a small client component in `components/ui/` following the repo's existing cva/cn idioms (see `components/ui/button.tsx`). Call-site migrations are mechanical find-and-replace batches, each its own commit so regressions bisect cleanly. The two big-file splits are pure moves (extract-by-symbol into hooks/child components), verified by `npx tsc --noEmit` + manual smoke.

**Tech Stack:** React 19, Tailwind v4, Radix (`@radix-ui/react-toggle-group` may need install — check first; fall back to a controlled button row), class-variance-authority, `cn` from `lib/utils`. Tests via the repo's existing vitest setup (`pnpm test`); UI tasks are mostly manual-verify on the Samsung Galaxy S25 Ultra viewport (~412×915 logical px in devtools).

**Ground rules for every task:** pnpm only; never hardcode session names; run `pnpm lint && npx tsc --noEmit` before each commit; human-style commit messages (no AI attribution).

---

## Phase 1 — Primitives

### Task 1: `<SegmentedTabs>` primitive

The identical pill-tab row is copy-pasted ~17× with drifting font sizes (`text-sm` in health, `text-xs` in more). One controlled component, no Radix dependency needed (the pattern is a simple exclusive button row; keyboard/a11y added via `role="tablist"`).

**Files:**
- Create: `components/ui/segmented-tabs.tsx`
- Test: manual (below) — pure presentational; no unit test.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { cn } from "@/lib/utils";

interface SegmentedTabsProps<T extends string> {
  tabs: readonly { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
  size?: "sm" | "xs";
  className?: string;
}

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  size = "sm",
  className,
}: SegmentedTabsProps<T>) {
  return (
    <div role="tablist" className={cn("flex gap-1", className)}>
      {tabs.map(t => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onValueChange(t.value)}
          className={cn(
            "flex-1 rounded-xl py-2 font-semibold transition-colors min-h-11",
            size === "sm" ? "text-sm" : "text-xs",
            value === t.value
              ? "bg-foreground text-background"
              : "bg-muted/50 text-muted-foreground hover:bg-muted",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Migrate the first call site (health-content) as the reference**

Modify `app/health/health-content.tsx` (~line 778) — replace the inline `TABS.map(...)` button row:

```tsx
// before (delete):
<div className="flex gap-1 px-4 pt-3 pb-0 shrink-0">
  {TABS.map(t => (
    <button key={t} onClick={() => setTab(t)}
      className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-colors ${
        tab === t ? "bg-foreground text-background" : "bg-muted/50 text-muted-foreground hover:bg-muted"
      }`}>
      {t === "body" ? "Body" : t === "training" ? "Training" : "Progress"}
    </button>
  ))}
</div>

// after:
<SegmentedTabs
  className="px-4 pt-3 pb-0 shrink-0"
  tabs={[
    { value: "body", label: "Body" },
    { value: "training", label: "Training" },
    { value: "progress", label: "Progress" },
  ] as const}
  value={tab}
  onValueChange={setTab}
/>
```

Add the import: `import { SegmentedTabs } from "@/components/ui/segmented-tabs";`

- [ ] **Step 3: Verify** — `pnpm dev`, open `/health`: tabs render identically, switching + the swipe carousel still work, active tab keeps the inverted pill style.

- [ ] **Step 4: Enumerate every remaining call site**

Run: `grep -rln 'bg-foreground text-background' app components --include='*.tsx'`
Expected files include (from the review; the grep is authoritative): `app/health/health-content.tsx` (done), `app/more/more-content.tsx:100-114` (uses `text-xs` → `size="xs"`), `app/stats/stats-content.tsx`, `components/profile/macro-targets-pane.tsx`, `components/profile/goal-targets-section.tsx`, `components/nutrition/assign-step.tsx`, `components/more/friend-leaderboard.tsx`, plus ~10 more.

- [ ] **Step 5: Migrate the rest in 2–3 grouped edits** (profile group, nutrition group, remaining), following the exact Step-2 pattern: `tabs` array from the mapped values, `value`/`onValueChange` from the existing state, keep each site's current font size via `size`. Where labels are computed (e.g. `t.charAt(0).toUpperCase()...` in more-content), compute them once in the `tabs` array literal.

- [ ] **Step 6: Verify each migrated screen** in `pnpm dev` (More, Stats, Profile panes, Nutrition assign sheet, Leaderboard) — identical render, switching works.

- [ ] **Step 7: Commit**

```bash
git add components/ui/segmented-tabs.tsx app components
git commit -m "Extract SegmentedTabs and replace the copy-pasted pill tab rows"
```

### Task 2: `<ConfirmDialog>` primitive

Four near-identical outline-Stay / destructive-Confirm dialogs exist.

**Files:**
- Create: `components/ui/confirm-dialog.tsx`
- Modify: `components/workout/confirm-leave-dialog.tsx` (delete after migration), `components/shell/bottom-nav.tsx:114-136`, `components/workout-builder/builder-wizard.tsx` (its discard confirm), `components/activity/done-activity-screen.tsx` (its discard confirm)

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant={variant} className="flex-1" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Migrate bottom-nav's inline dialog** (`components/shell/bottom-nav.tsx:114-136`):

```tsx
<ConfirmDialog
  open={!!pendingHref}
  onOpenChange={(o) => { if (!o) setPendingHref(null); }}
  title="Leave workout?"
  message="Your workout is in progress. Leaving now will end the session and unsaved sets will be lost."
  confirmLabel="Leave"
  cancelLabel="Stay"
  onConfirm={() => {
    const href = pendingHref!;
    setPendingHref(null);
    resetSession();
    router.push(href);
  }}
/>
```

Remove the now-unused `Dialog/DialogContent/DialogHeader/DialogTitle` imports from bottom-nav if nothing else uses them.

- [ ] **Step 3: Migrate the other three** the same way — `confirm-leave-dialog.tsx` callers switch to `<ConfirmDialog title="Leave this exercise?" message="Sets in progress won't be saved if you leave now." confirmLabel="Leave" cancelLabel="Stay" …/>`, then delete `components/workout/confirm-leave-dialog.tsx`; builder-wizard and done-activity-screen keep their exact current copy strings.

- [ ] **Step 4: Verify** — trigger all four flows in `pnpm dev` (leave mid-exercise, tap another tab mid-workout, discard in builder, discard a done activity). Identical behaviour.

- [ ] **Step 5: Commit**

```bash
git add components
git commit -m "Extract ConfirmDialog and unify the four leave/discard dialogs"
```

### Task 3: `<EmptyState>` + `<Skeleton>` primitives

There is no `components/ui/skeleton.tsx` today (verified) and empty-state copy is ad-hoc ("No data yet" ×4, "No sessions found", "No sets logged", "No supplements yet", …).

**Files:**
- Create: `components/ui/empty-state.tsx`, `components/ui/skeleton.tsx`

- [ ] **Step 1: Create both**

```tsx
// components/ui/skeleton.tsx
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-xl bg-muted/50", className)} {...props} />;
}
```

```tsx
// components/ui/empty-state.tsx
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 py-8 text-center", className)}>
      {Icon && <Icon className="h-6 w-6 text-muted-foreground/60" />}
      <p className="text-sm text-muted-foreground">{title}</p>
      {action}
    </div>
  );
}
```

- [ ] **Step 2: Enumerate empty-copy sites**

Run: `grep -rn '"No \(data\|sessions\|sets\|supplements\|previous\|match\)' app components --include='*.tsx'`

- [ ] **Step 3: Migrate each hit** to `<EmptyState title="…" />`, keeping each site's current copy verbatim (this task unifies presentation, not wording). Where a CTA exists next to the message, pass it as `action`.

- [ ] **Step 4: Verify** two representative screens with empty data (e.g. Supplements with none, a day with no sets) — copy unchanged, consistent layout.

- [ ] **Step 5: Commit**

```bash
git add components app
git commit -m "Add EmptyState and Skeleton primitives; unify ad-hoc empty states"
```

### Task 4: Adopt `components/ui/collapsible.tsx` for hand-rolled toggles

`Collapsible` exists with zero imports; ~18 sites hand-roll ChevronUp/Down + conditional render with no `aria-expanded`. Migrate the six highest-traffic first; list the rest as a follow-up checklist in the PR body.

**Files:**
- Modify: `components/mood-checkin-sheet.tsx:222-317` (Sore Muscles + Issues sections), `components/nutrition/meal-card.tsx`, `components/workout/ai-prescription-card.tsx`, `components/workout/added-weight-toggle.tsx`, `components/more/profile-tab.tsx`, `components/config-screen.tsx`

- [ ] **Step 1: Reference migration (mood-checkin Sore Muscles section)** — replace the `useState` + chevron + `{open && (...)}` block:

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";

<Collapsible open={soreOpen} onOpenChange={setSoreOpen}>
  <CollapsibleTrigger className="flex w-full items-center justify-between py-2">
    <span className="text-sm font-semibold">Sore Muscles</span>
    <ChevronDownIcon
      className={`h-4 w-4 text-muted-foreground transition-transform ${soreOpen ? "rotate-180" : ""}`}
    />
  </CollapsibleTrigger>
  <CollapsibleContent>
    {/* existing section body, moved verbatim */}
  </CollapsibleContent>
</Collapsible>
```

Keep the existing auto-expand-when-editing behaviour: the `soreOpen` state and its initializer don't change — only the render wrapper does.

- [ ] **Step 2: Apply the same pattern to the other five files**, preserving each site's open-state variable and default.

- [ ] **Step 3: Verify** — each section toggles as before; inspect the DOM to confirm `aria-expanded` now appears on the triggers.

- [ ] **Step 4: Commit**

```bash
git add components
git commit -m "Adopt Radix Collapsible for the six highest-traffic hand-rolled toggles"
```

---

## Phase 2 — Gym ergonomics & accessibility

### Task 5: Workout-tab guard while a workout is active

`handleNavClick` (`components/shell/bottom-nav.tsx:44`) only intercepts when the target is NOT `/workout` — so tapping the center Workout FAB mid-set re-navigates to `/workout` (the session picker) unguarded.

**Files:**
- Modify: `components/shell/bottom-nav.tsx:44-48`

- [ ] **Step 1: Extend the guard** — when the workout is active and the user is already inside `/workout`, a Workout-tab tap becomes a no-op (they're already there; re-navigating risks the in-progress set):

```tsx
const handleNavClick = (href: string, e: React.MouseEvent) => {
  if (!workoutActive || !pathname.startsWith("/workout")) return;
  if (!href.startsWith("/workout")) {
    e.preventDefault();
    setPendingHref(href);
  } else {
    // Already mid-workout — swallow the FAB tap instead of remounting the picker.
    e.preventDefault();
  }
};
```

- [ ] **Step 2: Verify** — start a workout, begin a set, tap the center FAB: nothing happens (stays on the live screen). Tap Health: the Leave-workout dialog appears as before. With no active workout, the FAB navigates normally.

- [ ] **Step 3: Commit**

```bash
git add components/shell/bottom-nav.tsx
git commit -m "Swallow Workout-tab taps during an active workout instead of remounting the picker"
```

### Task 6: 44px tap targets for icon buttons

`globals.css:392` sets `min-height: 44px` on buttons under 640px but never width; header gear/grid/refresh buttons are `p-2` + 16px icons (~32px) and the nutrition date chevrons `p-1.5` (~28px).

**Files:**
- Modify: `components/ui/button.tsx:24-29`, `app/globals.css:391-394`, then the cited sites: `app/nutrition/nutrition-content.tsx:292,304-317`, `app/health/health-content.tsx:769`, `app/session-select/session-select-content.tsx:1099-1123`

- [ ] **Step 1: Add a width rule alongside the existing height rule** in `app/globals.css`:

```css
  /* Minimum tap target size */
  button {
    min-height: 44px;
    min-width: 44px;
  }
  /* Opt-out for controls that are intentionally dense (e.g. inline text buttons) */
  button.tap-dense {
    min-height: 0;
    min-width: 0;
  }
```

- [ ] **Step 2: Sweep for layout breakage** — `pnpm dev`, walk every screen (Home, Health ×3 tabs, Workout flow, Nutrition, More, Config). Any button the new floor visually breaks (tight inline chips, keypad keys, set-card mini buttons) gets `className="tap-dense …"` added — record each in the commit message. Expect the header icon buttons and date chevrons to simply get comfortably bigger hit areas with unchanged visuals (padding grows into the min box).

- [ ] **Step 3: Add an icon-lg Button variant** for future use in `components/ui/button.tsx`:

```tsx
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-lg": "size-11",
      },
```

- [ ] **Step 4: Verify on the S25 viewport** (412px wide): date chevrons and header icons are comfortably tappable one-handed; no clipped layouts.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css components/ui/button.tsx app components
git commit -m "Enforce 44px minimum tap targets with an explicit dense opt-out"
```

### Task 7: Functional-text floor + muted-foreground contrast

**Files:**
- Modify: `components/workout/set-card.tsx:156,169,402`, `components/mood-checkin-sheet.tsx:214`, `app/globals.css:116`

- [ ] **Step 1:** Replace `text-[9px]` / `text-[10px]` on *functional* (non-decorative) text at the cited lines with `text-[11px]` (set metadata: reps/weight/RPE/rest labels; mood scale captions). Purely decorative micro-labels may stay.
- [ ] **Step 2:** Nudge dark-mode muted foreground one step lighter in `app/globals.css` — change line 116 from `--muted-foreground: oklch(0.708 0 0);` to `--muted-foreground: oklch(0.75 0 0);`.
- [ ] **Step 3: Verify** — dark mode, workout screen: set metadata legible at arm's length; muted text elsewhere (timestamps, captions) reads noticeably better, no washed-out look.
- [ ] **Step 4: Commit**

```bash
git add components app/globals.css
git commit -m "Raise functional text floor to 11px and lighten dark muted-foreground"
```

### Task 8: Map hardcoded status colors onto the accent tokens + FAB icon contrast

**Files:**
- Modify: `components/workout/set-card.tsx:149-153`, `components/mood-checkin-sheet.tsx:254-268`, `components/shell/bottom-nav.tsx:82`

- [ ] **Step 1:** In `set-card.tsx`, replace the raw logged-set greens (`rgba(34,197,94,…)`, `text-green-500`) with the token: `text-[var(--accent-green)]` and `bg-[var(--accent-green)]/10`-style classes (Tailwind v4 arbitrary-value syntax with CSS vars, matching how `--brand` is consumed elsewhere — grep `var(--color-brand)` for the established syntax and mirror it).
- [ ] **Step 2:** In `mood-checkin-sheet.tsx`, replace `#f59e0b` → `var(--accent-amber)`, and the `#ff6a1a`/`#ff4444` energy colors with `var(--accent-amber)` / `var(--destructive)`.
- [ ] **Step 3:** In `bottom-nav.tsx:82`, replace the hardcoded `text-white` FAB icon class with `text-primary-foreground` so light brand themes (gold/cyan) keep contrast.
- [ ] **Step 4: Verify** in dark mode AND with the gold brand theme selected (Profile → appearance): logged sets, mood chips, and the FAB icon all keep sensible contrast.
- [ ] **Step 5: Commit**

```bash
git add components
git commit -m "Use theme tokens for logged-set, mood, and FAB colors instead of raw values"
```

### Task 9: aria-labels + pair color-only status with icons

**Files:**
- Modify: `components/nutrition/capture-step.tsx`, `review-step.tsx`, `barcode-scanner.tsx`, `assign-step.tsx`, `quick-edit-log-sheet.tsx`, `components/nutrition/end-of-day/*` (icon-only buttons), `components/workout/set-card.tsx:149-178`

- [ ] **Step 1:** Grep icon-only buttons in the nutrition sub-flows: `grep -n '<button' components/nutrition/*.tsx components/nutrition/end-of-day/*.tsx | grep -v aria-label` — add a descriptive `aria-label` to every hit that renders only an icon ("Take photo", "Scan barcode", "Edit entry", "Delete entry", "Close", …).
- [ ] **Step 2:** In `set-card.tsx`, ensure logged state is not color-only: the logged set row already has a check icon in some states — make `CheckCircle2` (lucide) render unconditionally next to the logged weight, and give the RPE value a text label (`RPE 8` instead of a bare colored `8`).
- [ ] **Step 3: Verify** — workout screen: logged sets show check + "RPE n"; screen reader (TalkBack or devtools accessibility tree) announces the nutrition icon buttons.
- [ ] **Step 4: Commit**

```bash
git add components
git commit -m "Label icon-only buttons and stop relying on color alone for set status"
```

---

## Phase 3 — Structure

### Task 10: Root error boundary + Home loading skeleton

**Files:**
- Create: `app/error.tsx`
- Modify: `app/session-select/session-select-content.tsx` (loading render)

- [ ] **Step 1: Create `app/error.tsx`** modeled on the existing `app/workout/error.tsx` (same layout, generalized copy):

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-5 bg-page px-6 text-center">
      <div className="text-5xl">⚠️</div>
      <div>
        <h2 className="text-xl font-bold">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your data is safe. Tap below to reload this screen.
        </p>
        <p className="mt-3 text-xs font-mono text-red-400 break-all max-w-xs">{error?.message}</p>
      </div>
      <Button className="bg-brand text-white hover:opacity-90" onClick={reset}>
        Try again
      </Button>
      <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
        Go to home
      </Link>
    </div>
  );
}
```

- [ ] **Step 2:** Home currently renders nothing while loading (`session-select-content.tsx` has zero `animate-pulse`). Add a first-paint skeleton using Task 3's `<Skeleton>` where the screen currently renders null/blank before data arrives: a greeting-row skeleton (`h-6 w-40`), a readiness-strip skeleton (`h-14 w-full`), and two card skeletons (`h-28 w-full`). Only when there is no cache-seeded data — do not flash it over seeded paints.
- [ ] **Step 3: Verify** — throw a test error inside a Health card render (temporary `throw new Error("boom")`) → branded retry card, Try-again recovers; remove the test throw. Cold-load Home with devtools network throttled → skeletons then content.
- [ ] **Step 4: Commit**

```bash
git add app components
git commit -m "Add root error boundary and first-paint skeletons on Home"
```

### Task 11: Standardize back navigation (`useBackOrFallback`)

Detail heroes hard-`Link` to `/health` (`components/health/detail-hero.tsx:194-202`), discarding real history (e.g. arriving from the home timeline).

**Files:**
- Create: `lib/hooks/use-back-or-fallback.ts`
- Modify: `components/health/detail-hero.tsx:194-202`

- [ ] **Step 1: Create the hook**

```ts
"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/** Go back if the app owns the previous history entry, else replace with the fallback. */
export function useBackOrFallback(fallback: string) {
  const router = useRouter();
  return useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.replace(fallback);
    }
  }, [router, fallback]);
}
```

- [ ] **Step 2: Use it in detail-hero** — replace the `<Link href="/health">` back chevron with a `<button onClick={goBack} aria-label="Back">` where `const goBack = useBackOrFallback("/health");` (keep the exact classes/icon).
- [ ] **Step 3: Verify** — open a detail page from the Health tab → back returns to Health; open one from the home timeline → back returns to Home; open a detail page as a fresh deep link (paste URL) → back lands on `/health`.
- [ ] **Step 4: Commit**

```bash
git add lib/hooks/use-back-or-fallback.ts components/health/detail-hero.tsx
git commit -m "Back buttons honor navigation history with a /health fallback"
```

### Task 12: `<ScreenHeader>` + align Home to the header contract

Health/Nutrition/More/Stats/Workout all use `px-4 pt-safe pb-3 border-b border-border` + `text-xl font-bold`; Home alone uses `pt-safe pb-2`, no border.

**Files:**
- Create: `components/shell/screen-header.tsx`
- Modify: the five tab headers + `app/session-select/session-select-content.tsx:1086`

- [ ] **Step 1: Create the shell**

```tsx
import { cn } from "@/lib/utils";

interface ScreenHeaderProps {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children?: React.ReactNode; // custom content (Home's greeting row)
  className?: string;
}

export function ScreenHeader({ title, subtitle, action, children, className }: ScreenHeaderProps) {
  return (
    <header className={cn("px-4 pt-safe pb-3 border-b border-border flex items-start justify-between gap-2", className)}>
      {children ?? (
        <div>
          {title && <h1 className="text-xl font-bold">{title}</h1>}
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      )}
      {action}
    </header>
  );
}
```

- [ ] **Step 2:** Migrate the five standard headers (mechanical: move their existing `<h1>`/subtitle/action nodes into props or children). Home passes its greeting/avatar row as `children`, gaining the shared padding + border baseline.
- [ ] **Step 3: Verify** — swipe/tap across all five tabs: headers now share the same top spacing and bottom rule; no double borders; safe-area still clears the status bar (S25 viewport).
- [ ] **Step 4: Commit**

```bash
git add components/shell/screen-header.tsx app components
git commit -m "Share one ScreenHeader shell across tabs and align Home to it"
```

### Task 13: Inline validation on the metric-log sheet

The Health metric-log sheet (`app/health/health-content.tsx:861-887`) accepts empty/NaN and reports failure only via toast.

**Files:**
- Modify: `app/health/health-content.tsx:861-887`

- [ ] **Step 1:** Derive an inline error and gate Save:

```tsx
const logValueNum = logState ? parseFloat(logState.value) : NaN;
const logError =
  logState && logState.value !== "" && (!isFinite(logValueNum) || logValueNum <= 0)
    ? "Enter a value above 0"
    : null;
```

On the `<input>` add `aria-invalid={!!logError}` and `className={cn("…existing…", logError && "border-destructive")}`; under it render:

```tsx
{logError && (
  <p role="alert" className="text-xs text-destructive">{logError}</p>
)}
```

Change the Save button to `disabled={logSaving || !logState?.value || !!logError}`.

- [ ] **Step 2: Verify** — open Log Weight: empty input → Save disabled; type `0` or `-1` → red border + message; valid value saves as before. Toast remains only for network failure.
- [ ] **Step 3: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "Validate metric-log input inline instead of toast-only failures"
```

### Task 14: Delete dead UI (with verification)

**Files:**
- Delete (after verification): `app/workout-mockup/` (468-line page, no inbound links), `components/chat-overlay.tsx` (legacy, superseded by `ai-chat-overlay.tsx`), `app/overview/` + `components/overview-screen.tsx` (sheet-era overview)

- [ ] **Step 1: Verify zero references** — each must return no hits outside the file itself before deleting:

```bash
grep -rn "workout-mockup" app components lib --include='*.ts*'
grep -rn "chat-overlay" app components lib --include='*.ts*' | grep -v ai-chat-overlay
grep -rn "overview-screen\|/overview" app components lib --include='*.ts*' | grep -v health
```

If `app/overview` / `overview-screen` still has live consumers (e.g. `/sheet/[id]` routes), delete only the first two and record the finding in the commit message instead.

- [ ] **Step 2:** Delete the verified-dead files, run `npx tsc --noEmit` (no dangling imports), `pnpm build` passes.
- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Remove dead workout mockup page and legacy chat overlay"
```

### Task 15: Split `session-select-content.tsx` (1,617 lines) — pure move

**Files:**
- Create: `lib/home/home-prefs.ts`, `components/home/rest-day.ts` (if not colocated), `hooks` stay in-file
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1:** Move the pure localStorage pref loaders block (lines ~90–239: `WIDGETS_KEY` … `loadSectionOrder`, `loadPillColors`, `loadCardColors`, goal loaders, `buildDefaultOrder`, `loadHiddenSections`) verbatim into `lib/home/home-prefs.ts` with named exports; import them back. No logic edits.
- [ ] **Step 2:** Move the rest-day marker helpers (lines ~255–276: `REST_DAY_KEY`, `isRestDayChosen`, `markRestDayChosen`, `withRestDayOverride`) into `lib/home/rest-day.ts`; import back.
- [ ] **Step 3:** Move `fetchWithRetry` (~line 277) into `lib/fetch-with-retry.ts` (check first whether an equivalent already exists in `lib/` — if so, use it and delete the local copy).
- [ ] **Step 4:** `npx tsc --noEmit && pnpm lint && pnpm test` all green; `pnpm dev` Home renders identically (widgets, pill colors, rest-day flow, greeting).
- [ ] **Step 5: Commit**

```bash
git add app lib components
git commit -m "Extract Home pref loaders and rest-day helpers out of session-select-content"
```

### Task 16: Split `health-content.tsx` (1,206 lines) — extract the log sheet

**Files:**
- Create: `components/health/metric-log-sheet.tsx`
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1:** Move the log-sheet JSX (lines ~861–887, including Task 13's validation) plus its `logState`/`logSaving`/`handleSaveLog` trio into `components/health/metric-log-sheet.tsx` with props `{ logState, onClose, onSaved }` — the save handler moves with it; `onSaved` triggers the parent's existing invalidate + refetch (mirror how `WaterLogSheet` at line ~888 is wired, which is the established pattern for exactly this shape).
- [ ] **Step 2:** `npx tsc --noEmit`; `pnpm dev` — log a weight from Health > Body: sheet opens, saves, list refreshes.
- [ ] **Step 3: Commit**

```bash
git add app components
git commit -m "Extract MetricLogSheet from health-content"
```

---

## Final checks (whole batch)

- [ ] `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build` — all green.
- [ ] Full manual pass on the S25 viewport: Home, Health (3 tabs + a detail page + back), Workout full loop (pre → active → summary → done, FAB tap mid-set), Nutrition (log food, date nav), More (tabs, friends), Config.
- [ ] Open the PR (title: "UI system: shared primitives, tap targets, error states, dead-code removal") and **ask the user before merging** — this deploys code.

## Self-review

- **Coverage:** G1 → Tasks 1–4 (SegmentedTabs, ConfirmDialog, EmptyState+Skeleton, Collapsible; raw-`<button>` migration folded into Tasks 1/2/6 where files are already touched — a full 377-button sweep is deliberately out of scope). G2 → Tasks 5–9. G3 → Tasks 10–14 structure + 15–16 splits. ✔
- **Consistency:** `SegmentedTabs` props (`tabs/value/onValueChange/size`), `ConfirmDialog` props (`open/onOpenChange/title/message/confirmLabel/cancelLabel/variant/onConfirm`), `Skeleton`, `EmptyState`, `ScreenHeader`, `useBackOrFallback(fallback)` used identically at every reference. ✔
- **No placeholders:** every code step shows the real code; enumerations use concrete grep commands with expected file lists. ✔
- **Out of scope (recorded):** migrating all 377 raw buttons; the remaining ~12 Collapsible sites (listed in the PR body as follow-up); splits of `config-screen.tsx`/`health-sections.tsx`/`program-editor-sheet.tsx` (follow-ups); `scoreBand()`/sparkline consolidation (Batch F F5).
