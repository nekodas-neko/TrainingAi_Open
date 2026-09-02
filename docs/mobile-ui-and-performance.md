# Mobile UI & Performance — S25 Ultra Runtime

Moved out of `CLAUDE.md` on 2026-09-02 to keep that file to what every session needs —
this is consulted when building or reviewing UI, not on every session start. The
`ui-ux-pro-max` skill enforces this doc directly. Nothing changed in the move.

## Safe-Area Insets — every new screen, every time

10+ regressions: headers under the status bar, buttons under the gesture bar (sessions 16, 21, 50, 53, 64, 100, 101, 136, 163, 167, 172, and the fitness-baseline screens 2026-07-19).

- **There is NO native WindowInsets bridge** — on-device clearance depends entirely on the floored CSS utilities. On Android gesture-nav / Capacitor edge-to-edge, `env(safe-area-inset-bottom)` is tiny (~16–24px) or reports 0, so **bare `pb-safe`/`env(safe-area-inset-bottom)` gives near-zero clearance and the button sits on the gesture bar.** `env()` alone is untrustworthy — never anchor a control with it.
- **Bottom-anchored action rows, footers, and primary buttons use a FLOORED utility, never bare `pb-safe`:** `pb-safe-action` (floor 0.75rem) for a row inside a nav-screen, or **`pb-safe-action-lg` (`env + 2rem`, min 4rem) for full-screen / navless flows** (workout phases, fitness-baseline tests, and any takeover screen). Reserve bare `pb-safe` for non-critical *trailing* scroll padding only — it must never be the sole clearance under a tappable control. This exact mistake (floorless `pb-safe` on the fitness-baseline Discard/Save row) is the 2026-07-19 regression.
- Every full-screen header uses the shared `pt-safe`/`pt-safe-or-4` utilities. Never inline `env()` per-screen.
- Verify the utility class actually **exists** in `globals.css` AND is a *floored* variant for anchored controls — `.pt-safe-or-4` was referenced but undefined for a whole release and failed silently (session 167); a class that exists but is the floorless `pb-safe` variant fails the same way on-device (2026-07-19).
- Never combine `pt-safe` with another `pt-*` class — the later Tailwind class wins and the inset is lost.
- **`SheetContent side="bottom"`/`SheetFooter` own the bottom inset** — never add `pb-safe*` inside a bottom sheet; `p-0` does NOT strip the baked padding (tailwind-merge doesn't know the custom classes). Never `pt-safe` on a bottom sheet. `side="left"/"right"` sheets bake nothing — drawers need explicit insets. Floating `fixed bottom-*` elements on nav screens must clear `3.5rem + var(--safe-bottom)`.
- The web sandbox renders insets as 0, so these bugs are invisible until on-device. Treat any new fixed header/footer as unverified until checked on the S25.

---


## Zustand Persisted Store — transient state must not survive rehydration

Four incidents: confetti replaying on every app open, a render crash from a rehydrated stale summary payload, a phantom "Leave workout?" dialog, cross-session "done" leaks.

- Any new field or mode added to a persisted store must — at the time it's added — either be excluded from persistence or explicitly reset in `onRehydrateStorage`. Screen modes, in-flight flags, and per-screen payloads never survive a reload.
- Daily state is keyed by `(local date, session id)`, never a flat global set.
- Reset-on-mount effects depend only on identity keys (session id), never the store object — the store returns a new ref on every mutation and the effect re-fires forever (session 86).

---


## Android WebView Gotchas (Samsung S25 Ultra)

- Tappable cards containing other controls or drag handles: `<div role="button" tabIndex={0}>`, never nested `<button>` — the browser silently strips the inner button, and native button long-press handling breaks dnd-kit activation. **The inverse holds too: never put interactive content (including `span role="button"`) inside a real `<button>`** — invalid HTML with undefined WebView behaviour, and the span escapes the global 44px tap-target floor (two dismissible banners shipped this way, found 2026-07-06). Dismissible banners follow the container-div + separate-dismiss-`<button>` pattern (the session-select APK banner is the reference).
- SVGs inside card grids can wipe sibling cards' gradient backgrounds on Samsung's WebView compositor. Promote siblings with `willChange: 'transform'`; prefer CSS `conic-gradient` over stroke-dash SVG donuts. Verify on the APK — Chrome renders fine.
- Persist drag-reorder results synchronously inside the drag handler (effects and functional-update side writes are lost on unmount). With `@dnd-kit/react`, apply reorders in `onDragOver`, not `onDragEnd`.
- Capacitor plugin imports are guarded dynamic imports in try/catch (no `webpackIgnore`); chart.js and other browser-only libs load via `dynamic(..., { ssr: false })`.
- The service worker's cache name is build-stamped from the deploy commit SHA (`app/sw.js/route.ts` reads `public/sw-template.js` and injects `RAILWAY_GIT_COMMIT_SHA`) — no manual bump needed, unlike the old `ta-vN` constant that was forgotten twice (sessions 55/74) and shipped invisible changes.

---


## Mobile UI & Performance (S25 Ultra — the only real target)

### Instant paint — a skeleton flash on a repeat visit is a bug

Four separate sessions (147, 155, 165, 167) retrofitted cache-seeding onto screens that shipped with load skeletons. Build it in from the start:

- Every screen/widget that fetches data seeds synchronously from cache (`readCacheSync` / the shared cache keys) and revalidates in the background. First paint shows last-known data, not a spinner.
- Seed in a `useEffect`, **never** in a `useState` lazy initializer — cache reads in initializers caused React hydration mismatches (session 165).
- Timers tick in a leaf component reading refs — never `setInterval` state in an orchestrator. A 1 Hz tick living in the orchestrator would re-render the entire ~1,000-line workout screen (warmup grid, sparkline, heatmap) every second; `active-workout-screen.tsx`'s rest ring and lap/rest counters read from `useElapsedSec`/refs at the leaf instead.
- Heavy widgets (chart.js, markdown/KaTeX, AI chat overlay) load via `next/dynamic({ ssr: false })` — they are both SSR-unsafe and bundle-heavy; static imports of these into top-level screens drag them into every page load. `dynamic(..., { ssr: false })` is only for genuinely heavy deps like these — lightweight data cards are static-imported. A `loading:` skeleton on a cache-seeded card is a contradiction (the skeleton wins and defeats the cache-seed instant-paint rule above).
- Component files stay under ~800 lines. The known hotspots — `session-select-content.tsx`, `workout-screen.tsx`, `config-screen.tsx`, `health-content.tsx`, `program-editor-sheet.tsx` — absorb every new feature by default; extract new features into `components/` children instead of appending. (`health-sections.tsx` came off this list on 2026-08-09 and `more/profile-tab.tsx` on 2026-08-19, both for dropping under the line — the rule below is what says to strike them, and it was followed once and then not again, which is why `profile-tab` sat here at 476 lines.) The list is no longer maintained by hand: **`scripts/check-component-size.js` fails CI on any new file over 800 lines**, and its BASELINE is shrink-only, so a hotspot that drops under the line must be removed from it in the same PR. Current offenders: `find app components -name '*.tsx' -exec wc -l {} + | sort -rn | awk '$1 > 800'`.

### Saves feel instant — the UI never waits for the network

The log-exercise path is the reference pattern (local write + outbox fallback, POST fire-and-forget, mode flips synchronously). Every save path copies it:

- UI feedback — toast, mode flip, "complete" state, list update — fires synchronously after the local write, never after `await fetch`. Network pushes are fire-and-forget with an outbox fallback; even web-only fallback paths show feedback first and reconcile on error.
- Never `await` POSTs serially in a loop (a multi-ingredient food scan once meant one blocking round-trip per item before the toast) — batch into one request or `Promise.all`, and give the domain an outbox path so it works offline.
- Don't auto-fire slow external round-trips on screens the user is trying to leave (the done screen awaited a live Oura Cloud sync on mount) — put them behind a button or fire-and-forget with a delayed poll.

### Render discipline — memo only works with stable props

- Any card/widget rendered repeatedly or under a fetch-heavy parent gets `React.memo`, **and** its call site passes stable props — one inline arrow or object literal defeats the memo silently, and the component keeps its `memo(...)` wrapper and keeps reading as optimised. `useCallback`/`useMemo` at the call site; where the call site is inside a `.map()` and a hook is not allowed, pass **scalars** or move the identity into the child (`meal-macro-bars.tsx` is the reference — its eight macro numbers are scalar props for exactly this reason, Q-490). **There are 66 memoised components, not two** — the old "both long-standing memos" parenthetical here was a count from when memoisation was rare, and it read as discouragement. `scripts/check-memo-prop-stability.js` enforces this in the Custom Rules job (Q-490, 2026-08-18) with a shrink-only per-file baseline: 6 defeated call sites existed when it was written, 2 fixed by Q-490 and 4 baselined for Q-357. A 2026-08-18 audit reported "no inline arrows exist anywhere"; there were four, which is why this is a script and not a paragraph.
- Zustand: subscribe with narrow selectors. Hot-path fields (per-set weight, RPE value) are read by the leaf that renders them via its own selector — never threaded through an orchestrator's broad `useShallow` pick, which turns every dial detent into a full-screen render.
- Rows in editable lists get a stable client id at creation, never `key={index}` — deleting a middle row makes the rows below inherit stale input state.
- `readCacheSync`/`JSON.parse` calls never live in a component body that renders on a timer — hoist to a ref/effect.
- **rAF/animation hooks are timers too** — call `useCountUp`/`useElapsedSec` in the leaf that displays the number, never at the top of a screen; a count-up must animate from the previously displayed value, not reset from zero on every parent render.

### Touch & gestures

- Touch targets ≥ 48dp with ≥ 8dp between them; primary actions bottom-anchored (6.9" screen — top corners are out of one-handed reach). Touch feedback within 100ms (use the shared haptics helpers).
- Custom gesture handlers must **direction-lock before capturing**: pull-to-sync swallowed normal scrolling until a movement-threshold lock was added, twice (sessions 150, 152). Never set `overscroll-behavior: none` on a scroll container to work around a gesture bug. Document-level gesture recognizers must exclude scrollable ancestors generally (any `.overflow-x-auto`, not just tagged carousels) and direction-lock during the gesture, not at touchend.
- Reach for `@use-gesture/react` before hand-rolling touch handling. **Re-counted 2026-08-09 and the old "the installed library has zero imports" is now false** — `useDrag` is used in four places (`app/health/day/day-detail-content.tsx`, `app/nutrition/nutrition-content.tsx`, `components/ui/swipe-carousel.tsx`, `components/calendar-widget.tsx`), so the library is the established pattern here, not an untried one. **Three** hand-rolled implementations remain, and they are the ones to copy *away* from: `app/workout-select/workout-select-content.tsx`, `components/pull-to-sync.tsx`, and `components/shell/tab-swipe-navigator.tsx` (document-level `touchstart`/`move`/`end`).

### Visual consistency & theme

- **The app is DARK ONLY — one theme, one design. Owner decision, 2026-08-25.** There was never a
  theme switch (`setTheme(` has no call sites); `app/layout.tsx` ran `defaultTheme="system"
  enableSystem`, so light mode was not a choice anyone made — it was what the app became if the S25
  was ever set to light. It is now pinned with `forcedTheme="dark"`. **Consequences that bind every
  UI change:** design and verify in dark only, never "both themes"; a mockup or artboard is drawn
  dark; a light-mode rendering bug is not a bug and does not earn a backlog entry. **Do not delete
  the light palette** — the `:root` block in `globals.css`, the `resolveColor` scheme pairs,
  `HERO_GRADIENTS`, `screen-palettes.ts` and the `resolvedTheme` reads cost nothing while
  unreachable, and deleting them is the half that cannot be undone. Reversing the decision is
  deleting one prop.
- **Dark-only does NOT mean literals are fine — this is the confusion to avoid.** Theme and accent
  are two different axes. The **accent is still user-picked** (`data-brand="blue|purple|orange|pink|
  cyan|red|gold"` in `globals.css`), so a hex literal still bypasses the colour the user chose, and
  `check-hex-literals.js` still ratchets it. What dark-only retires is the *light-mode* half of the
  colour rules below, not the token rule.
- Semantic UI colours come from theme tokens (`--accent-*` / Tailwind theme colours), never hex literals or hardcoded palette classes — hex literals still bypass the tuned tokens (`.tsx` under `app/`+`components/`) — **`node scripts/check-hex-literals.js` prints the current total; do not hand-count and do not restate it here**, and literal `text-white` breaks light themes. New UI uses tokens. **The trend was recorded here as improving and it was not** — 455 on 2026-08-07, 430 on 2026-08-09, then **+41 in five days** to 471, unnoticed because this line was prose and nothing measured it. `scripts/check-hex-literals.js` now ratchets it in the Custom Rules job (Q-244, 2026-08-15): a shrink-only per-file baseline, so any file not listed must have zero and a listed file may only shrink. It does **not** sweep the existing backlog of them — that is separate and much larger. Adding a literal that is genuinely required (canvas paint cannot resolve `var(--x)`; the icon routes have no CSS) means raising that file's number in the same PR, which puts the growth in the diff.
- Lucide icons, never emojis (established convention, sessions 149/155). **Re-checked 2026-08-03: the 2026-07-02 list is out of date** — 🌙 📅 ⚖️ ✅ are gone from nutrition, workout-select and health. What is left is not chrome and should NOT be swept: mood faces (😴 😑 😐 😊 ⚡) and the meal-type 🍽️ are *content* — user-facing values with their own `emoji` field — and `✓`/`✗`/`↓` are typographic marks that the colour-only-state rule actively wants. Emoji in share text (`done-screen.tsx`) is message content too. The rule still binds new **icons**; it does not bind these.
- **Screen backgrounds go through the `bg-page` + dynamic-background system** (`components/dynamic-background/`), never opaque per-screen paint: a `bg-background` root silently hides any wallpaper layer. Background art must sit behind a readability scrim (the `ScrimLayer`/DetailHero pattern), keep body text at ≥4.5:1 contrast, and be designed and verified in **dark** (the only theme — see the dark-only rule above). DetailHero hardcoding dark used to be the cautionary example here; it is now simply correct, and the line is kept so nobody "fixes" it back.
- **Hero/decoration SVGs draw shapes only** — sky/base gradients live exclusively in the shared hero gradient constants (`HERO_GRADIENTS` in `components/health/detail-hero.tsx`); a full-bleed dark rect or bg-colour "cutout" inside a decoration used to break light mode even under a dim wrapper (use mask/clipPath instead). **Dark-only retires the light-mode failure, not the rule** — a cutout still paints over whatever wallpaper the dynamic-background system puts behind it.
- **Canvas/SVG chart colours are theme hazards** — gridlines, ticks, and default line colours must never be white/black-alpha literals; resolve tokens via `resolveColor` or scheme-conditional pairs. Any `lineColor ?? 'rgba(255,255,255,…)'` default was a light-mode bug at every call site that omits the prop; **dark-only makes that one moot**, but the `var(--x)` hazard in the next sentence is unaffected and is the one that actually ships black pixels. **Never pass a `var(--x)` string to chart.js/canvas paint APIs** — canvas `fillStyle` can't resolve CSS custom properties and silently renders black; this shipped again in `workout-load-comparison-chart` (2026-07-06) despite an in-repo comment documenting it. `resolveColor` is a shared import, never re-implemented per component.
- **`useTheme()` mounted-gates default to dark** — which under `forcedTheme="dark"` is now the right answer rather than a flash, so this class of bug is closed. Still prefer CSS-variable/`data-theme`-driven values for page roots: `data-brand` varies at runtime even though the theme no longer does.
- Don't convey state by colour alone (colour-coded 1RM deltas, readiness bands) — pair with a symbol or label; maintain 4.5:1 contrast for body text. `scoreBand()` colour always ships paired with `scoreBand()`'s label/icon — colouring a value by band without rendering the band's text is the colour-only-state violation.
- **Semantic palettes (macros P/C/F, sleep stages) are defined once in `lib/` and imported** — Hypnogram's `STAGE_COLOR` export is the reference; don't let the same palette grow a second, drifting copy.
- Before writing a tab strip, confirm dialog, empty state, collapsible, or sparkline: grep `components/ui/` for an existing primitive. Any pattern at ≥2 sites gets extracted before a third copy — the pill-tab markup was copy-pasted ~17× with drifting font sizes. Score-band thresholds are consolidated in `packages/shared/src/health/score-band.ts`, imported everywhere as `@trainingai/shared/health/score-band` (17 call sites) — there is no `lib/health/score-band.ts`. **The sparkline primitive can draw these now** (Q-154, 2026-08-30): `components/ui/sparkline.tsx` gained `pad`, `valuePadding`, `strokeWidth`, `gridLines`, `emphasizeLast` and `valueLabel`, all defaulted so its existing call sites are untouched, and `exercise-history-sheet.tsx` and `health-metric-sheet.tsx` are converted. **`valuePadding` defaults to 0.5 and that changes what a chart SAYS** — on a 0.5 kg spread it halves the visible amplitude — so pass `0` for exact min/max. **One inline copy remains and it is deliberate:** `components/workout/active-workout-screen.tsx` wants asymmetric padding, uniform dots, no fill, a dimmed stroke and an end-anchored label — four more props no other caller would use, which is a pass-through wearing a primitive's name. Do not convert it. Don't hand-count from `grep -rn '<polyline'`; run `node scripts/check-sparkline-primitive.js`, which is the maintained list. The exempt files (the script prints how many) were **re-audited 2026-08-09**: the primitive projects x by *index*, so `day-detail/day-sections.tsx`, `activity/exercise-review-sheet.tsx` and `body-battery-card.tsx` — all of which draw a *time* axis — were moved out of the to-convert list, alongside the primitive itself, `health/detail-hero.tsx` (decorative art) and `workout/live-hr-chart.tsx`. Note there is a **second** primitive, `components/ui/sparkline-chart.tsx` (chart.js), drawing the same 1RM-trend shape — it is not interchangeable, and must not be pulled into a hot screen.
- Interactive elements are real controls: shadcn `<Button>`/Radix primitives (Sheet, Dialog, Collapsible) with proper aria state — hand-rolled chevron toggles still ship no `aria-expanded` (**this list is hand-maintained and has drifted — Q-491 holds the live count**; `deload-explanation`, `signal-sections`, `more/profile-tab`, `health/day-overlay-sheet`, `workout/active-workout-screen`, `workout/ai-prescription-card`, `workout/added-weight-toggle`, `nutrition/meal-card`, `nutrition/saved-meals-sheet`). (The WebView nested-control exception above — `<div role="button">` — still applies where cards contain other controls.)

---

