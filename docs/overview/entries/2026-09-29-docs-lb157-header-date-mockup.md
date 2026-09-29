# LB-157 — the answer was given; the mockup it owed was not

**Branch:** `docs/lb157-header-date-mockup` · docs-only, no version bump

LB-157 came up as Lane B's queue head with its question answered: the owner chose on 2026-09-26 that
**the date goes on its own line**, and kept the battery chips on Home deliberately. Its last bullet
also said a mockup of the chosen option was owed before it was built — the large-UI rule, because a
two-line header visibly rearranges a screen he reads daily.

**That mockup had not been drawn, so it is what this PR delivers.** No code.

## And the answer leaves two placements

His words: *"The weather and battery chips keep the header row; the date moves below it."* The
entry's own recommendation, three bullets down: *"put the date on its own line **above** the chips."*
Those are different layouts, and the difference is visible. Drawn side by side at 412 dp rather than
guessed:

- **A** — chips keep the header row, date below them. His literal wording, and the default if he
  would rather not think about it.
- **B** — date first, chips under it. Reads top-down as date → conditions → greeting.

Both cost the same ~18 px of vertical space and both stop the row depending on the weather chip's
width, which is the property that matters: the entry is explicit that *"a fix that leaves the row
width-critical is not this decision"*. So the choice is preference, not engineering.

[`docs/design/2026-09-29-home-header-date-line.html`](../../design/2026-09-29-home-header-date-line.html)
([hosted](https://claude.ai/artifact/5rLHxLdX9RJM16GuveofDb)) draws today's clipped row alongside both,
with the measured widths under them.

## `Gate: owner` is now correct, and was correctly absent before

The entry said `Gate:` was *"deliberately absent so it prints as READY and someone puts it to him"* —
right for a question nobody had asked yet, since a gate parks an entry where no one is assigned to
it. Now that the mockup exists, the entry is blocked pending an answer already sought, which is
exactly what a gate is for. It carries `Gate: owner` and has left the READY list.

## Verified

- `check-backlog-pointers` **529 entries**, no duplicates, all tagged; `next-item.js --lane B` no
  longer lists LB-157, which is the point of the gate.
- `check-doc-links` OK. Nothing else to run — no code changed.

## Not exercised

- **Nothing was built.** The panes are drawn from the app's own dark tokens at 412 dp, not
  screenshotted: the seeded database has no weather snapshot, so `WeatherChip` renders a 56 px
  skeleton and the real three-chip row cannot be reproduced in the sandbox. The chip widths come from
  the 2026-09-12 device measurements; the row width, the gap and the date formats were re-measured on
  2026-09-25 and agree to 0.1 px.
- **The device.** How the two-line header actually reads on the S25 is his to judge there.
