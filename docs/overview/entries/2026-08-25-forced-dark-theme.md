# 2026-08-25 — the app is dark, and the OS cannot change it

**Branch:** `feat/forced-dark-theme` · **Entry:** BF-25 · **Lane:** B

## What shipped

`app/layout.tsx` — the `ThemeProvider` goes from `defaultTheme="system" enableSystem` to
`forcedTheme="dark" defaultTheme="dark" enableSystem={false}`, plus `e2e/forced-dark-theme.spec.ts`,
four specs that all run under `colorScheme: 'light'`.

## The finding: the prescribed one-liner would have shipped the bug it was meant to close

BF-25 said **DO: `forcedTheme="dark"` … One line.** That is not enough, and the gap is not
theoretical — it was measured on `/health/heart-rate` with only that prop set and the browser in
light mode:

| Layer | `forcedTheme` alone | Shipped |
|---|---|---|
| `<html>` class | `dark` ✅ | `dark` |
| Page root gradient | `rgb(61, 8, 8)` ✅ | `rgb(61, 8, 8)` |
| **DetailHero art** | **`rgb(255, 225, 225)`** — pale pink | `rgb(92, 16, 16)` |
| **Readability scrim** | **`rgba(255, 255, 255, 0.92)`** — white | `rgba(0, 0, 0, 0.92)` |

A white scrim beneath white body text, over a dark page. Which is precisely the failure BF-25
exists to prevent.

**Why.** `forcedTheme` governs the attribute `next-themes` stamps on `<html>` and nothing else. Read
from the pinned source (`node_modules/next-themes/dist/index.mjs`), the context still computes
`resolvedTheme: theme === "system" ? systemTheme : theme`, and `forcedTheme` is a separate field that
never feeds it. With `defaultTheme="system"` and no stored value, `resolvedTheme` **is** the OS
scheme. Two components branch on it: `detail-hero.tsx` (`resolvedTheme === "light" ? "light" :
"dark"`, choosing between two hand-illustrated palettes *and* two scrims) and `sonner.tsx` (which
passes `theme` straight to Sonner, so toasts would render light).

`defaultTheme="dark"` + `enableSystem={false}` are what make the reported values agree with the
render. Safe because **`setTheme` has zero call sites** — nothing has ever written
`localStorage.theme`, so the default is what every user, new or returning, resolves to. That was
checked, not assumed.

`weekly-nutrition-chart.tsx` also reads `resolvedTheme`, but only as a `useMemo` dependency to
re-run `resolveColor('var(--x)')`; the colours come from computed CSS either way. Inert, left alone.

## The light palette is still there, deliberately

The `:root` block in `globals.css`, the `resolveColor` scheme pairs, `HERO_GRADIENTS`,
`screen-palettes.ts` and the `resolvedTheme` reads are all untouched. Unreachable CSS custom
properties cost nothing at runtime; deleting them is a wide hand-verified sweep whose only benefit is
tidiness, and it is the half that cannot be undone. Pinning the theme is three props; unpinning it is
deleting them.

## The pre-flight check BF-25 asked for

*"Three components document depending on `next-themes` stamping `.dark` on `<html>` synchronously,
before React hydrates. Confirm that still holds under `forcedTheme`."*

**It holds, and is strictly more deterministic.** The injected script's fourth argument is
`forcedTheme`, and its first branch is `if (forced) apply(forced)` — the `localStorage` read and the
`matchMedia` call are in the `else`. Under the old config the class depended on two runtime reads;
now it does not depend on any.

## The guard, and proof that it bites

Every assertion runs under `colorScheme: 'light'`, because **under the default they would pass
against the un-pinned build too** — which is exactly why this survived: nobody ever ran the app on a
light-set device. Verified by reverting `app/layout.tsx` and re-running: 2 of 3 route specs fail.
The hero/scrim spec is the one that catches the plausible-but-wrong one-line version. A control spec
asserts `prefers-color-scheme: dark` is still `false`, so a harness that silently stopped emulating
light cannot make the rest vacuous.

## Gates

`pnpm check:rules` — **Ran 58 of 58**. Typecheck clean. New e2e 6 of 6 (four specs, two routes).

## Not verified

**Device.** `Gate: device` residue: put the S25 in light mode and confirm the app stays dark end to
end — then the surfaces the provider cannot reach, which are the icon routes (no CSS) and any canvas
paint. The sandbox emulates `prefers-color-scheme`; it does not run Samsung's WebView or its
auto-scheduled night mode.
