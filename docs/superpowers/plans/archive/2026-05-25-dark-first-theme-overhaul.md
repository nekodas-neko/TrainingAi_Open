> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Dark-First Theme Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the app into a dark-first, AMOLED-optimised design with electric accent colours, gradient-tinted cards, and glow effects — while keeping both dark and light modes.

**Architecture:** Extend the existing `--color-brand` / `data-brand` CSS variable cascade with three new derived variables (`--brand-card-bg`, `--brand-card-border`, `--brand-glow`) defined per theme in `globals.css`. Update brand hex values to electric/neon variants. Wire the new variables into 5 components via `style` props — no new React state, no new providers.

**Tech Stack:** Next.js 15, Tailwind CSS v4, CSS custom properties, TypeScript. No new dependencies.

**Note:** `app/layout.tsx` already contains the inline `<script>` that restores `data-brand` from localStorage before first paint — no changes needed there.

---

## File Map

| File | What changes |
|---|---|
| `app/globals.css` | Dark surface tokens pushed to near-black; 3 new brand CSS vars per theme block |
| `lib/brand-themes.ts` | Electric hex values; 6 new rgba fields per theme |
| `app/session-select/session-select-content.tsx` | Recommended carousel card + stat chips use brand vars |
| `components/workout/active-workout-screen.tsx` | 1RM badge uses brand vars |
| `components/workout/timer-ring.tsx` | Track uses brand-card-bg; glow layer added |
| `components/workout/done-screen.tsx` | Checkmark circle uses brand vars + glow |

---

## Task 1: Push dark mode surface tokens to near-black

**Files:**
- Modify: `app/globals.css` — `.dark` block, lines 90–122

The current dark background is `oklch(0.145 0 0)` (visible gray). Push it to near-black for AMOLED impact.

- [ ] **Open `app/globals.css` and replace the entire `.dark { … }` block** with:

```css
.dark {
  --background: oklch(0.05 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.09 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.09 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.13 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.13 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.13 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 7%);
  --input: oklch(1 0 0 / 12%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.09 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.13 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 7%);
  --sidebar-ring: oklch(0.556 0 0);
}
```

- [ ] **Run the build to verify no errors:**

```bash
pnpm build 2>&1 | tail -5
```

Expected: `✓ Compiled successfully`

- [ ] **Commit:**

```bash
git add app/globals.css
git commit -m "Push dark mode surfaces to near-black for AMOLED"
```

---

## Task 2: Add brand-derived CSS variables to globals.css

**Files:**
- Modify: `app/globals.css` — `:root` block and `[data-brand]` blocks

Three new variables per theme: `--brand-card-bg` (tinted card background), `--brand-card-border` (tinted border), `--brand-glow` (shadow/glow colour). Light values are subtle; dark values are richer.

- [ ] **Add the three new variables to the `:root` block** (green default, light mode). Insert after the existing `--brand: oklch(0.723 0.219 149.579);` line:

```css
:root {
  --brand: oklch(0.723 0.219 149.579); /* green — default */
  --brand-card-bg: rgba(0, 255, 135, 0.04);
  --brand-card-border: rgba(0, 255, 135, 0.10);
  --brand-glow: rgba(0, 255, 135, 0.12);
  /* … rest of existing :root vars unchanged … */
}
```

- [ ] **Add dark-mode overrides for green (default) inside `.dark`** — append these three lines before the closing `}` of the `.dark` block:

```css
  --brand-card-bg: rgba(0, 255, 135, 0.07);
  --brand-card-border: rgba(0, 255, 135, 0.18);
  --brand-glow: rgba(0, 255, 135, 0.25);
```

- [ ] **Replace the entire brand theme block** (lines 143–148 in current file) with the full set including new variables. The new brand theme block is:

