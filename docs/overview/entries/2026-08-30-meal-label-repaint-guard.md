# 2026-08-30 — `fix/meal-label-style-repaint` (LB-19, second half) — a guard that could not fail

**Lane B · test-only.** One spec. LB-19 is closed and removed from the queue.

`meal-label.spec.ts` switches the label style ten times and decodes the QR off four of the resulting
canvases. Before each read it waited on `expect.poll(inkFraction).toBeGreaterThan(0.01)`.

**Every style clears that threshold.** Measured 2026-08-30 on the four decoded styles:

| style | ink fraction |
|---|---:|
| Ingredients · centred | 0.081 |
| Black band | 0.135 |
| Plaque | 0.093 |
| Big code | 0.175 |

So after the first style the canvas is *always* already over the line. The poll returns on its first
call, and the read that follows can land on the **previous** style's pixels. And because every style
encodes the same meal, a stale image decodes to the right token — the test agrees with itself while
proving nothing about the style it just selected.

## Proven both ways

Removing `style` from the render effect's dep array in `meal-label-sheet.tsx` makes the canvas never
repaint on a style change. Under that mutation:

- the **old** guard **passes 3 of 3**, claiming every style renders and its code decodes;
- the **new** guard fails with *"Black band should repaint the canvas — if its ink fraction equals
  the previous style's (0.07901), this metric cannot tell the two apart"*.

That is the whole claim, and it is why the counterfactual run was worth the four minutes: a guard is
only worth what it fails on.

## What changed

`selectStyle(style)` reads the current ink, clicks, then waits for the fraction to **change** —
which is what proves the repaint happened. A style that is already selected repaints nothing, so
that case returns without waiting, which is why it reads `aria-checked` rather than clicking blind.

If two styles ever paint the same fraction it **times out rather than passing silently**, and the
message says so: equal ink means the metric cannot separate them, and the answer is a richer
signature, not a longer timeout.

## What this does not claim

**The original null decode was never reproduced.** It was seen once in a whole-file run on
2026-08-30 and has passed every run since — alone, and as a file, several times. This is a guard
strengthening, not a proven cause. If it recurs, the failure now lands at the *style change* rather
than at the decode, which is a narrower place to start.

## The class, which is what LB-19 was really about

Both of its specs failed the same way underneath, and neither was the "sandbox time budget" the entry
recorded:

**A precondition satisfied by the state it is supposed to be replacing cannot fail.**
`inkFraction > 0.01` was true of the canvas it was waiting to see overwritten. `goal-invalidation`'s
seed check was true of a `max(date)` that was not today. In both cases the test kept running and
failed somewhere less informative — at a decode, at a locator — which is why both were attributed to
timing.

## Not exercised

- No product code changed. The `meal-label-sheet.tsx` edit was a mutation, reverted; `git status`
  shows only the spec.
- The style→ink mapping is measured on this seed's meal. A different meal shifts the values but not
  their distinctness, which is the property the guard needs.
