# The meal-label style gate was reading the previous style, every iteration (LB-19)

**Branch:** `fix/meal-label-repaint-signal` · **Lane B**

## What it looked like, and what it was

`meal-label.spec.ts` failed about one run in five with *"Ingredients · centred's code must decode off
the rendered label"* — a zxing decode returning null — and passed on a re-run. It had been filed as a
timeout, then re-filed as a repaint race. It is the second, and it is worse than intermittent.

The gate after clicking a style radio was:

```ts
await expect.poll(inkFraction, { timeout: 20_000 }).toBeGreaterThan(0.01)
```

The canvas already carries the **previous** style's ink at that moment. So the condition is true
before anything repaints — **a precondition satisfied by the state it is meant to replace cannot
fail.** The same shape as `goal-invalidation.spec.ts`'s seed assumption, which is the other half of
this entry, and the third instance of it this week.

## The measurement

Ink fraction at the instant the old gate released, against what it settled to:

| style | at gate | settled | previous style's settled |
|---|---|---|---|
| Ingredients · centred | 0.092238 | 0.080699 | 0.092238 |
| Black band | 0.080699 | 0.134665 | 0.080699 |
| Plaque | 0.134665 | 0.092238 | 0.134665 |
| Big code | 0.092238 | 0.174037 | 0.092238 |

`at gate` is the **previous** style's settled value, four times out of four. The decode loop was
decoding the previous style's label on every iteration — and passing, because **every style encodes
the same meal**, so the token matched regardless. The layout check that loop exists for had
effectively never run for three of its four styles. The null decode was the same defect on the runs
where the read landed mid-draw instead of on a complete stale frame.

## The fix, and why one signal is not enough

`selectStyle()` waits on two things.

The **`mm at N×N modules` line** the sheet reports is derived from the style, so it says the sheet has
switched. Probed: all six distinct — centred 18.5, black band 16.4, editorial 16.9, deli 17.7, plaque
20.9, big code 20.1. Its poll message names the previous style's figure, so a future style that
collides reports *"this signal cannot tell the two apart"* rather than hanging for twenty seconds.

**Then the ink must settle** — two identical consecutive reads. The sheet's text can update a frame
before the draw, and a repaint passes through a cleared canvas, so "ink changed" on its own can fire
on a blank one. Only a settled canvas says the paint is finished.

With the fix, `at gate` equals `settled` and equals that style's own value, four times out of four.

**Canvas dimensions were the other candidate the entry named, and they are not usable:** probed the
same day, every style renders **1179×1179**. Recorded so nobody measures it again.

## What was not achieved

**A deterministic reproduction of the original null decode.** Holding the previous paint for 900 ms
made the old gate read the stale canvas — that is how the table above was produced — but the decode
still **passed**, because a stale frame is a complete, valid label for the same meal. Clearing the
canvas early did not defeat the old gate either: it correctly waits out a blank one. The null variant
needs a read landing mid-draw, and that window would not open on demand. So the fix is justified by
what the old gate demonstrably *read*, not by a reproduction of the symptom that was reported.

Nothing the loop checks was weakened. It remains the closest the sandbox gets to the print test still
owed; it now runs against the style it names.

## Verification

`e2e/meal-label.spec.ts` — **5 passed, twice consecutively**, 4.3 min each. Typecheck and lint clean.
`pnpm check:rules` — Ran 62 of 62.

**Not exercised:** the printed label. Everything here is canvas pixels in a headless browser; ink
spread on paper is the check this spec explicitly cannot make, and it is still owed.
