# 2026-09-28 — LB-153: one categorical palette, and none of it means good or bad

The owner's decision (2026-09-27) was to merge the three index palettes, set cards included, with no
colour that also means good, warning or bad elsewhere. Set 1 had been amber and set 2 green, which
read as a verdict on the set.

- `CATEGORICAL_PALETTE` and `categoricalColor(i)` in `packages/shared/src/chart-colors.ts`, beside
  `resolveColor`. Six hues from blue through pink (sky, violet, pink, indigo, cyan, fuchsia). Past
  six, the golden angle steps within the same 200°–330° band, so it can never land on green, amber
  or red.
- Converted: `setColor` (the set cards and the PiP view), the AI chat charts' default series
  colours, and the HR-recovery traces. The swept sibling, `calibration-card.tsx`'s `RATING_COLOR`,
  is a good→bad **scale**, so it keeps its verdict colours on purpose.
- The hex-literal baseline lost two rows (chart-message and hr-recovery-chart now hold none).
- A test pins the rule: no palette colour matches a verdict or ACWR band colour, and the generated
  tail stays in band. Putting green back fails it, and so does a full-wheel tail.

**The specific hues are Lane A's call, reversible in one constant.** The owner set the rule, not the
colours. **Not seen on a device:** the set cards are the surface he sees every session, so a
look on the S25 is owed. DV can confirm the colours render; whether they look right is his.
