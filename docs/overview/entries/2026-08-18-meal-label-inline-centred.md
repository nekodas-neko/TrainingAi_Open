# 2026-08-18 — Q-397: the label the owner actually asked for, and why it fits a round die

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.324.0** · **Lane:** Implementation B

Q-393 shipped yesterday and shipped the wrong design. Not because it was built badly — it was built
faithfully — but because **the entry carried an analysis the owner had already corrected in chat and
nobody wrote back into the queue.** Q-397 filed that, and this is the fix.

The owner spotted it immediately: *"I dont see the option we worked on for everything centered?"*

## The correction, which is a nice piece of reasoning

Q-393's heading says the ingredient list *"does not fit on a round one"*, and its measurement backs
that up: the round usable box is 130 × 137, the default already fills it, **7 units of slack, zero
ingredient lines**. All true — **for a stacked list**.

The owner's suggestion was to run the ingredients as **one wrapping line**. That spends *width*,
which the label has going spare, instead of *height*, which is the one thing the code also needs.
Five ingredients become **three wrapped lines rather than five**, and the height handed back goes to
the code.

So there was never a trade between the list, the round die and a readable code. Inline wrapping buys
all three. The complete list now fits a **round** label with a code **larger than the previous
default's**.

## What shipped

**`inlineCentred` — B2 — is the new `DEFAULT_MEAL_LABEL_STYLE`**, per the owner's decision in Q-397
(*"Yes have B2 as the default"*). Name, calories, macros, the full ingredient run, then the code —
all centred, round-safe.

| | code box | symbol | mm/module |
|---|---|---|---|
| old default (`band`, no list) | 12.2 mm | 9.2 mm | **0.369** |
| **new default (`inlineCentred`, full list)** | 17.5 mm | 13.2 mm | **0.529** |

It is not merely a nicer layout: it prints a **43% larger module** than the style it replaces *and*
carries the breakdown. Leaving it as an opt-in would have made the better default the one you had to
go and find, which is why Q-397 says to change the constant in the same PR.

The stacked square style stays in the picker for anyone who prefers that alignment on square stock,
and every other style is untouched — "keep them all as options" was the owner's ask.

## Guards, and the one that was worth the most

Q-397 asks for the code size to be **asserted**, because *"a number nobody asserts is a number that
drifts"* — and it had already drifted once. `meal-label-code-size.test.ts` now pins every style's
mm/module, and pins the claim the owner's decision rests on: **the default prints a bigger module
than the style it replaced.** If a later layout tweak reverses that, a test fails rather than a print
run.

`wrapIngredientRun` is pure and property-tested: never exceeds its line budget at any width, never
silently drops an ingredient (`shown + overflow === count`), and summarises rather than truncating a
name. One of those properties **found a real bug** in its sibling `fitIngredientLines` — with room
for a single line and two ingredients it drew one ingredient *plus* a "+N more", two lines in a
one-line space.

**The E2E spec now decodes the QR straight off the rendered canvas**, for every layout, using
zxing's pure-JS core in Node — the pixels come out of the page because `@zxing/browser` cannot be
imported into it and needs a DOM anyway. That proves the symbol is complete, unobstructed and
resolves to *this* meal at every style. It is the closest the sandbox can get to the print test.

**And it proved a guard I had written was worthless.** An earlier version of the centred layout ran
its ingredient list into the code. The decode still passed — because `drawCode` paints a white
quiet-zone box before its modules, so an overrun destroys the *ingredient text*, not the code. No
end-to-end check can see that. The arithmetic moved into a pure function with a property test, which
is where it belonged.

## What was NOT exercised

- **Nothing was printed.** Still the one gate that matters and still owed. The new default is more
  forgiving than the old one, which lowers the risk but does not discharge the check.
- **No round die has been cut.** "Round-safe" means every element composes inside the inscribed
  130 × 137 box, verified in the preview at true 50 mm scale — not against real stock.
- **The device.** Chromium at 412×915; the wrapped ingredient run sets at 7 px.
- **The stored default is still not stored** — `DEFAULT_MEAL_LABEL_STYLE` is a constant, and a
  per-user default remains blocked on Q-392, exactly as Q-397 says.
