# 2026-08-18 — Q-390: the deload flag was lifting its day's bar off the baseline

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.321.2** · **Lane:** Implementation B

## What the owner asked for, and what was actually wrong

*"look at the format; reccomend doing Mon (D) instead so it fits better."* — a formatting
preference. The entry had already traced it to something worse, and the trace holds: the flag was a
**sibling** of the day label inside a column flex, so it became an extra **row**, and since the bar
row is `items-end`, a taller column pushes its bar **up**.

The consequence is not cosmetic. On a chart whose only purpose is comparing days against each
other, a flagged day and an unflagged day **with identical volume drew at different heights** — and
the same overflow is what made the tallest bar collide with the "TRAINING LOAD" heading.

**Measured, not asserted:** with the extra row present the two bars sit **exactly 12 px** apart,
which is the figure the entry derived from the box model. The fix brings that to 0.

## What shipped

One file, `components/stats/weekly-stats-hub.tsx`:

- The flag is **inline in the label span** — `Mon (D)` — so no extra row exists and every column is
  the same height. It keeps its colour as a nested span, so the letter *and* the amber/purple
  survive; the glyph is the non-colour channel the colour-only-state rule needs.
- The bar row went from `h-14` to `min-h-[72px]`. The entry's third point was right and worth
  doing: the columns were **already** taller than 56 px with no flag at all (52 bar + 4 gap + ~13.5
  label ≈ 69.5), so they overflowed upward regardless. Inlining removes the *difference* between
  columns; this removes the *overflow*, which is what was hitting the heading. `min-h` rather than a
  fixed height keeps the row stable across weeks without re-introducing a ceiling.

## One correction to the entry

Its point 2 says *"Both flags can be true at once — the two `&&` blocks are independent, so a day can
render `D` and `T` together"*, and treats the combined form as a decision to make. **At the data
level they are mutually exclusive.** `classifyDay` computes

```ts
const isTesting = daySessions.some(isTestingSession)
const isDeload  = !isTesting && daySessions.length > 0 && daySessions.every(isDeloadSession)
```

— and carries a comment saying testing is decided first *deliberately*, "so each day gets its own
marker". So `(D·T)` cannot arise from the current producer.

**The combined form is implemented anyway**, and that is not the "error handling for scenarios that
cannot happen" the repo warns against: this component receives two independent booleans as props,
and making its rendering total over its own inputs is cheaper than depending on an invariant
enforced in an API route two layers away. `Mon (D·T)` is 9 characters in a ~51 dp column, which fits.

## Guard

`e2e/training-load-day-flags.spec.ts` seeds two days in the visible week with **the same volume**,
one `phase_type='deload'` and one plain, and asserts their bar **top edges land at the same y** —
the exact confirmation the entry asked for. It asserts geometry, not markup, because the geometry is
the defect; "the label contains (D)" would pass with the bug reintroduced in any other shape.

**Mutation-checked twice, and the second one mattered.** Reverting to sibling spans fails it — but
only on the *label* assertion, the weaker half. Re-checked with a geometry-only mutation (label left
inline so `(D)` still matches, one empty sibling span added back): the bars moved **12 px** apart and
it failed on the baseline assertion. Writing the first mutation also exposed a real weakness in the
probe — it read the label from `lastElementChild`, which is only the label while the layout is
correct, so it was blind to the very regression it existed to catch. It now reads the column's text.

## The spec took three CI rounds, and the reason is worth carrying

It passed locally and failed in CI twice. Both causes were in the *seeding*, not the fix:

1. **Future days are discarded.** `app/api/weekly-stats/route.ts` renders `isFuture ? [] : …`, so a
   session dated after today draws an empty 6 px sliver. The spec had seeded "tomorrow".
2. **`seed.sql` fills days relative to when it runs**, so a fresh CI database always has a session on
   the current week's Monday — and `isDeload` is `every(isDeloadSession)`, so that one ordinary
   session removes the "(D)" the assertions hang off. A months-old local database has a completely
   different set of days occupied, which is why local never showed it.

Together those leave very little room: on a Tuesday there are exactly two elapsed days and one is
already seeded. The spec now takes the *unseeded* elapsed day as the flagged one and uses the other
elapsed day as the control **whatever is already on it** — reading that day's existing volume and
matching it, rather than needing a free day or deleting a seeded row.

**What actually settled it was reproducing CI's database locally** (`createdb`, `migrate.js`,
`seed.sql`) rather than reading the job log — the log tail is filled by the Postgres container dump
and never showed the Playwright output. That reproduction is three commands and is worth reaching for
first next time.

## What was NOT exercised

- **The device.** Chromium at 412×915. The entry says browser-reproducible at the S25 viewport with
  no native path and no production data, and that is how it was verified — but a 9 px label with a
  nested coloured letter is worth a glance on the real panel.
- **A testing week.** `T` and `(D·T)` were never rendered against real data, because no seeded
  session carries `phase_type='testing'`. The deload path is the one under test.
- **Light theme.** The amber/purple flag colours are pre-existing palette classes and were not
  re-checked in light mode; this change did not alter them.