```css
/* Brand accent colour themes — set via data-brand on <html> */
[data-brand="blue"] {
  --brand: oklch(0.84 0.15 210);
  --color-brand: oklch(0.84 0.15 210);
  --brand-card-bg: rgba(0, 212, 255, 0.04);
  --brand-card-border: rgba(0, 212, 255, 0.10);
  --brand-glow: rgba(0, 212, 255, 0.12);
}
.dark [data-brand="blue"] {
  --brand-card-bg: rgba(0, 212, 255, 0.07);
  --brand-card-border: rgba(0, 212, 255, 0.18);
  --brand-glow: rgba(0, 212, 255, 0.25);
}

[data-brand="purple"] {
  --brand: oklch(0.65 0.28 305);
  --color-brand: oklch(0.65 0.28 305);
  --brand-card-bg: rgba(191, 95, 255, 0.04);
  --brand-card-border: rgba(191, 95, 255, 0.10);
  --brand-glow: rgba(191, 95, 255, 0.12);
}
.dark [data-brand="purple"] {
  --brand-card-bg: rgba(191, 95, 255, 0.07);
  --brand-card-border: rgba(191, 95, 255, 0.18);
  --brand-glow: rgba(191, 95, 255, 0.25);
}

[data-brand="orange"] {
  --brand: oklch(0.70 0.22 45);
  --color-brand: oklch(0.70 0.22 45);
  --brand-card-bg: rgba(255, 106, 26, 0.04);
  --brand-card-border: rgba(255, 106, 26, 0.10);
  --brand-glow: rgba(255, 106, 26, 0.12);
}
.dark [data-brand="orange"] {
  --brand-card-bg: rgba(255, 106, 26, 0.07);
  --brand-card-border: rgba(255, 106, 26, 0.18);
  --brand-glow: rgba(255, 106, 26, 0.25);
}

[data-brand="pink"] {
  --brand: oklch(0.67 0.27 350);
  --color-brand: oklch(0.67 0.27 350);
  --brand-card-bg: rgba(255, 61, 154, 0.04);
  --brand-card-border: rgba(255, 61, 154, 0.10);
  --brand-glow: rgba(255, 61, 154, 0.12);
}
.dark [data-brand="pink"] {
  --brand-card-bg: rgba(255, 61, 154, 0.07);
  --brand-card-border: rgba(255, 61, 154, 0.18);
  --brand-glow: rgba(255, 61, 154, 0.25);
}

[data-brand="cyan"] {
  --brand: oklch(0.88 0.13 215);
  --color-brand: oklch(0.88 0.13 215);
  --brand-card-bg: rgba(0, 229, 255, 0.04);
  --brand-card-border: rgba(0, 229, 255, 0.10);
  --brand-glow: rgba(0, 229, 255, 0.12);
}
.dark [data-brand="cyan"] {
  --brand-card-bg: rgba(0, 229, 255, 0.07);
  --brand-card-border: rgba(0, 229, 255, 0.18);
  --brand-glow: rgba(0, 229, 255, 0.25);
}
```

- [ ] **Build to verify:**

```bash
pnpm build 2>&1 | tail -5
```

Expected: `✓ Compiled successfully`

- [ ] **Commit:**

```bash
git add app/globals.css
git commit -m "Add brand-card-bg, brand-card-border, brand-glow CSS vars per theme"
```

---

## Task 3: Update brand-themes.ts with electric hex values and new fields

**Files:**
- Modify: `lib/brand-themes.ts`

Update all 6 theme hex values to electric/neon variants. Add 6 new rgba fields per theme so TypeScript consumers can read the values directly if needed (the CSS vars are the primary mechanism, but having the values in TS keeps things consistent and enables future use).

- [ ] **Replace the entire contents of `lib/brand-themes.ts`** with:

