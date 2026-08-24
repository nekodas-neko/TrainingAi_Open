# Q-387 was finished two PRs ago and still headed the queue

**Branch:** `docs/retire-shipped-q387` · **Lane B** · docs only

## Why

`node scripts/next-item.js --lane B` offered **Q-387** as the top READY item. Its body lists what
Lane B still owed:

> the *"Complete Today's Logging"* button as the last element in the day's scroll, the copy beneath
> it, the receipt-with-Undo it becomes, and the **"N of 10 days" counter shipped with it, not
> after**

Every one of those is on `main`, and has been since #330:

| Owed | Where it is |
|---|---|
| The button | `components/nutrition/food-logging-complete.tsx` — *"I've finished logging"* |
| The copy | same file, *"Finished logging for today?"* |
| The receipt with Undo | same file, an **Undo** control posting `complete: false` |
| The N-of-10 counter | same file — `{daysLogged} of {minDays} days marked · {remaining} more to calibrate your maintenance` |
| Rendered in the day's scroll | `app/nutrition/nutrition-content.tsx`, `<FoodLoggingComplete …>` |

The entry was left in the queue when its Lane B half merged, so it sat at the top of the list
claiming work that did not exist.

## One requirement was deliberately superseded, and that is worth recording

Q-387 asked for the button *"as the last element in the day's scroll (not the header, not beside the
ring)"*, and it shipped exactly there. **BF-6 then moved it** (v1.344.0) to directly under the meals,
with End of Day last — because at the foot it took **zero presses in seven weeks**, and the
calibration it feeds excludes an unmarked day rather than treating it as light, so a control nobody
reached withheld the whole feature.

So the entry is not simply "done": one of its stated requirements was reversed on evidence. Deleting
it silently would lose that, which is why the cross-reference that pointed at it now says where the
placement decision actually lives.

## What changed

- The Q-387 entry is removed from `docs/implementation-backlog.md`.
- Its two stale cross-references are corrected — the one in the nutrition block's "achievable today"
  note, and the one in section 10 that still described the button as sitting at the foot of the log.
- Two other references (sections on the calibration gates) are factual statements about the
  `finished logging` flag and remain true, so they are untouched.

## Verification

`pnpm check:rules` — Ran 55 of 55. `next-item.js --lane B` now heads with LB-7.

## Not exercised

Docs only. The shipped behaviour was confirmed by reading `main` and was not re-run; it has its own
journal entries from #330 and #355, and Q-387's device verification is owed there, not here.
