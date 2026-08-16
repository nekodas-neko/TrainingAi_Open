# Design, Accessibility & Cleanup Uplift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining design/accessibility/cleanup gaps found during the 2026-06-12 deep review: a light-mode contrast risk in the shared `accentCardStyle` helper, two dead/orphaned component files, the still-open B11 touch-target issue on the Health page info buttons, inconsistent translucent-card styling on the activity "done" screen, and a missing loading state on the weather chip.

**Architecture:** This is a backlog of **6 independent tasks** — pick any one, implement, verify, and commit on its own. They touch disjoint files (`lib/utils.ts` + `app/globals.css`, two file deletions, `app/health/health-content.tsx`, `components/activity/done-activity-screen.tsx`, `components/weather-chip.tsx`) and share no code. Do not attempt all six in one commit.

**Tech Stack:** Tailwind CSS v4 (`color-mix()` + CSS custom properties), Next.js 15 App Router, React 19.

**Note on the "missing `prefers-reduced-motion`" finding:** the review's draft notes flagged this as a possible gap, but on inspection `components/dynamic-background/particles.tsx` already applies `motion-reduce:animate-none` to every animated particle (`Stars`, `Clouds`, `RainStreaks`, `SnowParticles`, `FogBands`) and `motion-reduce:hidden` to `LightningFlashes`. `CelestialLayer` and `SkyLayer` have no animations. **No task needed** — this finding is already resolved in the current codebase.

**Prerequisite:** None of these tasks touch the database. `pnpm dev` is enough for visual verification; the local dev Postgres (`pnpm db:local`, already running per `CLAUDE.md`) is only needed if you also want to log in as `test@local.dev` to view the Health/Activity pages with real data.

---

### Task 1: Fix light-mode contrast risk in `accentCardStyle`

**Problem:** `accentCardStyle()` (used throughout `app/health/health-content.tsx` for every colored stat card) hardcodes `backgroundColor: 'color-mix(in oklch, var(--muted) 60%, transparent)'`. In dark mode `--muted: oklch(0.13 0 0)` (near-black), so a 60%-opacity near-black card reads clearly against the page background. In light mode `--muted: oklch(0.97 0 0)` (near-white) sitting on a near-white `--background: oklch(1 0 0)` page — a 60%-opacity near-white card barely separates from the page, and the `rgba(r,g,b,0.12–0.3)` accent gradient on top of it can leave low-contrast text in bright themes. The fix introduces a `--card-tint-pct` CSS variable so light and dark mode can use different opacities without duplicating the helper or hardcoding a single value that only works for one theme.

**Files:**
- Modify: `lib/utils.ts:53`
- Modify: `app/globals.css` (`:root` block ends line 91, `.dark` block starts line 93)

- [ ] **Step 1: Add `--card-tint-pct` to `:root` and `.dark` in `app/globals.css`**

Current `:root` block (lines 55-61):

```css
  --brand: oklch(0.723 0.219 149.579); /* green — default */
  --brand-card-bg: rgba(0, 255, 135, 0.04);
  --brand-card-border: rgba(0, 255, 135, 0.10);
  --brand-glow: rgba(0, 255, 135, 0.12);
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
```

Change to:

```css
  --brand: oklch(0.723 0.219 149.579); /* green — default */
  --brand-card-bg: rgba(0, 255, 135, 0.04);
  --brand-card-border: rgba(0, 255, 135, 0.10);
  --brand-glow: rgba(0, 255, 135, 0.12);
  --radius: 0.625rem;
  /* Higher tint % in light mode keeps accentCardStyle() cards readable
     against the near-white --background (see lib/utils.ts accentCardStyle). */
  --card-tint-pct: 88%;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
```

Current `.dark` block (lines 93-96):

```css
.dark {
  --background: oklch(0.05 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.09 0 0);
```

Change to:

```css
.dark {
  --background: oklch(0.05 0 0);
  --foreground: oklch(0.985 0 0);
  /* Matches the original hardcoded 60% used by accentCardStyle() — dark
     --muted is near-black, so 60% already contrasts fine here. */
  --card-tint-pct: 60%;
  --card: oklch(0.09 0 0);
```