```typescript
export const BRAND_THEMES = [
  {
    key: "green",
    label: "Green",
    color: "oklch(0.87 0.30 150)",
    hex: "#00ff87",
    cardBgDark:     "rgba(0,255,135,0.07)",
    cardBorderDark: "rgba(0,255,135,0.18)",
    glowDark:       "rgba(0,255,135,0.25)",
    cardBgLight:    "rgba(0,255,135,0.04)",
    cardBorderLight:"rgba(0,255,135,0.10)",
    glowLight:      "rgba(0,255,135,0.12)",
  },
  {
    key: "blue",
    label: "Blue",
    color: "oklch(0.84 0.15 210)",
    hex: "#00d4ff",
    cardBgDark:     "rgba(0,212,255,0.07)",
    cardBorderDark: "rgba(0,212,255,0.18)",
    glowDark:       "rgba(0,212,255,0.25)",
    cardBgLight:    "rgba(0,212,255,0.04)",
    cardBorderLight:"rgba(0,212,255,0.10)",
    glowLight:      "rgba(0,212,255,0.12)",
  },
  {
    key: "purple",
    label: "Purple",
    color: "oklch(0.65 0.28 305)",
    hex: "#bf5fff",
    cardBgDark:     "rgba(191,95,255,0.07)",
    cardBorderDark: "rgba(191,95,255,0.18)",
    glowDark:       "rgba(191,95,255,0.25)",
    cardBgLight:    "rgba(191,95,255,0.04)",
    cardBorderLight:"rgba(191,95,255,0.10)",
    glowLight:      "rgba(191,95,255,0.12)",
  },
  {
    key: "orange",
    label: "Orange",
    color: "oklch(0.70 0.22 45)",
    hex: "#ff6a1a",
    cardBgDark:     "rgba(255,106,26,0.07)",
    cardBorderDark: "rgba(255,106,26,0.18)",
    glowDark:       "rgba(255,106,26,0.25)",
    cardBgLight:    "rgba(255,106,26,0.04)",
    cardBorderLight:"rgba(255,106,26,0.10)",
    glowLight:      "rgba(255,106,26,0.12)",
  },
  {
    key: "pink",
    label: "Pink",
    color: "oklch(0.67 0.27 350)",
    hex: "#ff3d9a",
    cardBgDark:     "rgba(255,61,154,0.07)",
    cardBorderDark: "rgba(255,61,154,0.18)",
    glowDark:       "rgba(255,61,154,0.25)",
    cardBgLight:    "rgba(255,61,154,0.04)",
    cardBorderLight:"rgba(255,61,154,0.10)",
    glowLight:      "rgba(255,61,154,0.12)",
  },
  {
    key: "cyan",
    label: "Cyan",
    color: "oklch(0.88 0.13 215)",
    hex: "#00e5ff",
    cardBgDark:     "rgba(0,229,255,0.07)",
    cardBorderDark: "rgba(0,229,255,0.18)",
    glowDark:       "rgba(0,229,255,0.25)",
    cardBgLight:    "rgba(0,229,255,0.04)",
    cardBorderLight:"rgba(0,229,255,0.10)",
    glowLight:      "rgba(0,229,255,0.12)",
  },
] as const;

export type BrandThemeKey = (typeof BRAND_THEMES)[number]["key"];

export const BRAND_THEME_STORAGE_KEY = "ta_brand_theme";
```

- [ ] **Build to verify TypeScript is happy:**

```bash
pnpm build 2>&1 | tail -5
```

Expected: `✓ Compiled successfully`

- [ ] **Commit:**

```bash
git add lib/brand-themes.ts
git commit -m "Update brand themes to electric hex values, add rgba card/glow fields"
```

---

## Task 4: Wire brand vars into the session carousel card and stat chips

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

The recommended session card currently uses `palette.bgClass` / `palette.borderClass` (session-position colours). Replace with brand CSS vars. Stat chips (health widgets) currently use `bg-muted`; replace with brand vars.

- [ ] **Find the session card `<button>` (around line 498–519). Update its `className` and add a `style` prop.** The current className conditional for `isRec` is:
```tsx
isRec
  ? cn(palette.borderClass, palette.bgClass)
  : "border-border bg-muted/40",
```
Replace the entire className/style of that button element:

