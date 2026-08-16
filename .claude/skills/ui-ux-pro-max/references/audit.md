# UI audit checklist

Walk this in order. Report P0 findings even if the user asked about something else — they break the
build or the device.

Every finding needs: `file:line`, the rule number from SKILL.md, what breaks, and on which surface
(web / APK / light theme / dark theme).

---

## P0 — run the CI greps first

These are the exact checks in `.github/workflows/ci.yml`. Running them locally takes seconds and
they are the cheapest possible finding.

```bash
# 1. Hand-rolled safe-area insets (rule 1)
grep -rn --include='*.tsx' 'safe-area-inset' app/ components/ \
  | grep -v 'components/shell/bottom-nav.tsx'

# 2. pt-safe stacked with another pt-* class (rule 2)
grep -rnE 'className=.[^"'"'"']*\bpt-safe(-or-4)?\b[^"'"'"']*\bpt-[0-9]' app/ components/ --include='*.tsx'

# 3. Hardcoded session names (rule 4)
grep -rnEi --include='*.ts' --include='*.tsx' '"(Push|Pull|Legs)"' app/ lib/ components/

# Or just run the whole local gate:
pnpm ci:local
```

## P0 — bottom clearance (rule 5)

For every bottom-anchored control, action row, footer, or fixed element:

```bash
grep -rn 'pb-safe' app/ components/ --include='*.tsx'
```

For each hit, classify the context and check the utility matches:

- Inside a full-screen / navless takeover (workout phase, fitness-baseline test, any screen with no
  bottom nav)? It must be **`pb-safe-action-lg`**. Bare `pb-safe` here is the 2026-07-19 regression.
- Action row inside a nav screen? `pb-safe-action`.
- Bare `pb-safe` under a tappable control? **Finding.** Bare `pb-safe` is only ever trailing scroll
  padding.
- Fixed element on a nav screen? Must clear `3.5rem + var(--safe-bottom)` — use `bottom-nav-safe` or
  `bottom-fab-safe`.

Then confirm the class is actually defined:

```bash
grep -n 'pb-safe-action-lg\|pb-safe-action\|pt-safe-or-4\|bottom-nav-safe' app/globals.css
```

A referenced-but-undefined utility fails silently. `.pt-safe-or-4` shipped that way for a release.

## P0 — sheets (rule 6)

```bash
grep -rn 'SheetContent\|SheetFooter' components/ app/ --include='*.tsx'
```

- Any `pb-safe*` inside a `side="bottom"` sheet? Finding — it double-pads.
- Any `pt-safe` on a sheet? Finding.
- `p-0` on a `SheetContent` assumed to strip the baked inset? Finding — tailwind-merge does not know
  these classes.
- A `side="left"`/`"right"` sheet with no explicit inset? Finding — those bake nothing.

## P0 — nested interactive elements (rule 7)

```bash
grep -rn 'role="button"' components/ app/ --include='*.tsx'
```

Read each hit in context:

- A real `<button>` containing another `<button>`, an `<a>`, or a `span role="button"`? Finding.
- A tappable card containing controls that uses `<button>` as the wrapper instead of
  `<div role="button" tabIndex={0}>`? Finding.
- A `div role="button"` with no `tabIndex` and no keyboard handler? Accessibility finding.

---

## P1 — colour and theme

```bash
# Hex literals (rule 8)
grep -rnE '#[0-9a-fA-F]{3,8}\b' components/ app/ --include='*.tsx'

# Literal white/black that breaks the other theme
grep -rn 'text-white\|bg-white\|rgba(255, *255, *255\|rgba(0, *0, *0' components/ app/ --include='*.tsx'

# CSS vars passed to canvas paint APIs (rule 9)
grep -rn "var(--" components/ --include='*.tsx' | grep -iE 'fillStyle|strokeStyle|borderColor|backgroundColor|lineColor|color:'
```

For each: is it decorative-and-theme-independent, or semantic? Semantic colour must be a token.
A `var(--x)` string reaching chart.js or a canvas context renders **black** with no error.

Then check both themes explicitly:

- Does the component read `resolvedTheme` behind a mounted gate and colour a page root with it?
  Finding (rule 10) — light-theme users get a dark flash on every navigation.
- Is there a `lineColor ?? 'rgba(255,255,255,…)'`-shaped default? Finding — every call site that
  omits the prop is a light-mode bug.
- Does any decoration SVG paint a full-bleed rect or a bg-colour cutout? Finding (rule 12).
- Is a value coloured by `scoreBand()` without rendering the band's label or icon? Finding (rule 13).

```bash
# Emoji in UI (rule 14)
grep -rnP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' components/ app/ --include='*.tsx'
```

## P1 — touch and gesture

- Any tappable element smaller than 48dp, or two within 8dp of each other?
- Any primary action anchored to the top of the screen?
- Custom `onTouchStart`/`onTouchMove` handling — does it direction-lock **during** the gesture?
  Does it exclude every `.overflow-x-auto` ancestor, or only tagged ones? (rule 17)
- `overscroll-behavior: none` anywhere? Almost always a gesture bug being papered over.
- Hand-rolled swipe/drag logic where `@use-gesture/react` or `@dnd-kit/react` would do? (rule 18)

## P1 — perceived performance

- Does the screen render a skeleton on a repeat visit? It should seed from `readCacheSync` in a
  `useEffect`. (rule 19)
- Any `readCacheSync` or `JSON.parse` in a `useState` lazy initializer? Finding — hydration mismatch.
- A `dynamic(…, { loading: <Skeleton/> })` on a cache-seeded card? Finding (rule 20).
- A save path that awaits `fetch` before flipping UI state or showing a toast? Finding (rule 21).
- POSTs awaited serially in a loop? Finding — batch or `Promise.all`.
- A submit/complete button with no in-flight guard? Finding.
- `useElapsedSec` / `useCountUp` / `setInterval` called in an orchestrator rather than the leaf that
  displays the number? Finding (rule 22).
- A `React.memo` component receiving an inline arrow or object literal at its call site? Finding
  (rule 23) — the memo is silently dead.
- Rows in an editable list keyed by `index`? Finding — deleting a middle row leaks input state.

## P2 — reuse and structure

```bash
# Files past the size limit (rule 26)
find app components -name '*.tsx' -exec wc -l {} + | sort -rn | awk '$1 > 800'

# Inline sparklines bypassing the primitive (rule 24)
grep -rn '<polyline' components/ app/ --include='*.tsx'

# Missing aria-expanded on toggles (rule 25)
grep -rn 'ChevronDown\|ChevronUp' components/ app/ --include='*.tsx'
```

- Is any pattern in the diff already a primitive in `components/ui/`?
- Is a new pattern appearing at a second site? Extract before the third copy.
- Is a palette or threshold set defined inline that already lives in `lib/`? (rule 27)
- Did a change to one surface skip its siblings in the same domain? (rule 28)
- Any tap-target or focus-ring rule added as a bare `button`/`a` selector in `globals.css`? (rule 29)

---

## Reporting

Order P0 → P2. For each finding:

```
P0 · rule 5 · components/fitness-baseline/test-screen.tsx:214
Discard/Save row uses `pb-safe` in a navless full-screen flow. On Android gesture-nav
env(safe-area-inset-bottom) reports ~0, so both buttons sit on the gesture bar.
Fix: `pb-safe-action-lg`. Not verifiable on web — insets render as 0 in the sandbox.
```

Close the report by naming the surfaces the audit could **not** cover: on-device safe-area,
Samsung WebView compositing, real gesture behaviour, native SQLite paths.