- [ ] **Step 2: Use the variable in `accentCardStyle`**

In `lib/utils.ts`, the function currently reads (lines 46-61):

```ts
export function accentCardStyle(hex: string): CSSProperties {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    // Translucent --muted base (matches the Training Load card) keeps the
    // accent gradient readable against the bright dynamic sky background.
    backgroundColor: 'color-mix(in oklch, var(--muted) 60%, transparent)',
    backgroundImage: `linear-gradient(135deg, rgba(${r},${g},${b},0.3), rgba(${r},${g},${b},0.12))`,
    border: `1px solid rgba(${r},${g},${b},0.4)`,
    // Force each card onto its own GPU compositor layer so SVG icons inside
    // one card can't cause sibling cards' rgba/gradient backgrounds to disappear
    // on Samsung WebView (known compositor bug).
    willChange: 'transform',
  };
}
```

Change line 53 to:

```ts
    backgroundColor: 'color-mix(in oklch, var(--muted) var(--card-tint-pct, 60%), transparent)',
```

The `, 60%` fallback in `color-mix()` keeps this safe even if the variable is ever missing (e.g. an older cached stylesheet during a deploy).

- [ ] **Step 3: Type-check and lint**

Run:
```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors.

- [ ] **Step 4: Verify visually in both themes**

Start the dev server:
```bash
pnpm dev
```

Open `http://localhost:3000/health` (log in as `test@local.dev` / `testpass123` if not already authenticated):
1. In **light mode** (Profile/More → theme toggle, or system default), check the "Lean Mass", "Steps", "Sleep", "Dist", "Water", "Burned", "BMI", "Trend", "Balance" cards — each card's tinted background should now be visibly distinct from the page background, with the colored text/labels clearly readable.
2. Switch to **dark mode** and confirm the same cards look **unchanged** from before this change (60% tint preserved).

- [ ] **Step 5: Commit**

```bash
git add lib/utils.ts app/globals.css
git commit -m "Add --card-tint-pct variable to fix accentCardStyle light-mode contrast"
```

---

### Task 2: Delete dead `app/history/history-content.tsx`

**Problem:** `app/history/page.tsx` redirects unconditionally to `/stats`:

```tsx
import { redirect } from "next/navigation";
export default function HistoryPage() {
  redirect("/stats");
}
```

`app/history/history-content.tsx` (336 lines, `export default function HistoryContent()`) is never imported by `page.tsx` or anywhere else — confirmed dead in `projectOverview.md` (H4: "`app/history/history-content.tsx` is dead code... never imported by any route").

**Files:**
- Delete: `app/history/history-content.tsx`

- [ ] **Step 1: Confirm there are no remaining references**

```bash
grep -rn "history-content\|HistoryContent" --include="*.ts" --include="*.tsx" .
```

Expected: only `app/history/history-content.tsx` itself matches (its own `export default function HistoryContent()` declaration). If anything else matches, stop and investigate before deleting.

- [ ] **Step 2: Delete the file**

```bash
git rm app/history/history-content.tsx
```

- [ ] **Step 3: Type-check, lint, and build**

```bash
npx tsc --noEmit
pnpm lint
pnpm build
```

Expected: all pass — `app/history/page.tsx`'s `redirect("/stats")` doesn't reference the deleted file, so nothing breaks.

- [ ] **Step 4: Verify the route still redirects**

```bash
pnpm dev
```

Open `http://localhost:3000/history` — expect an immediate redirect to `/stats` (unchanged behaviour).

- [ ] **Step 5: Commit**

```bash
git commit -m "Remove dead app/history/history-content.tsx"
```

---

### Task 3: Delete orphaned `components/nutrition/saved-meals-section.tsx`

**Problem:** `components/nutrition/saved-meals-section.tsx` (158 lines, `export function SavedMealsSection({ onOpenBuilder, onLogged }: Props)`) was replaced by `SavedMealsSheet` in `app/nutrition/nutrition-content.tsx` (per `projectOverview.md`: "replaced `SavedMealsSection` + `MealBuilderSheet` with `SavedMealsSheet` + entry button row"). The old component is no longer imported anywhere.

