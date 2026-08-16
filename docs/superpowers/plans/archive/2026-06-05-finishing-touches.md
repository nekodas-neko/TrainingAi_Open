> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Finishing Touches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six independent polish features: smarter volume prioritisation in the AI workout builder, clean session naming, individually-draggable home-screen card widgets, custom save-name in nutrition, icon components replacing static emoji, and a free-hue colour picker.

**Architecture:** Each task is a self-contained change. Tasks 1–2 touch only the server-side AI prompt. Task 3 refactors the client section-order state. Task 4 adds one input to a form component. Task 5 swaps literals for icon components in two files. Task 6 adds a slider to the theme picker and an `oklchToRgb` helper. No new API routes, no DB changes.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, Lucide React (already installed), `@phosphor-icons/react` (already installed), `@dnd-kit/react` (already installed), `oklch` CSS color space, `lib/brand-themes.ts`.

---

## File Map

| File | Change |
|------|--------|
| `app/api/generate-program/route.ts` | Rewrite rules 7–12 to add muscle-priority ordering; enforce clean session names |
| `lib/utils.ts` | Improve `shortSessionName()` to also strip common redundant suffixes |
| `app/session-select/session-select-content.tsx` | Replace cardWidgets block with individual draggable card sections; replace three emoji literals with Lucide icons |
| `app/profile/profile-content.tsx` | Replace emoji strings in WIDGET_DEFS / CARD_WIDGET_DEFS with Lucide icon components |
| `components/nutrition/review-step.tsx` | Add custom-name input below the "Save to library" toggle |
| `components/theme-color-picker.tsx` | Add hue slider + `oklchToRgb` helper + `applyCustomHue` function |
| `lib/brand-themes.ts` | Export `BRAND_THEME_STORAGE_KEY` (already exported) and add `CUSTOM_HUE_STORAGE_KEY` |

---

## Task 1: Workout Builder — Muscle Volume Priority

**File:** `app/api/generate-program/route.ts`

The current prompt has rules about volume targets but doesn't tell the AI to fill large muscles first. The AI ends up distributing exercises evenly, sometimes starving chest/back/legs of their target sets. The fix is to rewrite rules 7–12 so they:
1. Name the four largest muscle groups (chest, back, quads+hamstrings, glutes) as *priority muscles* that must reach the top of their weekly set range before smaller muscles get direct work.
2. Keep the existing "small muscles get compound carry" note.
3. Maintain the recovery-aware adjacency rule (rule 11 currently).

- [ ] **Step 1: Update the rules block in the userPrompt template**

In `app/api/generate-program/route.ts`, replace the `Rules:` section (lines 222–232) with the following:

```typescript
// Replace the entire rules block inside the template literal:
Rules:
1. Use the recommended split for the given frequency above.
2. Use ONLY exercises from the list below. Match exercise names exactly.
3. Assign each exercise a role: "primary" (main compound), "secondary" (secondary compound), or "accessory" (isolation/single-joint).
4. Assign each exercise a progressionStyleName from the available styles listed above. Use the exact style name string.
5. IMPORTANT: The sum of (~style time × exercise count) per session must fit within the working time budget.
6. Structure each session as: 2–3 compound exercises + 1–2 isolation exercises.
7. MUSCLE PRIORITY — build the exercise list in this order:
   a. FIRST: ensure LARGE muscles (chest, back, quads, hamstrings, glutes) each accumulate ${inputs.goal === 'hypertrophy' ? '15–20' : inputs.goal === 'strength' ? '20–25' : '15–20'} sets/week across all sessions. Distribute them across 2 sessions/week minimum.
   b. THEN: add direct work for SMALL muscles (shoulders, biceps, triceps, calves, core) only AFTER large muscles are covered. Small muscles get 6–10 direct sets/week — they receive compound carry from large-muscle exercises.
   c. If time runs out, cut small-muscle isolation exercises first. Never cut large-muscle compounds.
8. Large muscles (chest, back, quads, hamstrings, glutes): aim for the UPPER end of the set range (${inputs.goal === 'hypertrophy' ? '15–20' : inputs.goal === 'strength' ? '20–25' : '15–20'} sets/week). Shoulders, arms, calves, core: lower end (6–10 direct sets/week) is sufficient.
9. Small muscles (biceps, triceps, calves, core): 6–10 direct sets/week is sufficient — they get compound carry.
10. Pick a session icon emoji matching the session focus.
11. MUSCLE RECOVERY (critical for rolling rotation): Sessions that run on consecutive training days must NOT share primary muscle groups. The session ORDER in your output determines the training day sequence — adjacent sessions in the list will be trained back-to-back. Ensure each consecutive pair of sessions targets different primary muscles (e.g. Push then Pull is fine; Push then Chest/Shoulders is not).
12. Before finalising: tally sets per muscle across all sessions. Confirm large muscles hit their target. Confirm time budget is met. Confirm no consecutive sessions share primary muscles.
```

