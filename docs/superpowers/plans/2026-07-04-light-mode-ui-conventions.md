# Light-mode + UI conventions — hero skies, chart colours, macro palette, emojis

> Source: post-update review 2026-07-04 (UI/light-mode pass). PR #183 made the
> DetailHero *gradients* theme-aware but the SVG *decorations* still paint their own
> dark backgrounds, and several new surfaces shipped white/black-alpha literals.
> Anchors verified against `main`; **re-grep before editing**. Ships as **one PR**
> (patch, merge-gate-exempt) — though the emoji sweep (Task 6) can split off if it
> grows. **Verify in both themes** via Playwright `colorScheme` contexts; Samsung
> WebView rendering is the only device-gated part.

## Task 1 — DetailHero decorations must not paint full-bleed dark skies (HIGH)

**Root cause:** the decoration SVGs draw their own opaque dark sky, which the
0.4-opacity dim wrapper (`detail-hero.tsx:246`) can't rescue — a 40% overlay of a
near-black rect over a pastel gradient renders muddy grey, defeating
`HERO_GRADIENTS.*.light` entirely. Sites:
- `detail-hero.tsx:78` — SleepDecoration moon "cutout" is a `#060620`-filled offset
  circle; in light mode it's an opaque navy disc on the pale sky, not a crescent.
- `detail-hero.tsx:92-114` — ReadinessDecoration `sunriseSky` full-bleed `<rect>`
  (`#020a18→#f5a040`) over the whole 400×260 hero.
- `detail-hero.tsx:150-174` — ActivityDecoration `duskSky`/`duskGlow` full-bleed
  rects + `mtnNear` `#0a0820`.
(SleepDecoration stars and HeartRateDecoration polyline are shape-only and dim
correctly — leave them.)

**Fix:** decorations draw **shapes only**; the sky/base gradient is owned by
`HERO_GRADIENTS`/`PAGE_GRADIENTS` (which already carry a `light` variant). Remove the
full-bleed sky rects from Readiness/Activity decorations and let the hero gradient
show through. For the moon, replace the bg-colour "cutout" disc with a real
`<mask>`/`clipPath` crescent so it works against any sky. Give the mountains a
theme-aware fill (token or a `{dark, light}` pair like the gradients).

**Verify:** Playwright `colorScheme:'light'` across all four detail heroes
(sleep/readiness/activity/heart-rate) — no dark/muddy sky, moon reads as a crescent;
`colorScheme:'dark'` pixel-unchanged from before.

## Task 2 — Theme-resolve the HR chart colours (HIGH)

**Root cause:** `components/health/hr-day-chart.tsx:140` default line colour is
`rgba(255,255,255,0.75)` and the caller passes none (`oura-section.tsx:146`);
`home-card-widget.tsx:310` maps the "transparent" card colour to the same white. In
light theme the HR line is ~invisible on the near-white card. Gridlines/ticks are
also white-alpha (`hr-day-chart.tsx:170,176`; and `trend-sparkline.tsx:115-127`).

**Fix:** resolve theme tokens for the line, grid, and tick colours via the existing
`resolveColor` helper (`trend-sparkline.tsx`) or a scheme-conditional pair — never a
white/black-alpha literal default. Give `hr-day-chart` a token-based default line
colour so every call site that omits `lineColor` is safe. Apply the same to
`trend-sparkline`'s grid/tick literals.

**Verify:** Playwright light + dark on Home (HR widget) and Health (HR · Today card)
— the line and gridlines are visible in both.

## Task 3 — One `MACRO_COLORS` in `lib/`

**Root cause:** the protein/carbs/fat palette is defined 4× with **two different
schemes** — nutrition trio green/blue/orange (`macro-ring.tsx:55-57`,
`day-summary-card.tsx:11`, `meal-card.tsx:~335`) vs Home neon
`#00ff87/#00d4ff/#bf5fff` (`home-card-widget.tsx:154-157`). Protein is green on
Nutrition and neon-green on Home; carbs blue vs cyan; fat orange vs purple.
**Fix:** define `MACRO_COLORS = { protein, carbs, fat }` once in `lib/` (theme
tokens where possible), import at all four sites. Hypnogram's exported `STAGE_COLOR`
is the reference pattern.

**Verify:** the same macro is the same colour on Home, the macro ring, meal cards,
and the day-summary card.

## Task 4 — End-of-Day sheet light-mode fixes

- `end-of-day-review.tsx:216` — save footer `bg-black/30` renders a dark band across
  the light `PAGE_GRADIENTS.sleep.light` sheet. Use a theme-aware scrim
  (token / `{dark,light}`).
- `scale-selector.tsx:17` — filled-but-unselected segments use `#ffffffcc` digits on
  pale tints → white-on-pale, unreadable in light theme. Use `var(--foreground)` (or
  a token that inverts with theme).