**Files:**
- Delete: `components/nutrition/saved-meals-section.tsx`

- [ ] **Step 1: Confirm there are no remaining references**

```bash
grep -rn "saved-meals-section\|SavedMealsSection" --include="*.ts" --include="*.tsx" .
```

Expected: only `components/nutrition/saved-meals-section.tsx` itself matches (its own `export function SavedMealsSection` declaration). If `app/nutrition/nutrition-content.tsx` or any other file imports it, stop and investigate before deleting.

- [ ] **Step 2: Delete the file**

```bash
git rm components/nutrition/saved-meals-section.tsx
```

- [ ] **Step 3: Type-check, lint, and build**

```bash
npx tsc --noEmit
pnpm lint
pnpm build
```

Expected: all pass.

- [ ] **Step 4: Verify the Nutrition page still works**

```bash
pnpm dev
```

Open `http://localhost:3000/nutrition`, open the "Saved meals" sheet, and confirm it still lists/logs saved meals correctly (this is `SavedMealsSheet`, untouched by this change — just confirming nothing else depended on the deleted file).

- [ ] **Step 5: Commit**

```bash
git commit -m "Remove orphaned components/nutrition/saved-meals-section.tsx"
```

---

### Task 4: Fix B11 — add `aria-label` and bump touch target on Health info buttons

**Problem:** Four `InfoIcon` toggle buttons on `app/health/health-content.tsx` (Lean Mass, BMI, Weight Trend, Energy Balance cards) have no accessible name (screen readers announce them only as "button") and use `p-2` (32×32dp with the `h-3.5 w-3.5` icon), below the WCAG-recommended 44dp touch target. This matches the previously-documented B11 pattern, where the session-select tile "Log" button was bumped from `p-2` equivalents to `text-[10px] px-2.5 py-2` with the note "Full 44dp isn't achievable for inline icon buttons without a layout redesign — `p-2.5` is the practical improvement." Apply the same `p-2` → `p-2.5` bump here plus `aria-label`s.

**Files:**
- Modify: `app/health/health-content.tsx:589,732,765,792`

- [ ] **Step 1: Lean Mass card info button (line 589)**

Current:

```tsx
                    <button onClick={() => toggleInfo('lean')} className="p-2 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                      <InfoIcon className="h-3.5 w-3.5" />
                    </button>
```

Change to:

```tsx
                    <button onClick={() => toggleInfo('lean')} aria-label="Lean mass info" className="p-2.5 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                      <InfoIcon className="h-3.5 w-3.5" />
                    </button>
```

- [ ] **Step 2: BMI card info button (line 732)**

Current:

```tsx
                  <button onClick={() => toggleInfo('bmi')} className="p-2 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                    <InfoIcon className="h-3.5 w-3.5" />
                  </button>
```

Change to:

```tsx
                  <button onClick={() => toggleInfo('bmi')} aria-label="BMI info" className="p-2.5 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                    <InfoIcon className="h-3.5 w-3.5" />
                  </button>
```

- [ ] **Step 3: Weight Trend card info button (line 765)**

Current:

```tsx
                  <button onClick={() => toggleInfo('trend')} className="p-2 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                    <InfoIcon className="h-3.5 w-3.5" />
                  </button>
```

Change to:

```tsx
                  <button onClick={() => toggleInfo('trend')} aria-label="Weight trend info" className="p-2.5 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                    <InfoIcon className="h-3.5 w-3.5" />
                  </button>
```

- [ ] **Step 4: Energy Balance card info button (line 792)**

Current:

```tsx
                  <button onClick={() => toggleInfo('balance')} className="p-2 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                    <InfoIcon className="h-3.5 w-3.5" />
                  </button>
```

Change to:

```tsx
                  <button onClick={() => toggleInfo('balance')} aria-label="Energy balance info" className="p-2.5 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                    <InfoIcon className="h-3.5 w-3.5" />
                  </button>
```

