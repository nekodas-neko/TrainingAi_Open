# 2026-09-18 — RV-52/53/54: three cache keys that no write evicted

**Branch:** `lane-a/rv52-54-cache-eviction-gaps` · **Lane A** · batch `cache-eviction-gaps-sweep50` · one PR · no migration · unversioned

## What shipped

Three registrations in `lib/cache-groups.ts`, all verified against `main` before writing:

| key | groups before | groups now | argument |
|---|---|---|---|
| `weekly-review-month-window:` | **0** | 3 | its sibling `day-review-week-window:` was in 3 |
| `stress-day:` | **0** | 4 | `body-battery`, rendered by the same card, was in 4 |
| `collection` | not in `invalidatePrescriptionChanged` | added | that route computes its answer from the deload this group fans out |

RV-54 is the sharpest because the dependency is written out in the route:
`app/api/collection/route.ts` computes `pausedDays = [...restDays, ...earlyDeloadWeekDays(program)]`,
and `handleEarlyDeloadConfirm` (`session-select-content.tsx:887`) calls **only**
`invalidatePrescriptionChanged()`. Verified both ends rather than taking the entry's word.

For RV-52 and RV-53 the sibling is the whole argument: nothing distinguishes the two payloads' write
sensitivity, and one was registered while the other was not.

## A claim of mine that was wrong, corrected before it shipped

My first version of the RV-54 comment said the gap meant *"the collection ladder kept decaying
across a week the lifter had just marked as a deload."* That overstates it, and Q-262 exists exactly
to stop this being assumed.

Checked: both readers — `components/home/collection-card.tsx` and
`app/collection/collection-content.tsx` — use `useCachedValue` with **no `freshWithinTtl`**, and
neither is seed-only. `cachedFetchCore` always revalidates, so an unregistered key can only settle
stale in those two cases. **The real symptom was a briefly-stale first paint, not a week of decay.**

The registration still ships, for the reason Q-262 gives itself: a key that is inert today becomes
load-bearing the moment someone adds `freshWithinTtl` to a card reading a deload-sensitive number,
and that is not a change anyone would think to check this against. RV-52 and RV-53 carried the same
caveat in their own text and it holds for them too.

That is the difference between *registering a key because the rule says so* and *claiming a bug that
was not happening.* Both keys get registered either way; only one of those is honest in a comment.

## Verification

`lib/__tests__/cache-groups.test.ts`, **39 passing** (was 36). Against unregistered `cache-groups.ts`,
**exactly the three new cases fail** and the guard passes:

| case | unfixed |
|---|---|
| `invalidatePrescriptionChanged` clears `collection` | **fails** |
| `weekly-review-month-window:` is evicted wherever `day-review-week-window:` is | **fails** |
| `stress-day:` is evicted wherever `body-battery` is | **fails** |
| an unrelated group (`invalidateFriends`) gains neither key (**over-eviction guard**) | passes |

The two sibling cases assert a **pairing**, not a list of group names — the property that must hold
is that the keys travel together, which is what was untrue. A list of names would go stale the first
time a group is renamed or a fourth writer is added, and would then have to be edited to stay green,
which is the signal that a test is describing the code rather than constraining it.

RV-54 is asserted with **no session id**, because that is how the deload path calls it — the same
detail RV-49 turned on.

Gates: Custom Rules **75 of 75** · `tsc --noEmit` clean · `check-test-typecheck` none above baseline.

## Not exercised

- **The S25 device.** Client cache code, delivered through a Railway deploy with no APK — but the
  eviction runs in the WebView and nobody has watched a card repaint on the phone.
- **The live repaint.** The tests assert which keys a group evicts, not that a screen re-renders;
  those are different things, and the distinction is the one Q-402 was filed about.
- **Whether any of the three is load-bearing in practice** — checked for `collection` (it is not);
  RV-52 and RV-53 were left unchecked on that axis, as their own entries said.
