# 2026-09-26 — the white circle was the moon, and BF-206 was filed against the wrong button (BF-208 / BF-209, correcting BF-206)

The owner pointed at a white circle on the Home collection card. I traced it to the AI Coach
floating button and filed `BF-206` against that. He corrected it: *"No not the ai coach white
button; its the one on the collection widget."*

## What it actually is

`public/cats/scene-meadow.svg`, line one of the sky:

```
<circle cx="300" cy="36" r="14" fill="#f3ecd2"/>
```

**The moon.** A 28 px solid near-white disc on a `#16203a → #2a3a5c` sky, rendering almost 1:1 into
the ~348 px pen, in the upper-right corner. Decoration drawn as a control: highest contrast in the
card, hard-edged circle, corner position.

**The worse half is 30 px to its left.** `+12 more` is styled `rounded-full bg-background/70 px-1.5`
— a pill — and is a plain `<span>` inside an `aria-hidden` div. It reads as "tap to see the other
twelve" and does nothing. The card's own link does eventually show them, by accident. So the corner
holds two button-shaped things and neither is a button.

## The correction to BF-206

Finding ① — Home reserves nav height but not the 56 px FAB above it — was measured from the CSS, so
it stands on its own and the entry keeps it.

**Finding ② was struck.** "Nothing identifies this button" was an unreported design opinion that
existed only because the misread made it look like the owner's complaint. Intake does not file
restyles of working controls that nobody mentioned. The entry now says so in place rather than
quietly dropping it.

The lesson, and it is the second time this session: a report that names a thing vaguely ("that
button", "the white circle") needs the *thing* identified before the trace starts. I had two white
circles on one screenshot and picked the one I had already found.

## BF-209 — the rest of the screen

He also sent `/collection` and said both screens were not good. Measured at 412 dp:

- The tier row is `justify-around` with three 48 px sprites in a 348 px card — **144 px of content,
  204 px of gap, 59 % blank**.
- Nothing in that row says the three tiers turn into each other. No arrow, no cost, on a screen
  whose whole subject is merging.
- `SHOWN = 20` per ladder: **~1,770 px today (2.2 viewports), ~3,000 px at the cap (3.7)**.
- The roster's second line names cats that no longer exist — `settle()` does
  `held[i].splice(0, cost)`, so "from Beanger, Wag, Junky +1" is four names with no referent.

**One suspicion checked and dropped:** the 10 px type looked like the problem. `text-[10px]` appears
**586 times** across the app — it is the house caption size, not an outlier. The density complaint
stands on row count, not type size.

Filed `Lane: O` beside `BF-207`, with a note to answer both together: one screenshot, one screen,
and splitting it would redesign the page twice.

## Not exercised

Docs-only; nothing ran. BF-208 owes a device look at the real width in dark theme.
