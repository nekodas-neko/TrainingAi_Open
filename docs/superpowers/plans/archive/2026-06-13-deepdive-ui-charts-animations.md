# Deep-Dive Audit #2 — UI: Charts, Animations, Consistency (2026-06-13)

Scope: Chart.js dashboards, motion/animation vocabulary, Samsung compositor, accessibility/touch targets,
consistency. Skills: `.agents/skills/chartjs-dashboards/SKILL.md`, `.agents/skills/motion-animations/SKILL.md`,
`.agents/skills/svg-icon-design/SKILL.md`. Emoji-iconography already verified clean. The Radix `<Sheet>`
migration for the 4 nutrition sheets and the shared `<Button>` restyle remain **known-deferred** (session-104 plan).

---

## Charts

### Task C1 — chart.js eager-bundled into home/health/stats via the chat overlay · **High**
- **Where:** `components/ai-chat-overlay.tsx:8` statically imports `ChartMessage`, which statically imports chart.js (`components/chart-message.tsx:1-15`). `AiChatOverlay` is statically imported into the home screen (`session-select-content.tsx:18`), `overview-screen.tsx:12`, and `stats-content.tsx:9` → chart.js ships in the initial chunk for screens that may never open chat.
- **Fix:** Lazy-load `ChartMessage` via `next/dynamic(() => import(...), { ssr: false })` inside `ai-chat-overlay.tsx` / `chat-overlay.tsx`, matching `ExerciseStatsSheet`'s pattern (`pre-workout-screen.tsx:13`).
- **Verify:** `pnpm build` — chart.js absent from the home/stats initial chunk.

### Task C2 — `WeeklySummaryCard` forces chart.js into health/stats bundles · **High**
- **Where:** `components/weekly-ai-summary.tsx:7` statically imports `ChartMessage`; `WeeklySummaryCard` is statically imported into `health-content.tsx:21` and `stats-content.tsx:8`.
- **Fix:** Dynamic-import `ChartMessage` inside `weekly-ai-summary.tsx`.

### Task C5 — `WeeklyNutritionChart` not lazy-loaded · **Med**
- **Where:** `app/nutrition/nutrition-content.tsx:11` statically imports `WeeklyNutritionChart` (→ chart.js Bar, eager `ChartJS.register` at module load).
- **Fix:** `next/dynamic({ ssr: false })`.

> C1/C2/C5 are the same finding as **Performance plan PER-2** — do them as one task set.

### Task C3 — `ChartMessage` hardcodes theme colors · **Med**
- **Where:** `components/chart-message.tsx:95` wraps charts in `bg-white dark:bg-zinc-900`; no themed gridline/axis/tooltip/legend colors → Chart.js's default dark text is unreadable on the app's translucent dark surfaces. `DEFAULT_COLORS` (`:46-53`) is a separate palette from `SET_COLORS`.
- **Fix:** Set `scales.*.ticks.color`, `grid.color`, `plugins.legend.labels.color`/tooltip colors from `var(--muted-foreground)`/`var(--border)` resolved at render (as `SparklineChart` does); drop the `bg-white` wrapper in favour of the app card surface.

### Task C4 — `WeeklyNutritionChart` hardcodes axis/grid colors · **Med**
- **Where:** `components/nutrition/weekly-nutrition-chart.tsx:82-86` — `ticks: { color: '#888' }`, `grid: { color: 'rgba(255,255,255,0.06)' }` (invisible in light mode).
- **Fix:** `var(--muted-foreground)` for ticks, `var(--border)` for gridlines.

### Task C6 — `WeeklyNutritionChart` has no fetch-error state · **Low**
- **Where:** `components/nutrition/weekly-nutrition-chart.tsx:111` — only `data.length === 0` → "No data yet"; an upstream fetch failure shows the same empty state.
- **Fix:** Pass an `error` prop; render a distinct "Couldn't load nutrition" state with retry.

> Already compliant (no action): `SparklineChart`, `ExerciseStatsSheet` (lazy + abort + error + insufficient-data guards), the home SVG mini-sparklines (`<2`-point guards, CSS-var brand color), Training-Load/Sleep-correlation HTML blocks.

---

## Animations

### Task A1 — `Meteors` background ignores `prefers-reduced-motion` · **Med**
- **Where:** `components/ui/meteors.tsx:49` applies `.meteor-particle` (`app/globals.css:299-306`, `meteor … infinite`) with no reduced-motion guard; renders on the home screen (`session-select-content.tsx:816`) and auth pages. The dynamic-background particles got `motion-reduce:animate-none`; the meteor layer was missed.
- **Fix:** Add `motion-reduce:animate-none` to the particle `className`, or gate `.meteor-particle` under the global reduced-motion block (Task A3).

### Task A2 — `ta-marquee` muscle-recovery strip ignores `prefers-reduced-motion` · **Med**
- **Where:** `components/workout/muscle-recovery-card.tsx:30-35` sets `animation: ta-marquee … infinite` via **inline style** (so a Tailwind `motion-reduce:` class can't reach it); used on the workout-select screen.
- **Fix:** Give the element a class and zero its animation under the global reduced-motion block (Task A3), or read the media query in JS and skip the inline `animation`.

### Task A3 — Add a global `prefers-reduced-motion` block · **Med (enabler)**
- **Where:** `app/globals.css` (no `@media (prefers-reduced-motion: reduce)` block exists; file ends ~line 418).
- **Fix:** Add a global rule that zeroes decorative keyframes (`meteor`, `ta-marquee`, weather particle layers) — cleanest fix for A1+A2 and any future keyframe. Keep functional animations (timer ring, border-run) intact.

> Already compliant: no hand-rolled `onPointerDown/Move/Up` drag handlers (drag uses @dnd-kit); no new celebratory animation outside `xp-pop`/`pr-pulse`/`shimmer-sweep`; `accentCardStyle` carries `willChange:'transform'` so new home-card inline SVGs inherit Fix B; no home-widget animation animates width/height/top/left.

---

## Consistency

### Task U-new-1 — `WeeklyNutritionChart` metric toggles are sub-44dp tap targets · **Med**
- **Where:** `components/nutrition/weekly-nutrition-chart.tsx:96-106` — Calories/Protein/Carbs/Fat toggles are `px-2.5 py-1 … text-[10px]` (well under 44dp). These are interactive controls, not captions.
- **Fix:** `min-h-[40px]`, `py-2`, `text-xs`.

### Task U26 / U27 — confirmed still-pending (roadmap) · **Low**
- **U26 (safe-area padding standardization):** no new regressions beyond the deferred Sheet migration; newer screens (`exercise-stats-sheet.tsx:127`, done screen) correctly use `pb-[max(…,env(safe-area-inset-bottom))]`.
- **U27 (`<div>`/`<p>` section headers → `<h2>`/`<h3>`):** remaining concrete examples — `components/health/strength-progress-card.tsx:41,46`, `components/nutrition/weekly-nutrition-chart.tsx:93`. Convert card/section titles to `<h3>`.

> Note: `text-[8px]/[9px]/[10px]` has 272 occurrences across 64 files, but the overwhelming majority are
> caption/stat **labels**, not touch targets (the workout-flow tiny-text cleanup was done in session 44/46).
> Only U-new-1 is a genuine new sub-44dp interactive control.

---

## Verification & commit
- `pnpm build` (C1/C2/C5 bundle), `pnpm lint && tsc`. Manually verify chart readability in **both** light and dark mode on a translucent surface (C3/C4). Toggle OS "reduce motion" and confirm A1/A2 stop (A3).
- User-visible (chart theming, reduced-motion, faster initial load) → patch/minor bump + changelog lines.