- [ ] **Step 2: Commit**

```bash
git add app/api/generate-program/route.ts
git commit -m "feat: prioritise large muscle volume in workout builder prompt"
```

---

## Task 2: Clean Session Names

**Files:** `app/api/generate-program/route.ts`, `lib/utils.ts`

The AI currently generates names like "Push A (Chest/Shoulders/Triceps)". `shortSessionName()` strips parentheses but the base name can still be long ("Upper Body Push", "Lower Body Pull"). The fix is two-pronged:
1. Tell the AI to use standard short names (Push, Pull, Legs, Upper A, Lower B, Full Body).
2. Cap `shortSessionName()` at 12 characters as a safety net.

- [ ] **Step 1: Add session naming rule to the AI prompt**

In `app/api/generate-program/route.ts`, find the line in the `Rules:` block that says `10. Pick a session icon emoji matching the session focus.` and add a new rule before it (renumbering 10→11, 11→12, 12→13, keeping the rule about emoji):

```typescript
// Add this as new rule 10, before the emoji rule:
10. SESSION NAMES — use SHORT standard names only. Do NOT include muscle lists or parenthetical annotations.
    - 3-day splits: "Push", "Pull", "Legs"
    - 4-day Upper/Lower: "Upper A", "Upper B", "Lower A", "Lower B"  
    - 4-day PPL+Upper: "Push", "Pull", "Legs", "Upper"
    - 2-day or Full Body: "Full Body A", "Full Body B" (or just "Full Body" for 1-day)
    - 5-day: "Push", "Pull", "Legs", "Upper", "Lower"
    - 6-day: "Push A", "Push B", "Pull A", "Pull B", "Legs A", "Legs B"
    - Arms/Core/Cardio days: "Arms", "Core", "Cardio"
    - NEVER generate a name like "Push (Chest/Shoulders/Triceps)" or "Upper Body Push Day" — keep it to 1–2 words maximum.
11. Pick a session icon emoji matching the session focus.
12. MUSCLE RECOVERY ...  (renumber existing 11)
13. Before finalising: ... (renumber existing 12)
```

- [ ] **Step 2: Tighten `shortSessionName()` in `lib/utils.ts`**

Find `shortSessionName` in `lib/utils.ts`. It currently strips parenthetical suffixes. Add a 14-character hard cap:

```typescript
// Find the existing shortSessionName function and replace it:
export function shortSessionName(name: string): string {
  // Strip parenthetical muscle annotations: "Push A (Chest/Shoulders)" → "Push A"
  const stripped = name.replace(/\s*\([^)]*\)\s*$/, '').trim()
  // Hard cap at 14 chars to protect legend layout
  return stripped.length > 14 ? stripped.slice(0, 13).trimEnd() + '…' : stripped
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/generate-program/route.ts lib/utils.ts
git commit -m "feat: enforce clean session names in builder prompt; cap shortSessionName at 14 chars"
```

---

## Task 3: Individual Card Widget Drag

**File:** `app/session-select/session-select-content.tsx`

