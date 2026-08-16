# 2026-08-09 — One token, 4.34 → 4.52:1

**Branch:** `fix/muted-foreground-contrast` · **Q-167** · **v1.275.3**

Light theme `--muted-foreground` was `oklch(0.556 0 0)` on `--muted: oklch(0.97 0 0)` — **4.34:1**,
under the 4.5:1 WCAG AA bar. It clears the 3.0:1 large-text bar, so it only mattered where the text
is small, and it is: nine full-opacity `bg-muted` + `text-muted-foreground` elements, all pill
badges and chips at 10–12 px.

`oklch(0.546 0 0)` gives **4.52:1** on muted and **4.94:1** on white. A 0.01 lightness step.

## Why this one was a one-line fix

Because the measuring was already done. `scripts/check-contrast.js` (#1196) computes every token
pair without a browser, and Q-167 was filed *from* its output after three failed attempts to eyeball
the same question the day before. The entry named the file, the line, the replacement value and the
resulting ratio; this session confirmed the number against `main` and changed it.

The check also closed the loop on itself: it **fails when a grandfathered pair starts passing**, so
after the token changed it printed *"These pairs now meet their minimum — remove them from
GRANDFATHERED"*. That row is gone and the map is empty, with a comment saying why rather than a
commented-out entry.

**20 pairs, 0 grandfathered.** The alpha variants (`bg-muted/30…/60`) were already at or above AA
because they blend toward the white page, and dark theme measures 9.04:1 — neither was touched.

## Verification

Rendered `/more` in light theme at 412×891 and read the resolved token back from the browser
(`lab(47.336% 0 0)`). The pill tabs there are the affected pair; nothing looks different, which is
the intended outcome of a 0.01 step. Full suite green, build compiles, all custom-rules scripts pass.

**Not exercised: device.** A CSS token change with no native surface, but light theme on the S25's
own display has not been checked.
