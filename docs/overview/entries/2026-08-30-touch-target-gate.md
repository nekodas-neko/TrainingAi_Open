# 2026-08-30 — `feat/ci-accessibility-scan` (Q-282) — the scanner that would have passed a 12 px button

**Lane B · test-only.** One spec, no dependency, no product code. Q-282 closed; **LB-26** filed.

Q-282 asked for automated accessibility scanning of the running app — the half a linter cannot do:
**touch-target size and contrast**. Its own note said the Q-250 emulator dependency had expired and
`@axe-core/playwright` against the existing E2E job would do it.

**I installed axe, measured it, and removed it again.** It would not have worked, and the way it
fails is worth more than the feature.

## `target-size` cannot fail on this app

WCAG 2.5.8 exempts an undersized control that has clear space around it. So the mutation:

- Home's Refresh button, given `.tap-dense` so it escaped the CSS floor, and `style={{width:12,height:12}}`.
- `boundingBox()` confirmed **12×12**.
- axe reported it as a **pass**.

A gate that green-lights a 12 px button reads as coverage and is not. That is the guard-that-cannot-
fail shape from LB-19, one PR earlier, and it would have been shipped as an accessibility feature.

## `color-contrast` cannot judge this app at all

Measured on the same pass, per screen: `Could not parse color string oklab(0.0499998 -4.88013e-7
0.00000116974 / 0.95)` — the theme's tokens are `oklch`, which axe-core 4.13 does not parse — plus
`background color could not be determined because it is overlapped by another element` from the
dynamic-background layers. Counts of `incomplete` were **1 · 5 · 8 · 34 · 10** across the five tabs,
and **on Home `color-contrast` evaluated no nodes at all**.

So `projectOverview.md`'s "contrast that could NOT be measured" stands. It now has a reason rather
than an absence, which is the difference between an open question and an unexamined one.

## What shipped instead

`e2e/touch-target-size.spec.ts` measures rendered geometry from the DOM and enforces **this repo's
48 dp bar**, not WCAG's 24 px. On the same mutation axe passed, it fails with
`button 12×12 "Refresh"`.

It covers what `app/globals.css` cannot. That floor is `button, [role="button"]` — `<a>` is excluded
**on purpose**, because 48 px on an inline prose link would wreck paragraph layout — and `role="tab"`,
`role="radio"`, `role="switch"` are not in it either. Those are measured by nothing today.

The two documented opt-outs are honoured rather than fought: `.tap-target-44` and `.tap-target-dot`
give a small control an invisible hit box, and `globals.css` explains why each is sized as it is (a
hit area wider than the clearance steals a neighbour's taps). A control carrying one has made that
trade deliberately.

## What the measurement found

Across the five tabs, exactly **one** control is undersized with nothing compensating: Home's
*Download Android App* banner link, at **258×33**, an `<a>`. Filed as **LB-26** and allowlisted
shrink-only — removing the entry from `ALLOWED` is part of that fix, and the spec then fails until
the size is right.

Everything else that is small is deliberate and compensated: the three **7×7** workout carousel dots
(`tap-target-dot`, 24×44 box, sized to a 15 px pitch) and More's **32×32** photo control
(`tap-target-44`).

That is a good result for the app, and it explains the zero: the global floor is doing the work, and
a scanner would have taken the credit.

## Both scans assert what they examined

Each screen asserts a non-zero count of interactive elements before asserting zero violations. A
query that matched nothing would otherwise report no violations and pass — the same trap the ink
poll fell into in LB-19, written down here because it is now twice in two days.

## Not exercised

- No product code changed. The `session-select-content.tsx` edit was the mutation, reverted.
- Five tab screens only. Takeover routes (`/health/day`, `/workout?session=…`) and open sheets are
  not scanned; a sheet's controls are measured only if it happens to be open, and none is.
- Nothing device-verified. The DOM box is not the WebView's hit region, and native insets are
  outside this entirely — the Espresso route stays the answer for those if Q-250 ever lands.