Currently the five card widgets (Weight Sparkline, Nutrition, Sleep, Steps, Mood) are rendered inside a single `"cardWidgets"` section that moves as one block. The user wants each enabled card widget to be independently draggable anywhere in the home feed.

**Approach:** Expand `SectionKey` to include a `card_${CardWidgetKey}` variant. When `activeCardWidgets` changes, synchronise those keys into `sectionOrder`. The render switch handles each `card_*` case individually. Migrate any stored `"cardWidgets"` entry to its constituent card keys on load.

- [ ] **Step 1: Update the `SectionKey` type and `loadSectionOrder`**

Find the `SectionKey` type and `loadSectionOrder` function near line 159 of `session-select-content.tsx`. Replace them with:

```typescript
type CardSectionKey = `card_${CardWidgetKey}`
type SectionKey = "recommendation" | "streak" | "weekStrip" | "metricTiles" | CardSectionKey

const CARD_SECTION_PREFIX = "card_" as const

// Default order has no card widgets — they get inserted when enabled
const DEFAULT_SECTION_ORDER: SectionKey[] = ["recommendation", "streak", "weekStrip", "metricTiles"]
const SECTION_ORDER_KEY = "ta_home_section_order"

function loadSectionOrder(activeCards: CardWidgetKey[]): SectionKey[] {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(SECTION_ORDER_KEY) : null
    if (!raw) {
      // Insert enabled card widgets before metricTiles in the default order
      const defaults: SectionKey[] = ["recommendation", "streak", "weekStrip"]
      activeCards.forEach(k => defaults.push(`card_${k}` as CardSectionKey))
      defaults.push("metricTiles")
      return defaults
    }
    let parsed: SectionKey[] = JSON.parse(raw)
    // Migrate old "cardWidgets" block → individual card keys
    if ((parsed as string[]).includes("cardWidgets")) {
      const idx = (parsed as string[]).indexOf("cardWidgets")
      const cardKeys = activeCards.map(k => `card_${k}` as CardSectionKey)
      parsed = [...parsed.slice(0, idx), ...cardKeys, ...parsed.slice(idx + 1)] as SectionKey[]
      parsed = parsed.filter(k => k !== "cardWidgets" as never)
    }
    // Ensure all default non-card sections are present
    const nonCard: SectionKey[] = ["recommendation", "streak", "weekStrip", "metricTiles"]
    const missing = nonCard.filter(k => !parsed.includes(k))
    return [...parsed, ...missing]
  } catch {
    const defaults: SectionKey[] = ["recommendation", "streak", "weekStrip"]
    activeCards.forEach(k => defaults.push(`card_${k}` as CardSectionKey))
    defaults.push("metricTiles")
    return defaults
  }
}
```

- [ ] **Step 2: Update the `sectionOrder` state initialisation**

Find where `sectionOrder` state is initialised (near line 175 or wherever `useState(loadSectionOrder)` appears). Change it to pass `activeCardWidgets` as an argument. Since `activeCardWidgets` is also state, initialise both from localStorage in the same init block:

```typescript
// Replace the existing sectionOrder useState with:
const [activeCardWidgets, setActiveCardWidgets] = useState<CardWidgetKey[]>(() => loadCardWidgets())
const [sectionOrder, setSectionOrder] = useState<SectionKey[]>(() => loadSectionOrder(loadCardWidgets()))
```

(If `activeCardWidgets` was already initialised this way, just update the `sectionOrder` init to pass the loaded cards.)

- [ ] **Step 3: Sync card widgets into sectionOrder when activeCardWidgets changes**

After the existing `useEffect` that saves `activeCardWidgets` to localStorage, add a new effect that keeps `sectionOrder` in sync:

