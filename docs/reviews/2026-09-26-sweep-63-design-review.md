# Review sweep 63: a design review from 69 screenshots and a static audit

**Date:** 2026-09-26 · **Agent:** Review · **Docs only.**
**Owner request:** *"do what you can and send to DV — can be excessive."*

## Method

- **Screenshots:** 69 full-page captures of the **web build** at 412 × 915, scale 2.625, dark.
  - They cover every tab root, 30 pushed routes, 16 sheets, a zero-data account for empty states,
    and sign-in.
  - Captured through the repo's own Playwright auth setup, against the **local** database. It was
    freshened with test data; no production data or captures are involved.
  - **The images stay in the session scratchpad.** None is committed.
- **Static audit** of 559 `.tsx` files against `ui-ux-pro-max` and
  `docs/mobile-ui-and-performance.md`.
- **Every filed item was read at source.** The ones only a device can settle are marked, and routed
  to RV-205's Tier 1 targets.

**Limits:**
- This is the web build: no native local store and no real safe-area insets.
- Seed data made a few screens look odd (a 5:00 PM wake-up), so seed artefacts are not filed.

## Numbers from the static audit

| | count |
|---|---|
| Hex colour literals / other colour literals | 394 / 137 |
| Tailwind arbitrary values (about 1,100 are `text-[..px]`) | 1,433 |
| Distinct font sizes / radii | 42 / 16 |
| Text under 12 px (583 at 10, 287 at 11, 128 at 9) | 1,035 |
| Interactives with no pressed feedback | about 354 of 502 |
| `transition-all` / width-animated bars / `height:auto` animations | 40 / about 15 / 3 |
| Inputs with `enterKeyHint` | 0 of 135 |
| Bare spinners / files using `EmptyState` | 88 / 10 |

## Filed

| Entry | What | Gate |
|---|---|---|
| RV-207 | Quick wins: initials (TE for "Test User"), "1 exercises", a dropped second supplement tick, no pressed state on the tab bar and daily controls, width-animated bars, the Log pill over its icon, "13.0T" | — |
| RV-208 | Consistency: two colour maps for Push/Pull/Legs on one Health screen; 6:40 AM against 6:40am; four date forms; separators, unit spacing, durations | — |
| RV-209 | Type scale: a `--text-2xs` floor, workout screens first | — |
| RV-210 | Keyboard: `interactiveWidget`, `dvh` sheets, `enterKeyHint` | — |
| RV-211 | Home in an empty account: "week in review ready", "Good · 50", "rest" on unprogrammed days; the empty pill and stray marks; RHR in a score ring | — |
| RV-212 | Nutrition tone: red at 2 pm, a strikethrough for taken, an off-palette button, placeholder icons, adherence 0% | — (the definition is the owner's) |
| RV-213 | Empty meal slots as full cards with two add controls each | **owner, mockup first** |
| RV-214 | Workout card hierarchy ("Dumbbell" over "Push"), a wrapping pill, clipped recovery chips, two Start buttons | — |
| RV-215 | Loading and failure: a skeleton that never ends, cards that vanish, bare spinners | — |

**Sent to DV:** a Tier 1 target list on RV-205, plus RV-206 (Part E, P29–P41) in #1680.

## What worked well, so it is not "fixed"

- The Log Food sheet is clear.
- The Health Training calendar reads well, and its legend is good.
- Nutrition's summary card packs a lot without clutter.
- The pre-workout list is calm.

**The faults are consistency and feedback, not layout.**