```tsx
<button
  key={sess.id}
  ref={(el: HTMLButtonElement | null) => { cardRefs.current[sess.name] = el; }}
  onClick={() => {
    if (!isCentered) {
      cardRefs.current[sess.name]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      return;
    }
    handleSelect(sess.name);
  }}
  className={cn(
    "flex-none w-36 rounded-2xl border-2 p-3 flex flex-col items-center gap-1.5 text-center transition-all duration-200",
    isRec && completeToday
      ? "border-green-500 bg-green-50 dark:bg-green-950"
      : inProgress
      ? "border-amber-400 bg-amber-50 dark:bg-amber-950"
      : "border-transparent",
    isCentered ? "scale-105 shadow-lg" : "opacity-40 scale-95"
  )}
  style={{
    scrollSnapAlign: "center",
    ...(isRec && !completeToday && !inProgress ? {
      background: "var(--brand-card-bg)",
      borderColor: "var(--brand-card-border)",
    } : {}),
  }}
>
```

- [ ] **Find the stat chip buttons (around line 420–438). Replace `bg-muted` with brand vars.** Current className:
```tsx
className="flex flex-col items-center gap-0.5 rounded-xl bg-muted px-2 py-2 hover:bg-muted/70 active:scale-95 transition-all text-center"
```
Replace with:
```tsx
className="flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 active:scale-95 transition-all text-center border"
style={{ background: "var(--brand-card-bg)", borderColor: "var(--brand-card-border)" }}
```

- [ ] **Build to verify:**

```bash
pnpm build 2>&1 | tail -5
```

Expected: `✓ Compiled successfully`

- [ ] **Commit:**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "Carousel card and stat chips use brand CSS vars"
```

---

## Task 5: Wire brand vars into the 1RM badge

**Files:**
- Modify: `components/workout/active-workout-screen.tsx` — around line 116

The 1RM badge currently uses hardcoded emerald Tailwind classes. Replace with brand vars so it matches the active theme.

- [ ] **Find the 1RM badge span (around line 115–119):**
```tsx
{exercise?.estimated1rm != null && (
  <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 flex-none">
    1RM ~{mround125(exercise.estimated1rm)} kg
  </span>
)}
```
Replace with:
```tsx
{exercise?.estimated1rm != null && (
  <span
    className="rounded-lg px-2.5 py-1 text-xs font-semibold flex-none border"
    style={{
      background: "var(--brand-card-bg)",
      borderColor: "var(--brand-card-border)",
      color: "var(--color-brand)",
    }}
  >
    1RM ~{mround125(exercise.estimated1rm)} kg
  </span>
)}
```

- [ ] **Build to verify:**

```bash
pnpm build 2>&1 | tail -5
```

Expected: `✓ Compiled successfully`

- [ ] **Commit:**

```bash
git add components/workout/active-workout-screen.tsx
git commit -m "1RM badge uses brand CSS vars instead of hardcoded emerald"
```

---

## Task 6: Add brand-tinted track and glow to the timer ring

**Files:**
- Modify: `components/workout/timer-ring.tsx`

Two changes: (1) the track circle gets `stroke: var(--brand-card-bg)` via style prop instead of `currentColor`/`text-muted/30`; (2) a blurred glow circle is drawn behind the active segment using `var(--color-brand)`.

- [ ] **Replace the track `<circle>` (lines 72–81).** Current:
```tsx
{/* Track */}
<circle
  cx={CX}
  cy={CY}
  r={R}
  fill="none"
  stroke="currentColor"
  strokeWidth="9"
  className="text-muted/30"
  strokeDasharray={`${CIRCUMFERENCE} 0`}
/>
```
Replace with:
```tsx
{/* Track */}
<circle
  cx={CX}
  cy={CY}
  r={R}
  fill="none"
  style={{ stroke: "var(--brand-card-bg)" }}
  strokeWidth="9"
  strokeDasharray={`${CIRCUMFERENCE} 0`}