```typescript
useEffect(() => {
  setSectionOrder(prev => {
    const enabledCardKeys = new Set(activeCardWidgets.map(k => `card_${k}` as CardSectionKey))
    // Remove card keys that are no longer enabled
    const filtered = prev.filter(k => {
      if (k.startsWith(CARD_SECTION_PREFIX)) return enabledCardKeys.has(k as CardSectionKey)
      return true
    })
    // Append newly-enabled card keys (not yet in the order) before metricTiles
    const existingSet = new Set(filtered)
    const toAdd = activeCardWidgets
      .map(k => `card_${k}` as CardSectionKey)
      .filter(k => !existingSet.has(k))
    if (toAdd.length === 0 && filtered.length === prev.length) return prev // no change
    const metricIdx = filtered.indexOf("metricTiles")
    const insertAt = metricIdx >= 0 ? metricIdx : filtered.length
    const next = [...filtered.slice(0, insertAt), ...toAdd, ...filtered.slice(insertAt)]
    localStorage.setItem(SECTION_ORDER_KEY, JSON.stringify(next))
    return next
  })
}, [activeCardWidgets])
```

- [ ] **Step 4: Update the render switch to handle individual card keys**

In the `sectionOrder.map` render block (around line 763), the `switch (key)` currently has a `"cardWidgets"` case that renders all widgets in one block. Replace the `"cardWidgets"` case with individual `card_*` cases:

```typescript
// Remove the entire "cardWidgets" case and replace with individual cases:
case "card_weightSparkline": {
  if (!activeCardWidgets.includes("weightSparkline")) return null
  // Copy the exact existing weightSparkline JSX here (was inside the cardWidgets block)
  return (() => {
    // ... exact same JSX as before but returned directly, not inside the outer div
    // Wrap in: <div className="px-4 pb-3"> ... </div>
  })()
}
case "card_nutritionDonut": {
  if (!activeCardWidgets.includes("nutritionDonut")) return null
  return (() => {
    // ... exact nutritionDonut JSX wrapped in <div className="px-4 pb-3">
  })()
}
case "card_sleepWidget": {
  if (!activeCardWidgets.includes("sleepWidget")) return null
  return (() => {
    // ... exact sleepWidget JSX wrapped in <div className="px-4 pb-3">
  })()
}
case "card_stepsWidget": {
  if (!activeCardWidgets.includes("stepsWidget")) return null
  return (() => {
    // ... exact stepsWidget JSX wrapped in <div className="px-4 pb-3">
  })()
}
case "card_moodWidget": {
  if (!activeCardWidgets.includes("moodWidget")) return null
  return (() => {
    // ... exact moodWidget JSX wrapped in <div className="px-4 pb-3">
  })()
}
```

The JSX content for each widget is identical to what was inside the old `"cardWidgets"` block — it just moves from being children of one outer `<div className="px-4 pb-3 space-y-3">` to being individually wrapped in `<div className="px-4 pb-3">`. Remove the outer `space-y-3` container div.

