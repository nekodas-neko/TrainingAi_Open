# 2026-09-23 — DV-4: the Sleep card's stage hours were printed in the stage colour

**Branch:** `fix/dv4-sleep-legend-contrast` · **Lane:** B · one line of product code, one test

Home's Sleep card coloured each legend value with its own stage colour. Deep's `#1e3a70` against the
page root measured **≈1.6:1**, and against the card's own purple paint in the device screenshot
**≈1:1** — the number was there and could not be read. Device Verification found it on the S25
during the P4 sweep. The hours now inherit the foreground; the stage colour stays on the dot and the
stacked bar.

## The entry named the fix, and the sibling sweep changed which fix it was

DV-4 proposed rendering the hours in a foreground token, and flagged that `hypnogram.tsx` also
imports `STAGE_COLOR` and "was not read". Reading all four consumers turned that loose end into the
argument for the change:

| consumer | how it uses `STAGE_COLOR` | |
|---|---|---|
| `hypnogram.tsx` | SVG `fill`, and a legend dot's `background` | fill |
| `sleep-phase-trend-card.tsx` | Chart.js `backgroundColor` | fill |
| `health-metric-sheet.tsx` | bar + dot `background`; **hours in the inherited foreground** | fill |
| `home-card-widget.tsx` | dot + bar `background`, **and the hours as `color`** | the bug |

So the sleep detail sheet already renders the *identical* legend the right way. This was not a
design decision to make — it was one surface out of step with three, and the shape to copy was
fifteen lines away in a file the entry had not opened. Nothing else needed changing.

## Why a palette fix could not have worked

The card's background is owner-customisable (`ColorSwatchPicker`, `cardColors.sleepWidget`), so
there is no card colour for which all four stage colours clear 4.5:1 — and stage colours are picked
to read against *each other* in a stacked bar, not against a background. REM, Light and Awake passed
only because they happen to be light. Darkening Deep would trade one unreadable pair for another the
first time the owner picks a dark card.

`accentCardStyle` (`packages/shared/src/utils.ts`) is what makes the foreground token safe: every
card paints a translucent `--muted` base under a 30%→12% accent wash, so the card's own 2xl hours
figure already relies on the foreground reading against exactly this background. The legend value
now sits on the same footing as the number above it.

## The test is the rule, not the line

`components/home/__tests__/dv4-stage-colour-is-never-text.test.ts` sweeps every `STAGE_COLOR`
consumer for the palette reaching a CSS `color` inside a `style` object. Three things make it worth
more than an assertion on one span:

- It **guards the siblings**, which are correct today and have no other protection.
- It asserts the dot and the bar are **still coloured**, so it cannot be satisfied by deleting the
  palette.
- It pins the contrast ratio, so the premise is checked rather than quoted.

Control run: with the colour put back it fails naming `home-card-widget.tsx:166`.

A first draft flagged two false positives — `{ label: 'Deep', color: STAGE_COLOR.deep }` in both
`home-card-widget.tsx` and `health-metric-sheet.tsx`, which are data fields that happen to be named
`color`. Scoping the check to lines containing `style=` separates them, and lowercase `color:`
excludes `backgroundColor:` on its own.

## Not done, and not claimed

**The device look is owed** — the entry keeps a `Verify: device` and a `Keep:`, so
`next-item.js --sittings` lists it. The sandbox can compute the ratio and does; it cannot see the
card, and it cannot see a custom card colour at all.

**DV-6 was considered for this PR and deliberately left out.** It is the next Lane B item and both
would be checked in one look at Home, which is the batch rule's own axis. It turned out to carry a
design question this diff should not smuggle: the app scrolls five independent inner containers
rather than the document (`PullToSync`, plus Nutrition's own), so a shell-level "fade in on scroll"
needs a capture-phase `scroll` listener and a rule for which panel counts — and the scrim's colour
has to compose with `DynamicBackground`, which sets `--page-bg: transparent`, so the obvious
`var(--page-bg)` gradient would be invisible exactly when it is needed. `--pt-safe-value`
(`max(1rem, inset + 0.5rem)`) is the right height and already floors the three-button-nav case where
insets read 0. Recorded so that work starts from here.