- [ ] **Step 5: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors.

- [ ] **Step 6: Verify locally**

```bash
pnpm dev
```

Open `http://localhost:3000/health`, tap each of the four info buttons (Lean Mass, BMI, Weight Trend, Energy Balance) and confirm the explanatory panel still opens/closes as before, and the buttons feel slightly larger/easier to tap. Optionally inspect with devtools accessibility tree to confirm each button now has an accessible name ("Lean mass info", "BMI info", "Weight trend info", "Energy balance info").

- [ ] **Step 7: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "Add aria-labels and larger touch targets to Health info buttons (B11)"
```

---

### Task 5: Standardize translucent card styling on the activity "done" screen

**Problem:** `components/activity/done-activity-screen.tsx` uses opaque `bg-muted` (no border, no opacity) for its stat tiles and splits rows, while the rest of the app — including the "Training Load" card and the new `accentCardStyle()` cards — uses the translucent `bg-muted/60 border border-border` convention established to stay legible over the dynamic background. On pages where the dynamic background is enabled for the `workout` section, these tiles look like flat opaque boxes inconsistent with the rest of the UI.

**Files:**
- Modify: `components/activity/done-activity-screen.tsx:78,83,89,100,104,119`

- [ ] **Step 1: Convert the 5 stat tiles (duration, distance, avg pace, elevation gain, elevation loss)**

These five all share the exact class string `"rounded-xl bg-muted px-2 py-3"` (lines 78, 83, 89, 100, 104):

```tsx
        <div className="rounded-xl bg-muted px-2 py-3">
```

Replace **all 5 occurrences** with:

```tsx
        <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
```

Since all 5 lines are identical, use a `replace_all` edit on `"rounded-xl bg-muted px-2 py-3"` → `"rounded-xl bg-muted/60 border border-border px-2 py-3"`.

- [ ] **Step 2: Convert the splits row (line 119)**

Current:

```tsx
            <div key={s.km} className="flex justify-between rounded-lg bg-muted px-3 py-1.5 text-sm">
```

Change to:

```tsx
            <div key={s.km} className="flex justify-between rounded-lg bg-muted/60 border border-border px-3 py-1.5 text-sm">
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors.

- [ ] **Step 4: Verify locally**

```bash
pnpm dev
```

Start a Run/Walk/Cycle activity (Workout Select → an activity type), let it record at least one GPS point and one split if possible, then finish it to reach the "done" screen (`components/activity/done-activity-screen.tsx`). Confirm:
1. The duration/distance/avg-pace tiles and elevation gain/loss tiles now show a subtle border and a slightly translucent background instead of a flat opaque block.
2. If splits are present, the per-km split rows match the same translucent style.
3. Enable the dynamic background for the `workout` section (Settings → Background, if applicable) and confirm the tiles remain legible against the sky/weather background, matching the "Training Load" card elsewhere.

- [ ] **Step 5: Commit**

```bash
git add components/activity/done-activity-screen.tsx
git commit -m "Match activity done-screen tiles to the translucent card convention"
```

---

### Task 6: Add a loading skeleton to `WeatherChip`

**Problem:** `components/weather-chip.tsx` returns `null` whenever `snapshot` is falsy — including while the very first fetch is in flight (`useWeather()`'s `loading` is `true` but there's no cached snapshot yet). On a cold load (no `ta_weather_cache` in `localStorage` yet, e.g. first run after install or cache cleared), the chip just doesn't render for the duration of the fetch, then pops in abruptly once data arrives. A small pulsing placeholder communicates that something is loading and avoids the layout "pop-in".

**Files:**
- Modify: `components/weather-chip.tsx`

- [ ] **Step 1: Destructure `loading` and render a skeleton while it's true**

Current (full file):