- [ ] **Step 5: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "feat: make each home screen card widget individually draggable"
```

---

## Task 4: Nutrition Food Save — Custom Name

**File:** `components/nutrition/review-step.tsx`

When the user toggles "Save to my food library", they should be able to give the item a custom name before saving. The `EditableNutrition.name` field already exists — it's just not shown as an editable input in the library-save context.

- [ ] **Step 1: Add a conditional name input after the toggle**

In `review-step.tsx`, find the `"Save to my food library"` label block (around line 289–297). Immediately after the closing `</label>` tag and before the `<div className="flex gap-2 pt-2">` buttons row, add:

```typescript
{value.saveToLibrary && (
  <div className="space-y-1">
    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
      Save as
    </label>
    <input
      type="text"
      value={value.name}
      onChange={e => set('name', e.target.value)}
      placeholder="e.g. Chicken breast 200g"
      className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
      autoCapitalize="none"
    />
  </div>
)}
```

No other changes — the `name` value already flows through to the library save call via `EditableNutrition`.

- [ ] **Step 2: Commit**

```bash
git add components/nutrition/review-step.tsx
git commit -m "feat: custom save name for nutrition library items"
```

---

## Task 5: Replace Static Emoji with Icon Components

**Files:** `app/profile/profile-content.tsx`, `app/session-select/session-select-content.tsx`

The profile page still uses emoji strings in `WIDGET_DEFS` and `CARD_WIDGET_DEFS`. The home screen card widgets use emoji corner icons (🌙, 👣, 💭). These should use Lucide icon components for crisp vector rendering. Mood emotion emojis and session icon emojis stay as-is.

### 5a — profile-content.tsx

- [ ] **Step 1: Update imports in `profile-content.tsx`**

Near the top of `app/profile/profile-content.tsx`, add these Lucide imports (or expand the existing import if it has some):

```typescript
import {
  Scale, Footprints, Flame, Route, Beef, Wheat, Droplets,
  TrendingUp, Apple, Moon, MessageCircle,
  type LucideIcon,
} from 'lucide-react'
```

- [ ] **Step 2: Replace `WIDGET_DEFS` emoji strings with icon components**

Find `WIDGET_DEFS` (around line 32 in profile-content.tsx) and replace:

```typescript
const WIDGET_DEFS: { key: MetaKey; label: string; icon: LucideIcon }[] = [
  { key: "weightKg",   label: "Body Weight", icon: Scale      },
  { key: "steps",      label: "Steps",       icon: Footprints },
  { key: "calories",   label: "Calories",    icon: Flame      },
  { key: "distanceKm", label: "Distance",    icon: Route      },
  { key: "protein",    label: "Protein",     icon: Beef       },
  { key: "carb",       label: "Carbs",       icon: Wheat      },
  { key: "fat",        label: "Fat",         icon: Droplets   },
]
```

- [ ] **Step 3: Replace `CARD_WIDGET_DEFS` emoji strings with icon components**

Find `CARD_WIDGET_DEFS` (around line 42) and replace:

```typescript
const CARD_WIDGET_DEFS: { key: CardWidgetKey; label: string; icon: LucideIcon }[] = [
  { key: "weightSparkline", label: "Weight Trend", icon: TrendingUp    },
  { key: "nutritionDonut",  label: "Nutrition",    icon: Apple         },
  { key: "sleepWidget",     label: "Sleep",        icon: Moon          },
  { key: "stepsWidget",     label: "Steps",        icon: Footprints    },
  { key: "moodWidget",      label: "Mood",         icon: MessageCircle },
]
```

- [ ] **Step 4: Update render sites in profile-content.tsx**

Search for `{def.emoji}` (or `def.emoji`) in `profile-content.tsx` — there will be 1–2 places in the Home Widgets section. Replace each occurrence with `<def.icon className="h-4 w-4" />`. For example:

```typescript
// Before:
<span className="text-lg">{def.emoji}</span>
// After:
<def.icon className="h-4 w-4" />
```

### 5b — session-select-content.tsx corner icons

- [ ] **Step 5: Replace emoji corner icons in the three card widgets**

In `app/session-select/session-select-content.tsx`, find and replace the three emoji spans inside the card widget buttons:

```typescript
// Sleep widget — find:
<span className="text-2xl">🌙</span>
// Replace with:
<Moon className="h-6 w-6" style={{ color: "#a78bfa" }} />

// Steps widget — find:
<span className="text-2xl">👣</span>
// Replace with:
<Footprints className="h-6 w-6" style={{ color: "#00d4ff" }} />

