## 2026-08-08 — light mode's brand colour finally applies, and brand fills get a foreground token (Q-119, v1.270.11)

**Branch:** `fix/light-mode-brand-token` · **Domain:** `app-shell`

### What was wrong

`app/globals.css`'s light `:root` set `--brand: oklch(0.55 0.22 149)` under a comment saying it was
"darkened for light-mode text readability". It never set `--color-brand` — and `--color-brand` is
the variable the `text-brand` / `bg-brand` utilities read, at 495 sites against 2 for `var(--brand)`.
So the light value governed almost nothing and every brand-coloured label kept the `@theme` default,
which is byte-identical to the `.dark` value. Measured with a WCAG contrast calculation over the
repo's own OKLCH→sRGB conversion: **2.22:1 on white**, against the repo's 4.5:1 body-text floor.
Every non-default `[data-brand="…"]` block already set both variables, which is why only the default
green was broken and why it survived.

Separately, nothing named the text colour that sits *on* a brand fill. Three conventions had grown
instead: `text-white` (42 sites), `text-black` (4 — not counted in the original finding), and inline
`color: '#000'` (13 occurrences). On dark-mode green, white reads 2.22:1; on light-mode green after
this change, black reads 4.47:1. Neither literal is right in both themes, so both were wrong
somewhere.

### What shipped

- **`--color-brand` is now set in the light `:root`**, alongside `--brand`.
- **The light green moved from `oklch(0.55 …)` to `oklch(0.52 …)`.** Wiring the variable alone would
  have landed at 4.16:1 — better than 2.22 but still under the floor. 0.52 measures **4.70:1** on
  white and 4.70:1 for white-on-brand, so both directions clear 4.5 with the same value.
- **New `--brand-foreground` token**, exposed to Tailwind as `text-brand-foreground` via
  `@theme inline`. Black or white per brand × scheme, chosen by measured contrast, not by scheme:
  white for every light variant, black for every dark variant **except** `.dark[data-brand="red"]`
  (5.07:1 white vs 4.14:1 black). Custom hues are pinned at `oklch(0.7 0.2 h)`, where black wins at
  every hue on the circle (worst case 7.04:1 vs 2.23:1), so `applyCustomHue` and the pre-hydration
  boot script in `app/layout.tsx` both set it to black; `applyBrandTheme` clears it.
- **59 hardcoded foreground literals converted** across 44 files — all three conventions.

### Verification

- `tsc --noEmit` clean · `pnpm lint` 0 errors · `vitest run` 3217/3218.
- The one failure, `scale-ble-multi-reading.test.ts`'s user-scoping case, **reproduces identically on
  a clean checkout of `origin/main`** — its "another account" insert picks whichever user
  `LIMIT 1` returns, which locally is the seeded `test@local.dev` that already owns a 2026-07-29
  `body_metrics` row. CI's unseeded database has no such row. Filed as its own backlog entry rather
  than fixed here.
- Playwright at the S25 viewport (412×915), **light and dark**, on Home / Workout / Config: light
  mode's brand green is visibly darker and its buttons keep white text; dark mode's "Start Workout"
  and "Recommended today" now render black-on-green instead of white-on-green.

### Not exercised

No device run — this is CSS and class names, no native, safe-area, gesture or notification path.
Contrast figures are computed from the OKLCH values through the same conversion the app itself
ships (`theme-color-picker.tsx`'s `oklchToRgb`) plus the WCAG relative-luminance formula; they are
not screen-sampled measurements. The seven non-default brand themes were reasoned about from those
numbers, not each opened in the browser.
