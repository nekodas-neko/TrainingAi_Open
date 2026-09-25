# 2026-09-25 — the muscle heatmap: a ramp you could not read, and a fix that could not work

**Branch:** `lane-b/rv101-heatmap-ramp-and-key` · **Lane:** Implementation B

RV-101 said the volume ramp's bottom two stops sat under the 3:1 non-text floor, so a barely-trained
muscle looked untrained. That was right. Both of its numbers and its prescribed fix were not.

## The background was wrong, and the defect was worse than filed

The entry measured the stops against `--card`. That is not what sits next to them. An untouched
muscle is painted with the component's own `defaultFill`, `rgba(128,128,128,0.18)`, composited over
the card — `rgb(30,41,33)`. Against that:

| stop | vs `--card` (as filed) | vs the real neighbour |
|---|---|---|
| `#14532d` | 2.04:1 | **1.65:1** |
| `#166534` | 2.60:1 | **2.11:1** |

The entry listed the default fill under *"not established … was not read"*. It is on line 122 of the
file the entry cites. Reading it was the whole correction.

## The prescribed fix does not work

*"Lift the bottom two stops past 3:1"* cannot be done. The floor is at luminance 0.159 and the third
stop was already 0.269 — so two lifted stops **and** their separation from the third would have to
share a total contrast range of **1.52:1**, roughly 1.15:1 each. That is not a ramp, it is three
shades of the same colour.

Re-spacing the whole ramp is the fix, and it lands more evenly stepped than what it replaced:
1.34 / 1.45 / 1.31 / 1.24, against 1.28 / 2.16 / 1.45 / 1.31.

## The brand hue caught me out

The opening stop is `#178a42`, not a Tailwind green, because `--card` takes the user's brand hue.
green-700 measures 3.00:1 at the default hue 149 and **2.99:1 at hue 144**. I had picked green-700
and the check rejected it — `check-contrast.js` already scores token pairs at their worst hue over
the whole circle, and extending that rule to the ramp is what found it. Worth keeping as the lesson:
a contrast number computed at one hue is a number about one user's theme.

## What shipped, and what was declined

Shipped: the re-spaced ramp, and a key reading *Under 20% … At target*. The key renders in **compact**
mode on purpose — both volume callers pass `compact`, and the injured swatch above it is gated on
`!compact`, so a key written the same way would be invisible exactly where it is needed. That trap
came from the entry's own 2026-09-24 re-read.

Declined, with reasons on the entry rather than left silent:

- **Giving the ramp its own hue.** Its middle stop is still `PRIMARY_COLOR`. But the two scales are
  chosen by mutually exclusive props and never render together, and the key names the scale at the
  point of use — which is what the collision actually needed. Changing the hue family of a card the
  owner reads weekly is a restyle with no standard saying the present one is wrong. Same test that
  kept RV-99 narrow.
- **A key in role mode.** Categorical, already has its injured swatch, and adding swatches would
  change what renders at seven call sites nobody has complained about.

## Enforcement

The numbers live in `scripts/check-contrast.js`, which already owned the maths, the `globals.css`
parse and the worst-hue rule — so no second copy was written. It reads the ramp and the fill out of
the component, and refuses to report a pass if either regex stops matching.
`components/__tests__/rv101-volume-ramp-and-key.test.ts` states the rule independently; 3 of its 4
assertions fail against `origin/main`, and the fourth pins the premise that both callers pass
`compact`.

**Not exercised:** the rendering. Nothing here was opened on the S25 or in a browser. The entry keeps
`Verify: device` for that look, and it now shows up in the `workouts` device sitting.