```tsx
'use client'

import { Sun, Moon, Cloud, CloudRain, CloudFog, CloudSnow, CloudLightning, type LucideIcon } from 'lucide-react'
import { useWeather } from '@/lib/weather/use-weather'
import type { WeatherCondition } from '@/lib/weather/types'

const ICONS: Record<WeatherCondition, { day: LucideIcon; night: LucideIcon }> = {
  clear: { day: Sun, night: Moon },
  cloudy: { day: Cloud, night: Cloud },
  rain: { day: CloudRain, night: CloudRain },
  fog: { day: CloudFog, night: CloudFog },
  snow: { day: CloudSnow, night: CloudSnow },
  thunderstorm: { day: CloudLightning, night: CloudLightning },
}

export function WeatherChip() {
  const { snapshot } = useWeather()
  if (!snapshot) return null

  const now = Date.now()
  const isDay = now >= new Date(snapshot.sunrise).getTime() && now < new Date(snapshot.sunset).getTime()
  const Icon = ICONS[snapshot.condition][isDay ? 'day' : 'night']

  return (
    <div className="flex items-center gap-1 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-semibold">
      <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-brand)' }} />
      <span>{Math.round(snapshot.temperatureC)}°</span>
    </div>
  )
}
```

Change the `WeatherChip` function to:

```tsx
export function WeatherChip() {
  const { snapshot, loading } = useWeather()
  if (!snapshot) {
    if (!loading) return null
    return <div className="h-[26px] w-14 rounded-full bg-muted/60 animate-pulse" />
  }

  const now = Date.now()
  const isDay = now >= new Date(snapshot.sunrise).getTime() && now < new Date(snapshot.sunset).getTime()
  const Icon = ICONS[snapshot.condition][isDay ? 'day' : 'night']

  return (
    <div className="flex items-center gap-1 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-semibold">
      <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-brand)' }} />
      <span>{Math.round(snapshot.temperatureC)}°</span>
    </div>
  )
}
```

`h-[26px] w-14` approximates the rendered size of the real chip (`px-2.5 py-1` + `text-xs` line height + `h-3.5` icon ≈ 26px tall; icon + 1-3 digit temperature + `°` ≈ 56px / `w-14` wide), so the skeleton doesn't cause a layout shift when the real chip replaces it.

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors.

- [ ] **Step 3: Verify locally**

```bash
pnpm dev
```

In the browser, open devtools → Application → Local Storage, delete the `ta_weather_cache` key (or use a private/incognito window so no cache exists), then load any page that renders `<WeatherChip />`. Confirm:
1. A small pulsing pill briefly appears where the weather chip will be.
2. Once the Open-Meteo fetch resolves, the pill is replaced by the real icon + temperature with no visible layout jump.
3. Reload the page again (cache now populated) — the chip should render immediately from cache with no skeleton flash (since `snapshot` is non-null on first render).

- [ ] **Step 4: Commit**

```bash
git add components/weather-chip.tsx
git commit -m "Show loading skeleton in WeatherChip during initial fetch"
```

---

## Self-Review Notes

- **Spec coverage:** All 6 design/accessibility/cleanup findings from the 2026-06-12 review assigned to this plan are covered — `accentCardStyle` light-mode contrast (Task 1), dead `app/history/history-content.tsx` (Task 2), orphaned `saved-meals-section.tsx` (Task 3), B11 touch-target/aria-label gap on Health info buttons (Task 4), inconsistent translucent card styling on the activity done screen (Task 5), and missing weather-chip loading state (Task 6). The "missing `prefers-reduced-motion`" item was investigated and found already resolved (`motion-reduce:animate-none` / `motion-reduce:hidden` already present in `components/dynamic-background/particles.tsx`) — documented above, no task needed.
- **Independence:** Each task touches a disjoint set of files and can be implemented, tested, and committed without the others. Tasks 2 and 3 are pure deletions with no code dependencies on the other tasks.
- **Type consistency:** Task 6's destructured `loading` matches the `{ snapshot, loading }` return shape of `useWeather()` in `lib/weather/use-weather.ts` (already returns `{ snapshot, loading }` today, unchanged by the Performance plan's Task 1 signature addition of an `enabled` *parameter*).
- **No placeholders:** every step shows exact before/after code or exact commands with expected output.
