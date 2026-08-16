---
name: ui-ux-pro-max
description: Design and audit UI for THIS app's canonical target — the APK on a Samsung Galaxy S25 Ultra. Enforces the repo's own design system (theme tokens, floored safe-area utilities, existing components/ui primitives, Samsung WebView constraints, instant-paint cache seeding) with a priority-ordered rule set. Use when building a new screen, sheet, card or control, when changing layout or visual styling, when reviewing UI for design or accessibility problems, or when the user says "review the UI", "design this screen", or "make this look better".
version: 1.0.0
---

# UI/UX Pro Max — S25 APK edition

Design intelligence bound to this repo. The upstream skill of this name ships a generic database of
67 styles and 161 palettes; that is the wrong tool here. **This app already has a tuned design
system, and CLAUDE.md bans hex literals in favour of theme tokens** — a generic palette recommender
would produce code that fails review. This version keeps upstream's priority-rule structure and
replaces the generic database with the repo's actual one.

**Canonical target: the APK in a WebView on a Samsung Galaxy S25 Ultra (6.9", ~412dp wide).** Per
CLAUDE.md's Canonical Runtime section, web is a dev/QA surface only. When behaviour must diverge,
the device wins. Never design an affordance that only makes sense on desktop web.

## Related skills — pick the right one

- **This skill** — implementation-level design work in this codebase: which token, which utility,
  which primitive, and what will break on the S25.
- `mobile-app-design-standards` — platform-level iOS/Android convention reference.
- `mobile-app-ui-design` — greenfield visual mockups and flows.

When designing a new screen from scratch, start with `mobile-app-ui-design`, then run the result
through this skill before writing code.

---

## P0 — CI-enforced. Violating these fails the Custom Rules check.

These are grep rules in `.github/workflows/ci.yml`. They fail the build, not the review.

1. **Never write `env(safe-area-inset-*)` in a `.tsx` file.** Use the utilities in
   `app/globals.css`. Only `components/shell/bottom-nav.tsx` is exempt.
2. **Never combine `pt-safe`/`pt-safe-or-4` with another `pt-*` class** in the same `className`, in
   either order. The later Tailwind class wins and the inset is silently lost.
3. **Never combine `pb-safe*` with another `pb-`/`py-`/`p-` class.** Same failure.
4. **Never hardcode a session name** (`"Push"`, `"Pull"`, `"Legs"`). Session identity is the DB id.

## P0 — device-breaking. Not caught by CI; caught by the user.

5. **Bottom-anchored controls need a *floored* utility.** On Android gesture-nav,
   `env(safe-area-inset-bottom)` reports ~0, so bare `pb-safe` puts the primary button under the
   gesture bar. This has regressed 11+ times.

   | Context | Utility | Value |
   |---|---|---|
   | Action row inside a nav screen | `pb-safe-action` | `max(env, 0.75rem)` |
   | **Full-screen / navless takeover** (workout phases, baseline tests) | **`pb-safe-action-lg`** | `max(env + 2rem, 4rem)` |
   | Fixed element clearing the bottom nav | `bottom-nav-safe` / `bottom-fab-safe` | `3.5rem + var(--safe-bottom)` (+`0.75rem` for FAB) |
   | Trailing scroll padding only, never under a tappable control | `pb-safe` | bare `env` |

   Before using any of these, confirm the class exists in `app/globals.css`. `.pt-safe-or-4` was
   referenced but undefined for a full release and failed silently.

6. **Bottom sheets own their own inset.** `SheetContent side="bottom"` and `SheetFooter` bake it in.
   Never add `pb-safe*` inside one, and never `pt-safe` on one. `p-0` does **not** strip the baked
   padding — tailwind-merge does not know these custom classes. `side="left"/"right"` sheets bake
   nothing and need explicit insets.

7. **Never nest interactive elements.** A tappable card containing other controls is
   `<div role="button" tabIndex={0}>`, never a `<button>` wrapping a `<button>` — Samsung's WebView
   silently strips the inner one and breaks dnd-kit activation. The inverse also holds: never put a
   `span role="button"` inside a real `<button>`; it escapes the global 44px tap-target floor.
   Dismissible banners use the container-`div` + separate dismiss-`<button>` pattern (see
   `components/ui/dismissible-banner.tsx`).

## P1 — colour and theme

8. **Semantic colour comes from tokens, never hex.** The palette is OKLCH in `app/globals.css`:
   `--accent-green`, `--accent-cyan`, `--accent-amber`, `--accent-purple`, plus the shadcn
   `--accent` / `--accent-foreground` pair. Each has a separate dark-mode value. A hex literal
   bypasses the tuned tokens and breaks one of the two themes. Literal `text-white` breaks light mode.

9. **Never pass a `var(--x)` string to a canvas paint API.** Canvas `fillStyle` cannot resolve CSS
   custom properties and renders black silently. Use the shared `resolveColor` helper — import it,
   never re-implement it. Any `lineColor ?? 'rgba(255,255,255,…)'` default is a light-mode bug at
   every call site that omits the prop.

10. **Design in both themes.** `useTheme()` mounted-gates default to dark, so any page-root surface
    coloured from a gated `resolvedTheme` flashes dark for light-theme users on every navigation.
    Prefer CSS-variable / `data-theme`-driven values for page roots.

11. **Screen backgrounds go through `bg-page` + `components/dynamic-background/`.** A `bg-background`
    root silently hides the wallpaper layer. Background art sits behind a readability scrim
    (`ScrimLayer` / DetailHero pattern) with body text at ≥4.5:1.

12. **Hero and decoration SVGs draw shapes only.** Sky and base gradients live in `HERO_GRADIENTS`
    (`components/health/detail-hero.tsx`). A full-bleed dark rect or a bg-colour "cutout" inside a
    decoration breaks light mode even under a dim wrapper — use `mask`/`clipPath`.

13. **Never convey state by colour alone.** `scoreBand()` colour always ships with `scoreBand()`'s
    label or icon. Colouring a value by band without rendering the band's text is the violation.

14. **Lucide icons, never emoji.**

## P1 — touch and gesture

15. Touch targets ≥ 48dp, ≥ 8dp apart. Primary actions bottom-anchored — the top corners of a 6.9"
    screen are outside one-handed reach.
16. Touch feedback within 100ms. Use the shared haptics helpers.
17. **Custom gesture handlers direction-lock before capturing**, during the gesture, not at
    touchend. Pull-to-sync swallowed normal scrolling twice. Document-level recognizers must exclude
    every scrollable ancestor (any `.overflow-x-auto`), not just tagged carousels. Never set
    `overscroll-behavior: none` to paper over a gesture bug.
18. **Reach for `@use-gesture/react` before hand-rolling.** It is installed with zero imports while
    two hand-rolled swipe implementations exist. Same for `motion` v12, `@dnd-kit/react`,
    `react-chartjs-2`.

## P1 — perceived performance

19. **A skeleton flash on a repeat visit is a bug.** Every screen and widget seeds synchronously from
    cache (`readCacheSync`) and revalidates in the background. Seed in a `useEffect`, never in a
    `useState` lazy initializer — that caused hydration mismatches.
20. **A `loading:` skeleton on a cache-seeded card is a contradiction** — the skeleton wins and
    defeats the instant paint. Reserve `dynamic(…, { ssr: false })` for genuinely heavy deps
    (chart.js, markdown/KaTeX, the AI chat overlay); static-import lightweight data cards.
21. **UI feedback fires synchronously after the local write, never after `await fetch`.** The
    log-exercise path is the reference. Submit buttons need an in-flight guard — five rapid taps once
    fired four `complete-workout` POSTs.
22. **Timers tick in the leaf that renders them.** `useElapsedSec` / `useCountUp` / rAF hooks live in
    the leaf, never the orchestrator — a 1 Hz tick at the top of `active-workout-screen.tsx` would
    re-render the whole screen every second.
23. **`React.memo` needs stable props at the call site.** An inline arrow or object literal defeats
    it silently. Both long-standing memos in this codebase were broken exactly that way.

## P2 — reuse before building

24. **Check `components/ui/` before writing any primitive.** Currently available:

    `avatar` · `bottom-action-bar` · `button` · `collapsible` · `collapsible-section` ·
    `color-swatch-picker` · `confirm-dialog` · `dialog` · `dismissible-banner` · `empty-state` ·
    `input` · `label` · `meteors` · `popover` · `scroll-area` · `segmented-tabs` · `select` ·
    `sheet` · `skeleton` · `sonner` (toast) · `sparkline` · `sparkline-chart` · `swipe-carousel` ·
    `switch` · `tab-panels` · `textarea` · `typewriter-text` · `weight-dial` · `weight-dial-modal`

    Any pattern appearing at ≥2 sites gets extracted before a third copy. The pill-tab markup was
    copy-pasted ~17× with drifting font sizes before `segmented-tabs` existed. Six inline polyline
    sparklines still bypass `components/ui/sparkline.tsx` — replace them on touch.

25. **Interactive elements are real controls** — shadcn `<Button>` and Radix primitives with proper
    ARIA state. ~18 hand-rolled chevron toggles ship no `aria-expanded`. (Rule 7's
    `<div role="button">` exception still applies where a card contains other controls.)

26. **Component files stay under ~800 lines.** The known hotspots absorb every new feature by
    default: `session-select-content.tsx`, `workout-screen.tsx`, `config-screen.tsx`,
    `health-content.tsx` / `health-sections.tsx`, `program-editor-sheet.tsx`. Extract into
    `components/` children instead of appending.

27. **Semantic palettes are defined once in `lib/` and imported.** Hypnogram's `STAGE_COLOR` export
    is the reference. Do not let the macro (P/C/F) or sleep-stage palette grow a second copy.

## P2 — sibling sweep

28. When you change a display format, a scale or dial config, a write-path pairing, or an
    interaction pattern on one surface, **grep for every other surface in the same domain and update
    them in the same PR.** A fix applied to one surface and not its siblings is half done.

29. **No global element-selector styling.** Tap-target floors and focus rings belong in
    `components/ui/button.tsx` variants, never a bare `button`/`a` selector in `globals.css`.

---

## Verification gate

**The web sandbox renders all safe-area insets as 0, and Chrome renders the WebView compositor bugs
correctly.** Both classes of bug are invisible until on-device.

Green `pnpm dev` is necessary and never sufficient. For any change touching safe-area, gestures,
native plugins, notifications, or an offline-first domain, the merge gate is the on-device smoke run
(`docs/device-smoke-checklist.md`) — **or** an explicit Known-Issues row in `projectOverview.md`
marking it not verified on device.

When presenting UI work, state which surfaces were not exercised: safe-area insets, Samsung WebView
rendering, native SQLite, real device gestures.

## Audit mode

When asked to review rather than build, walk [references/audit.md](references/audit.md) and report
findings ordered P0 → P2, each with a file path and line. Do not report a finding without naming the
rule number above that it violates.
