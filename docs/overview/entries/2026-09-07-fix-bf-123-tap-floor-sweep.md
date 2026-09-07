# 2026-09-07 — the 48 px tap floor's opt-out, finally swept (BF-123)

**Branch:** `fix/bf-123-tap-floor-sweep` · **Lane B**

## What the owner saw

A screenshot of the program editor sheet — *"noting this UI is really bad and needs adjustment"* — in
which the muscle chips render as large filled circles with a 10 px label floating in the middle.

## What it was

`app/globals.css` sets `button, [role="button"] { min-height: 48px; min-width: 48px }` under 640 px.
Every control that declares a smaller box loses to it: a `rounded-full` chip asking for `h-5 px-1.5`
comes out as a 48×48 circle, and a short label (`lats`) also loses the min-width, so it is perfectly
round. `components/ui/switch.tsx` has carried this diagnosis verbatim since the floor shipped, along
with the fix — `tap-dense` plus an invisible touch box. CLAUDE.md's **No global element-selector
styling** rule required the sweep in the same PR as the rule. It never happened; this entry is that
sweep, arriving as an owner bug report rather than an audit.

## What shipped

**48 call sites across 24 files** now carry `tap-dense` plus a restored touch area — `.tap-target-44`
everywhere except the icon-picker grid, whose 5 columns sit on a 36 px pitch and take `.tap-target-dot`
so the box extends only in the unconstrained axis. Six wrapped chip rows also grew their real ink
(`py-0.5` → `py-1.5`, the muscle chips `h-5` → `h-7`) so the 44 px box overflows by ~2 px into a
neighbour rather than ~10.

Measured in the harness at 412 dp, after: the muscle chips render **47×28 / 89×28** where they were
48×48, the time-budget steppers **24×24**, the exercise icon buttons **38×34**.

**The sweep found more than the entry estimated — 48 product sites, not ~20.** The extra are
padding-sized pills (`px-3 py-1.5 text-xs`) that the floor stretches from 28 px to 48 px: the same
defect, less dramatic because they are wide enough that only the height is wrong. Deliberately **not**
touched, with reasons: `components/more/trophy-case.tsx` (`aspect-square`, height comes from the grid),
`components/workout-builder/goal-spectrum.tsx` and `builder-review.tsx:660` (full-width option card and
a send button — 48 px is right for both), `config-screen.tsx:629/639` (two-line cards, already taller
than the floor), everything under `components/admin/` and `components/oura-ble/` (debug consoles), and
every site that already declares its own `min-h-*`, which is a floor its author chose.

## Found in passing, measured, and fixed: `.tap-target-44` was overriding `absolute`

`.tap-target-44 { position: relative }` sat **unlayered** in `globals.css`. Unlayered CSS beats every
cascade layer regardless of specificity, so it beat Tailwind's own `.absolute` utility — and
`components/more/profile-tab.tsx:217` combines the two to pin the avatar edit badge to the picture's
corner. Measured on `/more` at 412 dp: `getComputedStyle(el).position` read **`relative`** and the
badge sat at **x=162**, flowed inline below the avatar. Moving the declaration into `@layer components`
(the `::before` boxes stay unlayered, nothing conflicts) makes the utilities layer win: **`absolute`**,
**x=226**. Both readings are from the running app, not the stylesheet.

## The guard

`components/__tests__/carousel-dot-hit-area.test.ts` gained a source guard: **no `tap-dense` control
without a restored touch area**, across every `.tsx` under `app/`, `components/`, `lib/`. Three sites
are listed with the reason they are exempt — two inline underlined text buttons (the case the opt-out
was written for) and the Deload pill, which grew its ink instead because Q-176 measured that a box
there would swallow the stats button's taps. Shrink-only. A second test pins the `@layer components`
placement with the measurement above.

`e2e/touch-target-size.spec.ts` passes on all five screens — it honours `.tap-target-44` /
`.tap-target-dot` by `classList`, which is why the sweep uses those classes rather than the `before:`
utilities `switch.tsx` uses.

## Not verified

**Not run on device.** This is CSS and class changes reaching the WebView through a Railway deploy, no
APK — but 41 of the 48 sites are on screens the e2e gate does not open (sheets, pickers, the config
editor), so their rendering is verified in the harness at 412 dp rather than on the S25.

## What this unblocks

**BF-124** (`Needs: BF-123`) is now startable, and the screenshot above shows both of its symptoms
plainly: the *Main Compound · Secondary Compound · Accessory* row still cannot fit — `Accessory` is
clipped at the right edge — and the selected pill is a white slab that reads as disabled.