// Mood widget — find:
<span className="text-2xl">💭</span>
// Replace with:
<MessageCircle className="h-6 w-6" style={{ color: "#fbbf24" }} />
```

Make sure `Moon`, `Footprints`, `MessageCircle` are added to the existing Lucide import line at the top of `session-select-content.tsx`.

- [ ] **Step 6: Commit**

```bash
git add app/profile/profile-content.tsx app/session-select/session-select-content.tsx
git commit -m "feat: replace static emoji with Lucide icon components in widget labels"
```

---

## Task 6: Free-Hue Colour Picker

**Files:** `components/theme-color-picker.tsx`, `lib/brand-themes.ts`

The current theme picker has 8 fixed colour presets. The user wants to pick any hue via a slider. The approach: add a hue slider (0–360°) that derives the brand colour as `oklch(0.7 0.2 {hue})` and applies it by setting CSS custom properties directly on `<html>`. The existing 8 presets remain as quick-picks.

The hard part is converting `oklch(L C H)` to `rgb(r g b)` to populate the `--brand-card-bg/border/glow` variables (which need rgba values). A pure-JS OKLCH→sRGB conversion function handles this.

- [ ] **Step 1: Add `CUSTOM_HUE_STORAGE_KEY` to `lib/brand-themes.ts`**

```typescript
// Add at the bottom of lib/brand-themes.ts:
export const CUSTOM_HUE_STORAGE_KEY = "ta_brand_hue"
```

- [ ] **Step 2: Rewrite `components/theme-color-picker.tsx`**

Replace the entire file with:

```typescript
"use client"

import { useEffect, useState } from "react"
import { CheckIcon } from "lucide-react"
import {
  BRAND_THEMES,
  BRAND_THEME_STORAGE_KEY,
  CUSTOM_HUE_STORAGE_KEY,
  type BrandThemeKey,
} from "@/lib/brand-themes"

export { BRAND_THEMES, type BrandThemeKey }

// OKLCH → linear sRGB → gamma-corrected sRGB
function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const hRad = (H * Math.PI) / 180
  const a = C * Math.cos(hRad)
  const b = C * Math.sin(hRad)
  // OKLab → LMS (cubed)
  const l3 = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m3 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s3 = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  // LMS → linear sRGB
  const lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3
  const g = (x: number) =>
    x >= 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : 12.92 * x
  return [
    Math.round(Math.max(0, Math.min(255, g(lr) * 255))),
    Math.round(Math.max(0, Math.min(255, g(lg) * 255))),
    Math.round(Math.max(0, Math.min(255, g(lb) * 255))),
  ]
}

export function applyCustomHue(hue: number) {
  const [r, g, b] = oklchToRgb(0.7, 0.2, hue)
  const html = document.documentElement
  delete html.dataset.brand
  html.style.setProperty("--brand", `oklch(0.7 0.2 ${hue})`)
  html.style.setProperty("--color-brand", `oklch(0.7 0.2 ${hue})`)
  html.style.setProperty("--brand-card-bg", `rgba(${r},${g},${b},0.07)`)
  html.style.setProperty("--brand-card-border", `rgba(${r},${g},${b},0.18)`)
  html.style.setProperty("--brand-glow", `rgba(${r},${g},${b},0.25)`)
  localStorage.setItem(CUSTOM_HUE_STORAGE_KEY, String(hue))
  localStorage.removeItem(BRAND_THEME_STORAGE_KEY)
}

export function applyBrandTheme(key: BrandThemeKey) {
  const html = document.documentElement
  // Clear any custom hue inline styles
  html.style.removeProperty("--brand")
  html.style.removeProperty("--color-brand")
  html.style.removeProperty("--brand-card-bg")
  html.style.removeProperty("--brand-card-border")
  html.style.removeProperty("--brand-glow")
  if (key === "green") {
    delete html.dataset.brand
  } else {
    html.dataset.brand = key
  }
  localStorage.setItem(BRAND_THEME_STORAGE_KEY, key)
  localStorage.removeItem(CUSTOM_HUE_STORAGE_KEY)
}

