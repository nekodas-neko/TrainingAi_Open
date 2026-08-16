> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Home Widget Customisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix scroll-lock in home edit mode, enable drag-to-reorder for card widgets, and add per-card colour pickers accessible from the grid-icon edit mode and the Profile Home Widgets section.

**Architecture:** All client-side localStorage — no API changes. Card colours stored in `ta_card_colors` key (same pattern as `ta_pill_colors` for metric tiles). The scroll-lock is fixed by only applying `touch-action: none` to the section that is actively being dragged rather than all sections in edit mode. Colour pickers appear as a coloured dot overlay on each card in edit mode, and in Profile → Home Widgets → Card Widgets.

**Tech Stack:** Next.js 15, React 19, TypeScript, `@dnd-kit/react`, Tailwind CSS v4, localStorage.

---

## ⚠️ Pre-Flight: Known Issues

### Bug — Scroll lock in edit mode
`HomeSortableSection` applies `touchAction: editMode ? 'none' : 'pan-y'`. When edit mode is active, ALL sections get `touch-action: none`, which tells the browser not to handle any touch gesture for those elements — including vertical scroll. Fix: only apply `touch-action: none` to the section that is *currently being dragged* (`isDragging` from `useSortable`), not to every section in edit mode.

### Bug — Card widget drag not working
`HomeSortableSection` correctly uses `useSortable`. The issue is that each card widget renders a `<button>` as its root interactive element. When the pointer goes down on the button, the button's own touch handling may intercept before the drag sensor's 300ms delay fires. Fix: in edit mode, add `onPointerDown={e => e.stopPropagation()}` to the card's inner button to prevent it from consuming the event before dnd-kit can capture it — OR wrap the card content in a `pointer-events-none` div in edit mode while the grip handle (already shown) is the only interactive element.

### Gap — Card colours are hardcoded
Each card widget has a hardcoded hex colour inline: `accentCardStyle('#00d4ff')` for weightSparkline, `'#bf5fff'` for nutritionDonut, etc. These need to be read from `cardColors` state instead.

---

## File Map

| File | Change |
|------|--------|
| `components/home-sortable-section.tsx` | Fix scroll lock — only `touch-action: none` on dragging item |
| `app/session-select/session-select-content.tsx` | Add `CARD_DEFAULT_COLORS`, `loadCardColors()`, `cardColors` state; replace hardcoded hex with state values; add colour dot overlay in edit mode per card; re-read on `visibilitychange` |
| `app/profile/profile-content.tsx` | Add `CARD_COLORS_KEY`, `loadCardColors()`, `cardColors` state; add colour dot + `<input type="color">` + reset link next to each Card Widget toggle |

---

## Task 1: Fix Scroll Lock in Edit Mode

**Files:**
- Modify: `components/home-sortable-section.tsx`

- [ ] **Step 1: Read the file**

```bash
cat /home/user/TrainingAI/components/home-sortable-section.tsx
```

Current `touchAction` logic (line 28):
```tsx
style={{ touchAction: editMode ? 'none' : 'pan-y' }}
```

- [ ] **Step 2: Fix — only disable touch-action on the dragging item**

Replace line 28:
```tsx
style={{ touchAction: isDragging ? 'none' : 'pan-y' }}
```

The full updated component:
```tsx
"use client";

import { useSortable } from "@dnd-kit/react/sortable";
import { GripVerticalIcon, EyeOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props {
  id: string;
  index: number;
  editMode: boolean;
  onHide?: (id: string) => void;
  children: ReactNode;
}

export function HomeSortableSection({ id, index, editMode, onHide, children }: Props) {
  const { ref, isDragging } = useSortable({ id, index });
  return (
    <div
      ref={ref}
      className={cn(
        "relative select-none",
        isDragging && "z-50 opacity-40 scale-[0.98]",
      )}
      style={{ touchAction: isDragging ? 'none' : 'pan-y' }}
    >
      {editMode && (
        <>
          <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/50 pointer-events-none">
            <GripVerticalIcon className="h-5 w-5" />
          </div>
          {onHide && (
            <button
              onClick={() => onHide(id)}
              className="absolute right-5 top-1/2 -translate-y-1/2 z-10 rounded-lg p-1 text-muted-foreground/60 hover:text-muted-foreground active:scale-90 transition"
              aria-label="Hide section"
            >
              <EyeOffIcon className="h-4 w-4" />
            </button>
          )}
        </>
      )}
      <div className={cn(editMode && "pl-5 pr-7 transition-[padding]")}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/home-sortable-section.tsx
git commit -m "fix scroll lock in home edit mode — touch-action none only while dragging"
```

---

## Task 2: Card Widget Colours in session-select-content.tsx

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

The hardcoded colours per card key are (confirmed from source):
- `weightSparkline`: `'#00d4ff'`
- `nutritionDonut`: `'#bf5fff'`
- `sleepWidget`: `'#8b5cf6'`
- `stepsWidget`: `'#2dd4bf'`
- `moodWidget`: `'#fbbf24'`

