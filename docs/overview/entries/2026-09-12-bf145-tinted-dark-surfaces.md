# 2026-09-12 — BF-145: the dark surfaces carry the user's brand hue, and the entry's own recipe was measured and found short

**Branch:** `feat/bf145-tinted-dark-surfaces` · **Lane B** · `app/globals.css`, `app/layout.tsx`,
`components/theme-color-picker.tsx`, `scripts/check-contrast.js`, backlog, changelog.

Owner, on the Edit Program sheet: *"Needs a major uplift + addung in a color scheme instead of the
plain black"*.

## The hue had nowhere to go

`brandHue` has been a stored preference for months and it drove `--brand` alone. Every dark surface
token read `oklch(L 0 0)` — background, card, popover, secondary, muted, accent, sidebar — so the app
was greyscale by construction and the accent was the only colour that could appear on top of it.

`--brand` is a whole colour; CSS cannot sample one component out of it. So the fix is a second
variable carrying the hue **angle** alone, and the surfaces built from that. `--brand-hue` is now set
everywhere `--brand` is, which is four places and not one:

- `app/globals.css` `:root` (149, green) and one line in each of the eight `[data-brand]` blocks.
- `app/layout.tsx:51` — the **pre-paint inline script**. Miss this and the surfaces render grey and
  then tint, which is the skeleton-flash class the mobile rules already ban.
- `components/theme-color-picker.tsx:43` `applyCustomHue` — sets it.
- …`:61` `applyBrandTheme` — **removes** it. An inline value outranks the `[data-brand]` block it is
  switching to, so a leftover hue would tint every surface for the colour just moved away from.

Verified in Chromium against the running app: the variable resolves for all eight presets, follows a
custom hue, and falls back to 149 when cleared.

## The entry's recipe would have shipped an invisible change

BF-145 prescribed chroma **0.01–0.03 with lightness untouched**. Built exactly that, then measured
the painted pixels rather than trusting it: `--card` at L 0.09 with chroma 0.018 is sRGB **`1,3,1`**
— a channel spread of 2 out of 255. `--background` at L 0.05 is `0,1,1`. There is no hue to see at
those lightnesses whatever the chroma, and the screenshot confirmed it: still a black app.

**The greyness was dominated by lightness, not by chroma.** So the ramp is lifted as well as tinted:

| token | was | now | sRGB at hue 210 |
|---|---|---|---|
| `--background` | `oklch(0.05 0 0)` | `oklch(0.145 0.020 var(--brand-hue, 149))` | `2,12,15` |
| `--card` / `--popover` / `--sidebar` | `oklch(0.09 0 0)` | `oklch(0.185 0.028 …)` | `2,22,26` |
| `--secondary` / `--muted` / `--accent` / `--sidebar-accent` | `oklch(0.13 0 0)` | `oklch(0.225 0.034 …)` | `4,32,36` |

Chroma still rises with lightness — a fixed one reads as a cast on the page and as nothing on the
panels. Foreground tokens keep chroma 0; tinting text is how a dark theme goes muddy.

**Contrast went the right way on every pair**, measured in-browser: foreground/background 18.9:1,
foreground/card 17.8:1, muted-foreground/card 8.36:1 — against a 4.5:1 floor. The card-to-page
separation the entry warned about **widens**, 1.010:1 → 1.066:1, so a card stops relying on its
border to read as a card. Only four `bg-black` sites exist and all are deliberate full-screen
blackouts (PiP, camera preview), so nothing now mismatches a lifted page.

## The contrast check could not see the new tokens, which is why it failed correctly

`scripts/check-contrast.js` parses literal `oklch(L C H)` triples out of `globals.css`. A `var()`
hue matched nothing, the dark palette came back empty, and its identity guard stopped the run rather
than reporting light-only numbers twice — the failure mode it was written to prevent, working.

Taught it the hue variable, and **not by reading the `var()` fallback**: that would measure one hue
out of 360 and call it the palette. A variable-hue token is now scored at its **worst hue over the
whole circle** (3° steps), and the failing key names that hue. Proven by mutation — `--muted` at
`oklch(0.45 0.12 …)` reports `dark:muted-foreground on muted (worst hue 192°): 2.96:1`, and the
shipped ramp passes 20 of 20 with none grandfathered.

## The sheet half is refuted, not skipped

BF-145's second half says to make `SheetContent` translucent so the wallpaper shows through.
`components/ui/sheet.tsx:70-87` already records BF-75 trying that and measuring why it cannot work:
the wallpaper is at `z-[-1]` while `SheetOverlay` and `SheetContent` are both `z-50`, so a
transparent sheet reveals the overlay's `bg-black/50`, not the tab behind it — and dropping the
overlay takes the dimming that keeps small grey text legible on a dense sheet. BF-75's answer was to
*paint* the palette inside the sheet (`SheetSurfaceLayer`), and that shipped.

What is actually left is adoption, and it is the owner's call: `surface="page"` is opt-in at **five
of 46** `SheetContent` files, and `sheet-page-surface.test.ts:63` pins that list on purpose. The
wallpaper also ships **off**, so for a user who never enabled it there is nothing to reveal. Left in
the backlog with the recommendation to re-ask rather than widen — the tint now reaches all 46 sheets
through `--background` regardless.

## Verification

`pnpm check:rules` **Ran 73 of 73**. `tsc --noEmit` and `eslint` clean. `pnpm test` — **700 files,
7213 tests, 0 failed**. `check-contrast.js` 20 of 20. Rendered and pixel-sampled in Chromium at the
412×915 S25 viewport against the local database: Home, Config, and the Edit Program sheet the owner
reported.

**Not exercised — this is a colour change and the sandbox is the wrong instrument for two of its
risks.** Samsung's WebView, where OLED renders near-black differently from a desktop panel, and the
device's own display calibration: whether `2,12,15` reads as "tinted dark" or "washed out" on the
S25 is a judgement only the phone can settle. No safe-area, gesture, native or offline-first path is
touched. Recorded as a `Verify: device` on the entry and as a Known-Issues row.

**If the owner wants more or less colour, three numbers move it** — the lightnesses `0.145` /
`0.185` / `0.225` in the `.dark` block. `check-contrast.js` will say if a move breaks a pair.
