# 2026-09-28 — RV-208 ③: the movement categories stop borrowing session colours

**Lane B.** Branch `fix/movement-balance-palette-clash`. v1.480.1.

## The defect, and it was worse than the entry said

Health → Training's calendar and load legend colour sessions by **position** (`SESSION_PALETTE`,
`packages/shared/src/session-palette.ts`), so "Pull is green" is the owner's session *order*, not a
name map. Two cards down, Movement Balance coloured the same three words from its own map — and two
of the three were session colours outright:

| row | token | nearest session hue |
|---|---|---|
| `legs` | `--accent-green` | session green, **0°** |
| `pull` | `--accent-purple` | session purple **10°**, session indigo **20°** |
| `push` | `--accent-cyan` | session blue, 45° |

The entry recorded the collision; the `20°` to indigo it did not. So the same three words carried two
colour maps within a thumb's scroll — and for the owner's stated order, *transposed* rather than
merely different.

## Why "add two new hues" was not available

The entry's proposed fix was *"adding two to `app/globals.css` with contrast checked there"*. That
assumes two comfortable hues exist. **Scanned rather than judged** — a category hue must clear
**two** systems, `SESSION_PALETTE`'s six Tailwind hues (red ≈27°, amber ≈70°, green ≈145°, blue
≈255°, indigo ≈275°, purple ≈305°) *and* this app's four `--accent-*` tokens. Nine constraints on a
360° wheel:

- at **40°** separation the only free band is **~345–347°** — room for **one** hue, not two;
- at **35°** — `340–352` plus slivers at `105–110` and `180–220`;
- at **30°** a three-hue set exists (≈115 / 177 / 346), but `115` sits wedged *exactly* 30° between
  amber and green.

There is no good four-colour answer while sessions own six hues by position.

## So the colour stopped carrying the identity

It never had to. Every row already renders `PATTERN_LABEL[row.pattern]` beside its own bar, stacked
and individually labelled — hue was **redundant encoding**. One accent for all three:

- cannot collide with a session colour, by construction;
- stays correct when the owner reorders his sessions, which the old map could not;
- spends none of the thin free hue space.

**`other` stays muted, and nothing is green or red.** These are four categories, not a scale. A
lightness ramp was considered and rejected for the same reason the card's own comment gives for not
colouring push green: it would imply an ordering this card deliberately refuses to assert.

## Verified

- **`components/health/__tests__/rv208-movement-category-hues.test.ts`** — 4 tests asserting the
  **arithmetic**, not the literals: it parses the `--accent-*` hues out of `app/globals.css` (both
  themes) and the tokens out of the card's own `PATTERN_COLOR`, then requires ≥25° from every
  `SESSION_PALETTE` hue. It also fails a raw Tailwind session colour name, and any `accent-green` /
  `accent-red` / `destructive` in that block. A first assertion guards the parse itself, so the test
  cannot pass by matching nothing.
- **Control-run three ways, each mutation asserted as applied:** the palette exactly as it was on
  `main` → *"accent-purple (295°) is 20° from session indigo (275°)"* and *"accent-green implies a
  verdict this card does not make"*; only the subtler `pull` half restored → the 20° failure alone;
  a raw `bg-indigo-500` → *"PATTERN_COLOR uses the session colour "indigo" directly"*.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean · `check-contrast` unchanged (no token added).

## Also done: a Lane A item that was invisible

`RV-208` ① had been marked *"NOT Lane B"* in prose and left sitting inside a `Lane: B` entry — so
Lane A was never going to see it, because **the lane field is what routes work**. It is now
**`LB-183`** (`Lane: A`): the fourth live time-of-day form (`formatTime12h` → `6:40am` against
`formatTimeOfDay`'s `6:40 am`, one character in `packages/shared`), plus the two minutes-of-day
formatters that need a new shared helper before Lane B can convert their call sites.

## What is left on RV-208

② shipped but **owes a render** — the seeded account has no weights on any of the eight load
surfaces, so the added space was never seen at 412 px; the residual risk is a wrap in two tight
cells, not a wrong value. ④ dates and ⑤ brand-in-food-name are **copy decisions** and remain
untouched. With ① moved out and ③ shipped, nothing buildable by this lane remains.

## Not exercised

Not device-verified. The card was not rendered on the seeded account either: it needs logged
workouts across push/pull/legs in the window, which that account does not have, so **the change was
verified by the hue arithmetic and by source, not by looking at it**. The risk that carries is
aesthetic, not functional — three bars now share a hue and are told apart by their labels — and it
is the kind a device pass or the owner's eye settles. No offline-first, native, safe-area, gesture or
notification surface is touched.