**Verify:** Playwright light — the End-of-Day footer and the 1–5 wellness scales are
legible.

## Task 5 — Hypnogram time-axis alignment + pair colour-coded state with labels

- **Axis (M28):** `hypnogram.tsx:54-61` positions the ribbon by the Oura phase-string
  window but labels the hours by the merged row's extended `sleepStart→sleepEnd`
  (`app/api/sleep-sessions/route.ts` `mergeByDate` takes Samsung's earlier in-bed /
  min-start-max-end across split nights while keeping only the first row's phase
  string). Stages can render ~1.5h off from the labels. **Fix:** derive the hour
  labels from the same window the ribbon uses (the phase-string interval), or clip
  the ribbon to the labelled window — one source for both.
- **Colour-only state:** the HRV-vs-baseline card (`health-sections.tsx:734-741`)
  conveys amber-vs-red by number colour alone; the heart-rate page band
  (`heart-rate/page.tsx:35-37`) and ScoreDisplay/chip-row colour the band without
  rendering the label `scoreBand()` already returns. **Fix:** render the band's text
  label (or an icon) alongside the colour everywhere — `scoreBand()` returns
  `{ label, color }`; use both. The HRV card should use `scoreBand()` rather than
  hand-rolled thresholds.

**Verify:** the hypnogram stages line up with their hour labels on a merged night;
every colour-banded value shows a text/icon label.

## Task 6 — Emoji → Lucide sweep + token regressions (can split off)

Replace emoji glyphs with Lucide icons at the live chrome sites (precise inventory
captured in the review — the high-traffic ones):
- Nutrition: `nutrition-content.tsx:416` 🌙, `end-of-day/day-summary-card.tsx:62` 🔋,
  `today-insight-card.tsx:17` 🔋, `meal-type-manager.tsx:58,124` 🍽️ (+ server
  default `api/nutrition/meal-types/route.ts:54`).
- Health: `health-content.tsx:1000-1014` ⚖️👣🔥, `health-sections.tsx:781-784`
  ✅⚠️🔴💤, `ai-periodization-status-card.tsx:118` 💪.
- Workout-select/session-select: `workout-select-content.tsx:305` 📅,
  `session-select-content.tsx:1101,1341,1348-1352` 🧠🧘⚖️👣🔥🥩📊,
  `recommendation-card.tsx:145,187` ⚠️🎉, `deload-banner.tsx:42` 🌡️⚠️💤.
- Workout flow: `done-screen.tsx:148-224`, `exercise-summary-screen.tsx:98`,
  `exercise-stats-sheet.tsx:123,174`, `active-workout-screen.tsx:405,497,686`,
  `pre-workout-screen.tsx:278`, `warmup-screen.tsx:161`, `builder-review.tsx:524,535`.
- Misc: `overview-screen.tsx:46-52`, `stats-content.tsx:321,328`,
  `color-swatch-picker.tsx:55`, `program-editor-sheet.tsx:807` (✕ → `XIcon`), the two
  `error.tsx` ⚠️.
(Mood-face and reaction emojis that are *content*, and server-side session-icon
data, are out of scope — flag, don't force.)

**Token regressions to fix while here:** `wellness-section.tsx:51-54` uses raw
`#ff6a1a` where the identical `mood-checkin-sheet.tsx:259-261` picker uses
`var(--accent-amber)` — restore the token; new F6 card hex literals
(`nutrition-activity-trends-card.tsx:29,32,35`, `workout-density-card.tsx:30`) where
the sibling used `var(--color-brand)`; `trends-section.tsx:73-76` `bg-brand
text-white` pill tabs (contrast — use a token).

**Verify:** grep for the swept emoji glyphs returns only content/data sites; the
touched chrome renders Lucide icons in both themes.

## Task 7 — Light-mode navigation flash (MED, may defer if risky)

`useHeroColorScheme` (`detail-hero.tsx:15-20`) returns `"dark"` until after the mount
effect, so light-theme users get a full-screen dark-gradient flash on every
navigation to the four health detail pages (roots paint `PAGE_GRADIENTS[...].dark`
on the first client frame). **Fix:** drive the page-root background from a
CSS-variable / `data-theme`-stamped value (which the ThemeProvider sets before
paint) instead of a mounted-gated `resolvedTheme` read, so there's no dark first
frame. If this proves to need a broader theming refactor, split it to its own small
follow-up rather than bloating this PR.

**Verify:** Playwright light, navigate into each detail page — no dark flash on
entry.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; Playwright `colorScheme` light+dark
  passes across the touched heroes, HR charts, End-of-Day sheet, and hypnogram.
- **Not exercisable in sandbox:** Samsung WebView SVG/canvas rendering — declare it;
  run the device smoke checklist's rendering section.
- Patch/minor bump (user-visible light-mode fixes) + changelog; merge-gate-exempt.
  Remove this backlog entry in the same PR (or annotate remaining if Task 6/7 split).
