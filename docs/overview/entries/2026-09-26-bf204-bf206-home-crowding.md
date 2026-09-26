# The pen was crowded by construction, and the Coach button sat on the last row of Home

Implementation Lane B, 2026-09-26. `BF-204` and `BF-206`, both from the owner's own screenshot of
Home, shipped together because they need one look at one screen.

## BF-204 — three mechanisms, each of which guarantees crowding

The owner, on his first real use of the collection: *"Its a bit cramped in there. Might be too many
at once."*

**It was not the hash clustering them.** `penCats` sorted `b.tier - a.tier` and sliced twelve, so
the drawn set was always the twelve **largest** — and his collection is ≈ 22 cats of which ≈ 13 are
top-tier, so "all one tier" was the normal case rather than bad luck. A tier is a 12 px `BAND`
interval, so the depth-by-tier design that is meant to separate them did nothing and they landed on
one line. On top of that, `348 / 12 = 29 px` slots against 34–50 px sprites overlap by ~13 px
*before* the ±115 px wander, and twelve `whitespace-nowrap` tags came to ~456 px against 348.

Fixed, in the order the entry ranked them:

- **① The selection round-robins from the rarest tier down** instead of sorting and slicing. The
  rare cats are still led with — that is what the sort was for — but the drawn set spans several
  bands, which is what spreads them vertically.
- **② `MAX_SHOWN` is a ceiling, not the count.** `shownForWidth` reads the pen's own
  `ResizeObserver`: **six at 348 px**, from 56 px slots.
- **③ `tagsForWidth` draws three tags** at that width, rarest first, rather than twelve.
- **④ deliberately not done.** Stretching the bands into the empty sky is work PS-49 undoes when
  six tiers make bands 3–5 and the flyers reachable.

Rendered at 412 px dark against a stubbed collection of the owner's shape: six cats across three
sizes, nothing occluded, no clipped names.

## BF-206 — the reserved space was one control short, exactly

Home's scroll used `pb-nav-safe`, which reserves the nav bar and a gutter. The FAB is
`bottom-fab-safe` and `h-14`, so its top edge sits **56 px above everything that padding
reserved** — and the bottom 56 px of the scroll, on the right, could never be scrolled clear of it.
On the owner's screenshot that was the day timeline's last row.

`.pb-fab-safe` is the same calculation plus the button's own `3.5rem`, and Home uses it. **The
guard is the part worth keeping:** every file rendering `<CoachFab` must also carry `pb-fab-safe`,
because the failure arrives by omission — the next screen to mount a FAB will reach for
`pb-nav-safe` like every other screen, and nothing will look wrong until something lands under the
button.

The second half was the owner asking what *"that button on the widget, the white circle"* was. A
sparkle is this app's generic AI mark — the weekly-recap banner, the meal-source row and the
profile tab all use it — so it names a category, not a destination, and an `aria-label` is not an
answer to someone looking at it. It is an extended FAB now: the icon with a **Coach** label beside
it. The alternative, a one-time tooltip, teaches only the person who does not dismiss it.

**Checked and not changed: the colour.** `bg-foreground text-background` reads as a stark white
circle in the dark theme, but it is the repo's standard filled-control treatment, and changing it
here alone would make this control the odd one out.

## Failure surfaces not exercised

The S25, for both. BF-204's pass/fail is explicitly a Samsung WebView one — *no name clipped by a
neighbour, and no cat fully hidden behind another* — and the cats wander, so a screenshot at one
instant is weaker evidence than a look. The sandbox render is the before/after, not the verdict.

## Verification run here

`pnpm lint` 0 errors / 828 warnings (unchanged against the base) · `pnpm check:rules` Ran 80 of 80 ·
`pnpm test` · `pnpm build` · `tsc --noEmit` · `check-test-typecheck` none above baseline. Six new
unit tests on the pen's selection and sizing, four on the FAB. Control run: reverting Home to
`pb-nav-safe` fails the clearance scan. Both surfaces rendered at 412 px dark and looked at.
