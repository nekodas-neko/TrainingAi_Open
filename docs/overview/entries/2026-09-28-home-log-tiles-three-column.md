# 2026-09-28 — LB-163: Home's Log tiles fill the row, and Log comes off the icon

**Lane B.** Branch `feat/home-log-tiles-three-column`. v1.478.7.

## What shipped

`app/session-select/components/metric-tiles-card.tsx`, built as approved on 2026-09-27 from
[`docs/design/2026-09-27-four-screen-mockups.html`](../../design/2026-09-27-four-screen-mockups.html):

- The container is a **fixed three-column grid** (`grid grid-cols-3 gap-2`) instead of a
  `flex … overflow-x-auto` row of `min-w-[76px]` tiles. The tiles sized to content and the row did
  not, which is what left the right third of the row empty at 384 px.
- **`Log` moved out of the absolute layer into the flow**, below the value, as a full-width pill.

**The 44 px tap target is kept, deliberately.** The overlap came from the *positioning* — an
`absolute top-0.5 right-0.5` pill carrying `min-h-11` — not from the size. Shrinking the control would
have traded a layout bug for an accessibility one, and the entry says so; the spec asserts the 44 px
floor so a future "fix" that shrinks it fails.

**Accepted trade, stated on the approved mockup:** a fourth widget wraps to a second line rather than
scrolling sideways. `overflow-x-auto` goes with the flex row.

## Verified

- **`e2e/lb163-log-tiles-three-column.spec.ts` — measured, not screenshotted**, because the entry
  states its acceptance in measurable terms: at 384 px the row fills the width, and `Log` does not
  overlap the icon at any tile count. It asserts a 3-column grid, that the tiles plus their gaps
  account for the container width, and per tile that the `Log` box does not intersect the icon box,
  sits below it, and is ≥ 44 px tall.
- **Control-run both ways, each mutation asserted as applied:** reverting the file to `main` fails on
  *"expected a 3-column grid, got none"*; keeping the grid but restoring only the absolute pill fails
  on *"tile 0: the Log control still overlaps the icon"*. The second control exists because the first
  never reaches the overlap assertion, which is the entry's headline defect.
- Rendered at 384 px dark and compared against the approved mockup: three even columns, icon, value,
  unit, then the `Log` pill — no overlap.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

## Two things the spec got wrong first, both of which would have passed while measuring nothing

1. **It skipped itself.** The first run found zero tiles on the seeded account and took the
   `test.skip(count === 0)` branch — reporting green having measured nothing. The tiles are now
   **pinned on** by the spec (`ta_ss_widgets`, plus `ta_home_section_order` and
   `ta_home_hidden_sections`, because `metricTiles` is a Home *section* as well as a set of widgets),
   and the skip is replaced by a hard assertion that tiles rendered.
2. **It measured a skeleton.** Even pinned on, the count was zero — `settleRouteBoundary` returns
   while Home is still painting placeholder blocks. The failure screenshot showed that plainly; the
   spec now waits for the first tile to be visible before measuring. **Reading the screenshot is what
   found it** — the count alone looked like a preference problem for the second time running.

## Not exercised

Not device-verified. The geometry was measured in Chromium at 384 px, which is the width the mockup
was approved at, but it is not a Samsung WebView — and the accepted trade (a fourth widget wrapping)
was not exercised, because the fixture pins three. No offline-first, native, safe-area, gesture or
notification surface is touched.
