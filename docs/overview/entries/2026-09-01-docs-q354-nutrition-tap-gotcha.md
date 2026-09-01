# 2026-09-01 — Q-354: the e2e README said the opposite of what was measured

**Branch:** `docs/q354-correct-the-nutrition-tap-gotcha` · **Domain:** `app-shell` / `platform` · **Lane:** B · **No version bump** (docs and comments only)

## Why this was the right thing to do with Q-354

It headed Lane B's READY list, and its own text says **"Recommendation: do not pursue without a
reason"** — touch is the only input the canonical runtime has, touch works, and a rewrite risks it.
An entry that argues against itself sitting at the head of the queue is offered to every session in
turn, which is how it got skipped repeatedly rather than resolved.

So it is now a **`Reference:`** entry: read, not built. `next-item.js` prints it in its own section
and it no longer heads the work list. Lane B's READY count went 7 → 6, and nothing was lost.

## The stale claim, which was worse than a gap

The entry names its real cost precisely: *"a trap for the next spec author"*, and *"the failure gives
no clue"*. So the useful work is signposting, and the signpost was **pointing the wrong way**.

`e2e/README.md` read: *"On Nutrition a real touch sequence does not open the water sheet while a
synthesised `click` event does."* That is Q-309's suspicion, written before anyone measured. It was
measured the same week, in `water-log-write-path.spec.ts`, and came out **reversed**:

| Input | Water sheet |
|---|---|
| `.click()` | never opens |
| `touchscreen.tap()` | opens, first time, every time |
| `dispatchEvent('click')` | opens — the old workaround |

The README was never updated. Someone hitting a dead tap on Nutrition, consulting the file written to
save them from exactly that, would conclude **touch** was broken and reach for
`dispatchEvent('click')` — the workaround that spec deliberately moved away from. A wrong signpost
costs more than no signpost, because it is followed.

Rewritten with the measured direction, the proven cause (the date-swipe `useDrag`; removing
`{...bindDateSwipe()}` makes every input work, and `pointer: { touch: true, mouse: false }` does
not), why it is deliberately unfixed, and the two specs carrying the reasoning inline. The
hydration-race case it used to be conflated with is now its own bullet, with the idempotence caveat
that spec learned the hard way.

## And the spec's own conclusion was superseded

`water-log-write-path.spec.ts` concluded *"the gesture code is not implicated: the failing case never
produces a touch event for `filterTaps` to filter."* That reasoning covers the **touch** path, and
`useDrag` binds mouse and pointer too — which is the path that breaks. Q-354 proved it by removing
the binding.

So Q-309 named the right component by the wrong mechanism, and this note then *cleared* that
component on reasoning that only covered half the binding. Both halves are corrected in place.

## Verification

Nothing executable changed — the diff is one markdown file, one comment block, and a backlog field.
`tsc` clean, `pnpm check:rules` **Ran 67 of 67**, and `next-item.js --lane B` no longer offers Q-354
as work.

## Not exercised

Nothing runtime. This changes no behaviour on any surface, device or otherwise.
