# 2026-09-01 — the pill that wrapped, and the marker nothing read

**Branch:** `fix/header-chip-and-swipe-marker` · **Entries:** BF-96, BF-95 · **Lane:** B · **Version:** v1.418.3

Two one-change fixes in the same layer, batched because each is a line and neither can be finished
without the device.

## BF-96 — nothing moved the chip; it was wrapping

Owner, with a Home screenshot: *"I dont like how the temperature/uV pill sits. can we go back to the
old way when it was side by side. you can make it smaller if needed."*

**It was already side by side.** The chip's root is `flex items-center gap-1` rendering `21° · UV 5`
inline; what the screenshot shows is `UV 5` breaking at its own space so `5` drops under `UV` and the
pill goes two lines tall.

**The cause is an asymmetry with its sibling.** The header row holds exactly two items, and the date
carries `whitespace-nowrap shrink-0` while the chip carried neither — so the chip was the only
compressible item and absorbed 100% of any shortfall. The fix is the two classes its sibling already
had: the sibling-surface rule, where a row had decided how items behave under pressure and one of
the two was never told.

**Why it looked fine before — and a correction to the entry's own figure.** `EEEE d MMMM` varies
across the year, and the entry put the range at 12–20 characters. **Measured against a real render
at the worst case, it is 12–22**: *"Wednesday 30 September"* is 22, and *"Friday 1 May"* is 12. So
there are up to ten characters of variance and *"the old way"* the owner remembers is the same code
on a shorter date. That is also why nudging the symptom would have brought it back on its own
schedule.

**On *"you can make it smaller if needed"* — not needed, and size is the wrong lever.** Wrapping is a
`white-space` problem, not a width shortage. If the longest dates still overflow on the device, the
entry's guidance is to shorten the **date** (`EEE d MMMM`, −4 chars) rather than the chip: the date
is partly recoverable from the phone's own UI; the temperature and UV are not.

## BF-95 — a declared contract that nothing honoured

`components/ui/swipe-actions.tsx` sets `data-swipe-actions` on every row, with a comment stating
exactly what it is for — *"marks the row as owning horizontal gestures that start on it, the way
`data-swipe-carousel` already marks a carousel."* The tab navigator's exclusion list did not contain
it. **The marker was set and never read.**

It has not bitten because the navigator only arms a tab swipe within 24 px of a screen edge, so it
takes a swipe-to-delete begun in that strip to run both gestures from one touch. Meal rows are
full-width, so the strip is reachable: latent, not impossible, and exactly the failure the marker was
added to prevent. The fix is one selector.

**The guard asserts the pairing from both ends**, because the entry warns against the opposite
"fix" — deleting the marker as unused. Removing it would make the next swipe surface re-derive the
whole problem, so a test that only checked the navigator would have called that a pass.

## Verification

- **Four source guards, five mutations, all killed**: the navigator dropping the marker again, the
  primitive ceasing to declare it (the wrong fix), and the chip losing either class, plus a carousel
  marker falling out of the list.
- **One guard could not fail as first written** — it located the chip root by
  `rounded-full bg-muted/60`, which also matches the loading skeleton five lines above: a fixed
  `h-[26px] w-14` box that cannot wrap. It now requires `flex items-center gap-1` too.
- `pnpm check:rules` — **Ran 67 of 67**. `tsc`, `pnpm lint`, backlog-pointers, doc-size and
  doc-links all exit 0, each read by exit code.

**Not exercised: the chip rendering.** The seeded sandbox has no weather snapshot, so `WeatherChip`
never reaches its content root — only the skeleton renders, and the wrap cannot be reproduced or
disproved here. What *was* measured on a real render is the sibling: the date reads
*"Wednesday 30 September"* at the forced worst-case date, which is the pressure that causes the wrap.

**Not exercised: the swipe.** The navigator listens on `document` and the web sandbox does not
reproduce the WebView's touch behaviour. Both entries carry `Verify: device`; BF-95's check is a
swipe-to-delete begun at the far left edge of a meal row, which must open the tray and not change
tab.
