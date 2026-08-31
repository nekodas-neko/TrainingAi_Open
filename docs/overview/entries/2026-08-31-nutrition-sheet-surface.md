# BF-75 — the sheets carry the tab's palette, and the obvious fix could never have worked

**Branch:** `feat/nutrition-sheet-surface-bf75` · **Lane B** · v1.409.0

The owner: *"just the fact that it's a plain black screen on every nutrition pull-up screen; if we
could have a good background for these pages it would be good. Maybe we need a theme for nutrition of
sorts."*

**A nutrition theme already existed** — `--screen-palette-nutrition`, rendered behind the tab. Every
sheet opted out of it, because `SheetContent`'s base class list starts with `bg-background`.

## The obvious fix is wrong, and knowing why decided the design

Make the sheet translucent and let the wallpaper through. It cannot work: the wallpaper is
`fixed inset-0 z-[-1]` while `SheetOverlay` **and** `SheetContent` are both `z-50`. A transparent
sheet reveals the overlay's `bg-black/50` — a black panel, which is what was already there. Turning
the overlay off instead would take away the dimming that separates a modal from the page, and on a
sheet of macro numbers and ingredient rows that dimming is part of what keeps small grey text
readable.

So the palette is **painted inside** the sheet: an `absolute inset-0` layer carrying
`screenPaletteVar(key)` plus the same `ScrimLayer` the DetailHero pattern uses, behind an opt-in
`surface="page"` prop. Opt-in because `SheetContent` is the app-wide primitive — every sheet in every
tab renders through it, and a default here is the *"no global element-selector styling"* hazard
wearing a component's clothes. Five nutrition sheets pass it; a test asserts nothing else does.

## The thing that would have shipped broken

`SheetContent` is `fixed z-50`, so it **establishes a stacking context**. Inside one, an `absolute`
child with no z-index paints *above* the non-positioned content — the gradient would have covered
every row of every sheet it was added to. `-z-10` is what puts it above the sheet's own background
and below its children.

**A hit test cannot see that, and this was measured rather than assumed.** The first version of the
e2e assertion used `document.elementFromPoint` at the centre of a tab, on the reasoning that a
covering layer would be the topmost node there. It is not: the layer is `pointer-events-none`, so
hit-testing skips it whatever its paint order — **the spec passed with `-z-10` deleted.** It reads
the computed `z-index` now, which fails on that mutation and is also stronger than asserting the
class, since a class survives ceasing to be a real utility.

## Two findings the entry did not have

**The dynamic background ships `enabled: false`.** So this is invisible to anyone who has not turned
wallpapers on — deliberately, since a sheet painting a gradient over a plain page is worse than the
opaque sheet it replaced. The owner's own screenshots show the warm brown behind the day screen, so
they have it on. It also means the sandbox shows nothing by default, which is why the e2e has to
switch it on before it can assert anything at all — the "passes because the feature is off" trap.

**`pathnameToSection` and `pathnameToPaletteKey` were private to `dynamic-background.tsx`.** The
sheet and the wallpaper behind it must agree on which palette a route has; two copies would disagree
the first time a route moved, and the failure is a sheet in one colour over a page in another. They
moved to `lib/background/pathname-routing.ts` — which also made them testable for the first time,
since a `usePathname` hook and a weather fetch previously stood between them and any assertion.

## Verified

`tsc --noEmit` clean · `pnpm lint` **0 errors** · `pnpm check:rules` **Ran 65 of 65** · full
`npx vitest run` **690 files / 5,779 passed**, 3 files / 59 skipped.

`e2e/nutrition-sheet-surface.spec.ts` seeds the persisted store through `addInitScript` — before the
first paint, since writing it after `goto` races the render being tested — and asserts the layer
mounts, carries `--screen-palette-nutrition` rather than another screen's, resolves to a negative
z-index, and leaves the sheet usable. A second test asserts that with the wallpaper **off** no layer
mounts at all.

Every guard is **mutation-tested**: dropping `-z-10`, removing the `ScrimLayer`, removing the
wallpaper-off gate, and taking `surface="page"` off one call site each fail their own test — and the
z-index mutation fails the **e2e**, which is the one that matters.

## Not exercised

- **The contrast check, which is the whole of what BF-75 still owes.** Body and secondary text over
  the gradient plus scrim has to hold ≥4.5:1 on the S25, and the dense sheets are where it will fail
  if it does. The sandbox renders the palette but is not the device.
- **How it looks beside an unchanged sheet.** That Health, Workout and More do not opt in is held by
  a test; whether the difference reads as deliberate is a judgement for the phone.
- **Anything about the wallpaper itself.** It is off by default here, so every visual claim above is
  about a state the e2e forced on.