- [ ] **Step 1: Add `CARD_COLORS_KEY` and `CARD_DEFAULT_COLORS` constants**

Open `app/session-select/session-select-content.tsx`. Find the existing `PILL_COLORS_KEY` constant (around line 71). After it, add:

```typescript
const CARD_COLORS_KEY = "ta_card_colors"

const CARD_DEFAULT_COLORS: Record<CardWidgetKey, string> = {
  weightSparkline: '#00d4ff',
  nutritionDonut:  '#bf5fff',
  sleepWidget:     '#8b5cf6',
  stepsWidget:     '#2dd4bf',
  moodWidget:      '#fbbf24',
}

function loadCardColors(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(CARD_COLORS_KEY) : null
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
```

- [ ] **Step 2: Add `cardColors` state**

Find where `pillColors` state is declared (around line 332):
```typescript
const [pillColors, setPillColors] = useState<Record<string, string>>(() => loadPillColors());
```

Add after it:
```typescript
const [cardColors, setCardColors] = useState<Record<string, string>>(() => loadCardColors())
```

- [ ] **Step 3: Re-read card colours on visibilitychange**

Find the `visibilitychange` handler (around line 389). It currently calls `setPillColors(loadPillColors())`. Add after it:
```typescript
setCardColors(loadCardColors())
```

- [ ] **Step 4: Replace hardcoded colours in card widget render**

Find each card widget case in the switch statement and replace hardcoded hex with the state value. There are 5 cases — update each one:

**`case "card_weightSparkline"`** — find:
```tsx
style={accentCardStyle('#00d4ff')}
```
Replace with:
```tsx
style={accentCardStyle(cardColors['weightSparkline'] ?? CARD_DEFAULT_COLORS.weightSparkline)}
```

**`case "card_nutritionDonut"`** — find:
```tsx
style={accentCardStyle('#bf5fff')}
```
Replace with:
```tsx
style={accentCardStyle(cardColors['nutritionDonut'] ?? CARD_DEFAULT_COLORS.nutritionDonut)}
```

**`case "card_sleepWidget"`** — find the `accentCardStyle` call (check the exact hex — read the file to confirm it). Replace with:
```tsx
style={accentCardStyle(cardColors['sleepWidget'] ?? CARD_DEFAULT_COLORS.sleepWidget)}
```

**`case "card_stepsWidget"`** — replace similarly:
```tsx
style={accentCardStyle(cardColors['stepsWidget'] ?? CARD_DEFAULT_COLORS.stepsWidget)}
```

**`case "card_moodWidget"`** — replace similarly:
```tsx
style={accentCardStyle(cardColors['moodWidget'] ?? CARD_DEFAULT_COLORS.moodWidget)}
```

- [ ] **Step 5: Add colour dot overlay on each card in edit mode**

For each of the 5 card cases, the card renders a `<div className="px-4 pb-3">` wrapper containing a `<button>`. In edit mode, the inner button should not respond to taps (we want drag, not navigation). Add a colour dot in the top-right of the card that opens a colour picker.

Immediately before each card's closing `</div>` (the `px-4 pb-3` wrapper), add:

```tsx
{sectionEditMode && (
  <label
    className="absolute top-2 right-10 z-20 cursor-pointer"
    title="Change card colour"
    onClick={e => e.stopPropagation()}
  >
    <div
      className="w-5 h-5 rounded-full border-2 border-background shadow-md"
      style={{ background: cardColors['CARD_KEY'] ?? CARD_DEFAULT_COLORS.CARD_KEY }}
    />
    <input
      type="color"
      value={cardColors['CARD_KEY'] ?? CARD_DEFAULT_COLORS.CARD_KEY}
      onChange={e => {
        const next = { ...cardColors, ['CARD_KEY']: e.target.value }
        setCardColors(next)
        localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next))
      }}
      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
    />
  </label>
)}
```

Replace `'CARD_KEY'` with the actual key string for each card (`'weightSparkline'`, `'nutritionDonut'`, `'sleepWidget'`, `'stepsWidget'`, `'moodWidget'`).

Also add `position: 'relative'` to the outer `<div className="px-4 pb-3">` wrapper for each card so the absolute-positioned dot is contained:
```tsx
<div className="px-4 pb-3 relative">
```

- [ ] **Step 6: Fix card drag — disable inner button pointer events in edit mode**

For each card, the inner `<button onClick={() => router.push(...)}>` should not fire in edit mode. Add `onPointerDown` to stop the event from being consumed before dnd-kit's 300ms delay:

Find each card button and add:
```tsx
<button
  onClick={() => !sectionEditMode && router.push("/health")}
  onPointerDown={e => { if (sectionEditMode) e.stopPropagation() }}
  ...
>
```

Wait — this would actually prevent drag because `stopPropagation` on `pointerdown` stops dnd-kit from seeing the event. The correct fix is the opposite: in edit mode, prevent the `click` from firing but allow pointer events to bubble:

```tsx
<button
  onClick={e => { if (sectionEditMode) { e.preventDefault(); return } router.push("/health") }}
  ...
>
```