/>
```

- [ ] **Add a glow layer immediately BEFORE the active segment circle** (around line 103). The glow must be rendered before the active circle so it sits behind it in SVG paint order. Find the comment `{/* Active (live) segment */}` and insert the glow block above it:

```tsx
{/* Glow behind active segment */}
{activeSecs > 0 && (() => {
  const len = (activeSecs / total) * CIRCUMFERENCE;
  const offset = CIRCUMFERENCE - (completedSecs / total) * CIRCUMFERENCE;
  return (
    <circle
      cx={CX}
      cy={CY}
      r={R}
      fill="none"
      style={{ stroke: "var(--color-brand)", filter: "blur(6px)" }}
      strokeWidth="16"
      strokeOpacity="0.22"
      strokeDasharray={`${len} ${CIRCUMFERENCE - len}`}
      strokeDashoffset={offset}
    />
  );
})()}
{/* Active (live) segment */}
```

- [ ] **Build to verify:**

```bash
pnpm build 2>&1 | tail -5
```

Expected: `✓ Compiled successfully`

- [ ] **Commit:**

```bash
git add components/workout/timer-ring.tsx
git commit -m "Timer ring track uses brand-card-bg; add brand glow behind active segment"
```

---

## Task 7: Add brand glow to the done screen checkmark

**Files:**
- Modify: `components/workout/done-screen.tsx`

Replace the hardcoded green circle with brand vars and a box-shadow glow. The `CheckIcon` colour also switches to `var(--color-brand)`.

- [ ] **Find the checkmark circle div (around lines 43–45).** Current:
```tsx
<div className="flex h-24 w-24 items-center justify-center rounded-full bg-green-100 dark:bg-green-900 ring-4 ring-green-200 dark:ring-green-800">
  <CheckIcon className="h-12 w-12 text-green-600 dark:text-green-400" />
</div>
```
Replace with:
```tsx
<div
  className="flex h-24 w-24 items-center justify-center rounded-full border"
  style={{
    background: "var(--brand-card-bg)",
    borderColor: "var(--brand-card-border)",
    boxShadow: "0 0 40px var(--brand-glow), 0 0 80px var(--brand-glow)",
    color: "var(--color-brand)",
  }}
>
  <CheckIcon className="h-12 w-12" />
</div>
```

- [ ] **Build to verify:**

```bash
pnpm build 2>&1 | tail -5
```

Expected: `✓ Compiled successfully`

- [ ] **Commit:**

```bash
git add components/workout/done-screen.tsx
git commit -m "Done screen checkmark uses brand vars with double glow ring"
```

---

## Task 8: Final build and push

- [ ] **Run full build one last time:**

```bash
pnpm build 2>&1 | grep -E "error|Error|✓|Failed"
```

Expected: `✓ Compiled successfully` with no errors.

- [ ] **Push the branch:**

```bash
git push -u origin claude/app-improvements-new-skills-lVepS
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Dark mode surfaces to near-black → Task 1
- [x] `--brand-card-bg`, `--brand-card-border`, `--brand-glow` per theme in CSS → Task 2
- [x] Electric hex values + 6 new TS fields in brand-themes.ts → Task 3
- [x] Active carousel card uses brand vars → Task 4
- [x] Stat chips use brand vars → Task 4
- [x] layout.tsx inline script → already exists, noted, no task needed
- [x] 1RM badge uses brand vars → Task 5
- [x] Timer ring track uses brand-card-bg → Task 6
- [x] Timer ring glow layer → Task 6
- [x] Done screen checkmark uses brand vars + glow → Task 7

**Type consistency:**
- `--brand-card-bg`, `--brand-card-border`, `--brand-glow` used identically in Tasks 2, 4, 5, 6, 7 ✓
- `var(--color-brand)` used for text/stroke colour in Tasks 5, 6, 7 ✓
- `cardBgDark`, `cardBorderDark`, `glowDark`, `cardBgLight`, `cardBorderLight`, `glowLight` defined in Task 3 ✓

**No placeholders:** All steps have exact code. ✓