export function ThemeColorPicker() {
  const [activePreset, setActivePreset] = useState<BrandThemeKey | null>("green")
  const [hue, setHue] = useState<number | null>(null)

  useEffect(() => {
    const savedHue = localStorage.getItem(CUSTOM_HUE_STORAGE_KEY)
    if (savedHue !== null) {
      const h = Number(savedHue)
      setHue(h)
      setActivePreset(null)
      applyCustomHue(h)
      return
    }
    const savedTheme = localStorage.getItem(BRAND_THEME_STORAGE_KEY) as BrandThemeKey | null
    if (savedTheme && BRAND_THEMES.some(t => t.key === savedTheme)) {
      setActivePreset(savedTheme)
      applyBrandTheme(savedTheme)
    }
  }, [])

  function handlePreset(key: BrandThemeKey) {
    setActivePreset(key)
    setHue(null)
    applyBrandTheme(key)
  }

  function handleHueChange(h: number) {
    setHue(h)
    setActivePreset(null)
    applyCustomHue(h)
  }

  const displayHue = hue ?? (
    activePreset
      ? BRAND_THEMES.find(t => t.key === activePreset)
          ? null // keep slider neutral when a preset is active
          : null
      : null
  )

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Accent colour
      </p>

      {/* Hue slider */}
      <div className="space-y-2">
        <div className="relative h-6 rounded-full overflow-hidden cursor-pointer"
          style={{
            background:
              "linear-gradient(to right," +
              "hsl(0,80%,60%),hsl(30,80%,60%),hsl(60,80%,60%),hsl(90,80%,60%)," +
              "hsl(120,80%,60%),hsl(150,80%,60%),hsl(180,80%,60%),hsl(210,80%,60%)," +
              "hsl(240,80%,60%),hsl(270,80%,60%),hsl(300,80%,60%),hsl(330,80%,60%),hsl(360,80%,60%))",
          }}
        >
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={displayHue ?? 149}
            onChange={e => handleHueChange(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            aria-label="Colour hue"
          />
          {/* Thumb indicator */}
          {displayHue !== null && (
            <div
              className="absolute top-0.5 bottom-0.5 w-5 rounded-full border-2 border-white shadow-md pointer-events-none"
              style={{
                left: `calc(${(displayHue / 360) * 100}% - 10px)`,
                background: `oklch(0.7 0.2 ${displayHue})`,
              }}
            />
          )}
        </div>
      </div>

      {/* Preset swatches */}
      <div className="flex gap-3 flex-wrap">
        {BRAND_THEMES.map(({ key, label, hex }) => (
          <button
            key={key}
            title={label}
            onClick={() => handlePreset(key)}
            className="relative h-8 w-8 rounded-full transition-transform active:scale-90"
            style={{ background: hex }}
          >
            {activePreset === key && (
              <CheckIcon className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/theme-color-picker.tsx lib/brand-themes.ts
git commit -m "feat: free-hue colour picker with OKLCH slider"
```

---

## Final Push

After all tasks are committed:

```bash
git push -u origin claude/finishing-touches-z5wj2
```

---

## Testing Checklist

**Task 1 (Volume Priority):** Generate a Push/Pull/Legs program with hypertrophy goal. Open the builder review screen. Check that Chest gets 3–4 exercises across Push sessions (15–20 sets/week) before Biceps gets any direct work.

**Task 2 (Clean Names):** Generate a 4-day Upper/Lower program. Session names should be "Upper A", "Upper B", "Lower A", "Lower B" — no parenthetical suffixes.

**Task 3 (Individual Widget Drag):** Enable Sleep + Nutrition in Profile → Home Widgets. Return to home. Enter edit mode (grid icon). Confirm Sleep and Nutrition cards each have their own drag handle and can be moved independently between other sections.

**Task 4 (Custom Name):** Open nutrition logger, scan or describe a food, proceed to Review. Toggle "Save to my food library". Confirm a text input appears pre-filled with the detected name. Edit it. Confirm it saves with the custom name.

**Task 5 (Icons):** Open Profile → Home Widgets. Confirm widget list shows Lucide icon components (crisp vector) not emoji glyphs. Return home, open Sleep/Steps/Mood widgets — confirm corner icons are Lucide vectors.

**Task 6 (Hue Slider):** Open Profile → Appearance. Drag the rainbow slider — accent colour updates live across the app (buttons, active states, card borders). Select a preset swatch — slider indicator clears and preset is applied. Close and reopen profile — colour is persisted.