This lets `pointerdown` bubble to `HomeSortableSection`'s drag ref while cancelling the navigation click in edit mode.

- [ ] **Step 7: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "card widget colours from localStorage; colour dot overlay in edit mode"
```

---

## Task 3: Card Widget Colour Picker in Profile

**Files:**
- Modify: `app/profile/profile-content.tsx`

- [ ] **Step 1: Add `CARD_COLORS_KEY`, `CARD_DEFAULT_COLORS`, and `loadCardColors` to profile-content.tsx**

Open `app/profile/profile-content.tsx`. Find `const PILL_COLORS_KEY = "ta_pill_colors"` (line 28). After the `loadPillColors` function, add:

```typescript
const CARD_COLORS_KEY = "ta_card_colors"

const CARD_DEFAULT_COLORS: Record<string, string> = {
  weightSparkline: '#00d4ff',
  nutritionDonut:  '#bf5fff',
  sleepWidget:     '#60a5fa',
  stepsWidget:     '#fb923c',
  moodWidget:      '#f472b6',
}

function loadCardColors(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(CARD_COLORS_KEY) : null
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
```

- [ ] **Step 2: Add `cardColors` state**

Find where `pillColors` state is declared (line 157):
```typescript
const [pillColors, setPillColors] = useState<Record<string, string>>(() => loadPillColors())
```

Add after it:
```typescript
const [cardColors, setCardColors] = useState<Record<string, string>>(() => loadCardColors())
```

- [ ] **Step 3: Add colour picker to each Card Widget row**

Find the Card Widgets subsection in profile-content.tsx (around line 902). It currently renders each card widget as a toggle button. Read the exact structure — it looks approximately like:

```tsx
{CARD_WIDGET_DEFS.map(def => (
  <button
    key={def.key}
    onClick={() => toggleCardWidget(def.key)}
    className="..."
  >
    <def.icon className="h-4 w-4" />
    <span>{def.label}</span>
    {homeCardWidgets.includes(def.key) ? <CheckCircle2 ... /> : <Circle ... />}
  </button>
))}
```

Replace each row with a flex wrapper that includes a colour dot before the toggle button:

```tsx
{CARD_WIDGET_DEFS.map(def => {
  const currentColor = cardColors[def.key] ?? CARD_DEFAULT_COLORS[def.key]
  return (
    <div key={def.key} className="flex items-center gap-2 py-0.5">
      {/* colour dot — opens native colour picker */}
      <label className="relative flex-none cursor-pointer shrink-0" title={`Change ${def.label} colour`}>
        <div
          className="w-6 h-6 rounded-full border-2 border-background shadow-sm"
          style={{ background: currentColor }}
        />
        <input
          type="color"
          value={currentColor}
          onChange={e => {
            const next = { ...cardColors, [def.key]: e.target.value }
            setCardColors(next)
            localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next))
          }}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
      </label>

      {/* existing toggle button — keep all existing classes/content */}
      <button
        className="flex-1 flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-left active:scale-[0.98] transition"
        onClick={() => toggleCardWidget(def.key)}
      >
        <def.icon className="h-4 w-4 flex-none" style={{ color: currentColor }} />
        <span className="text-sm flex-1">{def.label}</span>
        {homeCardWidgets.includes(def.key)
          ? <CheckCircle2 className="h-4 w-4 text-brand flex-none" />
          : <Circle className="h-4 w-4 text-muted-foreground/40 flex-none" />}
      </button>

      {/* reset link — only shown when overridden */}
      {cardColors[def.key] && (
        <button
          className="text-[10px] text-muted-foreground underline flex-none"
          onClick={() => {
            const next = { ...cardColors }
            delete next[def.key]
            setCardColors(next)
            localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next))
          }}
        >
          reset
        </button>
      )}
    </div>
  )
})}
```

> Note: read the actual surrounding JSX in the file before applying — match the existing toggle button's exact className and children. The key additions are the `<label>` colour dot wrapper and the reset button.

- [ ] **Step 4: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/profile/profile-content.tsx
git commit -m "card widget colour pickers in Profile Home Widgets section"
```

---

## Push

```bash
git push -u origin main
```

---

## Testing Checklist

**Scroll fix:**
- Enter edit mode (tap grid icon on home screen)
- Try to scroll the page — page should scroll normally even with grip handles visible
- Long-hold a section for ~300ms — drag should activate

**Card widget drag:**
- Enter edit mode
- Long-hold a card widget (Weight Trend, Nutrition, Sleep, etc.) for ~300ms
- Drag it to a new position — page should reorder and persist on reload
- Exit edit mode — cards should be in the new order

**Card colours in edit mode:**
- Enter edit mode
- A coloured dot appears top-right of each card
- Tap the dot — native colour picker opens
- Select a new colour — card background changes immediately
- Exit edit mode — card retains new colour

**Card colours in Profile:**
- Open Profile → Home Widgets → Card Widgets section
- Each card widget row shows a coloured circle to its left
- Tap circle → native colour picker
- Change colour → return to home — card shows new colour
- "reset" text link appears when colour is overridden → tap resets to default
