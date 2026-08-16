# 2026-08-10 — the same rule, two opposite fixes (Q-176)

**Branch:** `fix/tap-dense-remaining-hit-areas` · **Domain:** `app-shell` · **v1.277.2**

Q-160's audit found two controls still opting out of the 48px tap floor with `tap-dense` and putting
nothing back. They are fixed **differently**, and the difference is the whole rule.

## The avatar's camera badge — give it an invisible box

32×32 of ink. That clears WCAG 2.5.8 AA (24px) but not Material's 48dp. The thing behind it is a
plain `<div>`, not a control, so nothing is close enough to be overlapped: it can take the full box.

`.tap-target-44` (a centred, invisible 44×44) added next to `.tap-target-dot`. Measured live on
`/more`: ink still **32×32**, hit area **44×44**, and a clash check over every `button`, `a`,
`[role="button"]` and `input` on the page found **zero** intersecting elements — the isolation was
confirmed, not assumed.

## The Deload pill — grow the real ink instead

This one sits **8px below a large stats button**, as a later sibling in DOM order. An invisible box
reaching into that button would win the overlap and swallow taps meant for it — precisely the
failure Q-160 measured on the carousel dots, in reverse.

So no overlay. `py-0.5 → py-1`, `px-2 → px-2.5`, `mt-1 → mt-1.5`: **21px → 25px** of real ink,
clearing the 24px minimum with the gap above preserved. Slightly visible, and honest — the control
really is bigger, rather than claiming space it would have to steal.

**The entry's own number was wrong**: I wrote "about 16 px tall" in Q-176 from reading the CSS.
Measured against the live stylesheet it was **21px**. Still under the minimum, so the finding stands,
but the figure came from arithmetic rather than a browser and it was out by a third.

## Why this is the interesting part of a two-line change

`tap-dense` has ten users and there is no single correct remedy. Three are legitimately bare (inline
text buttons in prose, where a box would overlap the words around them). One restores 48px itself
(`Switch`, isolated). Three take a 24×44 box sized to a dot row's pitch. One takes 44×44. One grows
its ink instead. **What decides it is the clearance to the nearest interactive neighbour**, and the
only way to know that is to measure it.

The new utility's own comment says so, and a test asserts the Deload pill is *not* given a
`tap-target-*` class, so a future tidy-up cannot "make it consistent" and reintroduce the overlap.

## Verified

- Browser at 412×915: badge ink `32x32`, `::before` `44px x 44px`, zero overlapping controls.
- Deload pill measured against the live stylesheet by rendering the same classes: **21px before,
  25px after**, 8px gap to the stats button above.
- `tsc --noEmit` clean · **433 files / 3444 tests** green · all 16 custom-rule scripts pass.
- One lint warning in `profile-tab.tsx` (`invalidateCache` unused) is pre-existing — no import was
  touched.

## A constraint worth recording

The explanatory comment I first put on the camera badge pushed `profile-tab.tsx` from 849 to 851
lines, past its **shrink-only** size baseline, and `check-component-size.js` failed. The comment
came out; the reasoning lives in the test and here. That is the ratchet working as designed on a
known hotspot — a two-line comment is not worth an exemption.

## Not exercised

- **The APK.** Tap targets are what a desktop browser can least vouch for.
- **The Deload pill in situ.** It renders only for an exercise with `deloaded`/`deloadReverted`
  set, and the seeded database has none. Its geometry was measured by rendering the identical class
  string against the live stylesheet — a CSS question answered with CSS — but **the real pill inside
  a real exercise row was not seen**.
