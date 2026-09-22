# RV-84 + RV-88 — error states that could never fire

**Branch:** `fix/rv84-rv88-error-state-onerror` · **Lane B** · batch `error-state-onerror` · no version bump

## The rule

`cachedFetchCore` wraps its whole network section in `try/catch/finally` and resolves a **boolean**:
a `!res.ok` returns after calling `onError`, a network throw is caught. **The promise cannot
reject.** So `.catch(() => setFailed(true))` chained onto `cachedFetch` is dead code and the state
is never set. `onError` is the only channel that fires.

## RV-84's count was wrong three ways, and the real shape is narrower

The entry said **16 sites**. Measured with balanced-paren matching rather than a grep — two naive
greps disagreed at 8 and 59, which is what prompted counting properly:

| | count |
|---|---:|
| chained `.catch` on `cachedFetch`/`cachedFetchToday` | **81** |
| `.catch(() => {})` — dead but harmless | 68 |
| redundant — `onError` already wired beside it | 4 |
| **broken — a handler, no `onError`** | **9** |

The four "redundant" include `health/oura-section.tsx`, which the entry names as **its own
reference for the correct pattern** — it has `onError` wired and a belt-and-braces `.catch` beside
it. So a site is only broken when it has a handler *and* no `onError`, which is the distinction the
entry's count missed.

Both consequences the entry confirmed — the Coach picker stuck on *"Loading your options…"* and the
Profile achievements grid spinning — are in the nine. Its diagnosis was right; only its arithmetic
was not.

**The nine, all moved to `onError`:** `week-day-sheet`, `coach/choice-list`,
`fitness-tests/latest-baseline-card`, `more/details/performance-overview-section`,
`more/profile-tab`, `nutrition/my-meals-picker`, `nutrition/recent-foods-panel`,
`nutrition/reta/weight-response-card`, `workout/exercise-stats-sheet`.

**The 68 no-ops are deliberately left.** A `.catch(() => {})` satisfies a floating-promise lint and
hides nothing. Sweeping them would be 68 files of churn for no behaviour change; they are frozen
shrink-only instead, because a *new* one is a fair signal that somebody still believes this promise
can reject.

## RV-88

**Cardio Trends** rendered `!data ? <pulsing block>` with no `onError`, so a 429 left a grey
skeleton that never resolved under three tab buttons that changed nothing. **Time in Zone** took its
*empty* branch and printed *"wear the ring or strap during a workout"* — blaming the owner for a
server failure on a day he had worn it. Both now distinguish failure from empty.

## RV-88's second defect is not one, in this file

The entry flags `const profile = data?.profile ?? { maxHr: 190, restingHr: 60 }` as an invented
number shown as fact. **Checked, and it does not reach the screen here.** `computeHrZones` takes
`id`, `name` and `color` straight from the fixed `ZONE_DEFS`; only `minBpm`/`maxBpm` vary with the
profile. This card renders `z.id`, `z.name` and `z.color` in its legend and takes the minutes
themselves from the server's `data.days`, so the fabricated 190/60 changes nothing visible.

A first pass at "fixing" it produced `data ? (data.profile ?? d) : d` — **identical to the original**
and carrying a comment claiming a fix. That is the shape the repo's own rule warns about, so it was
reverted and the reasoning written next to the line instead, to stop the next sweep re-filing it.
**The entry's reasoning is right in general** — it would be a real defect in any card that prints a
zone's bpm range.

## Testing

`rv84-catch-on-cachedfetch-is-dead.test.ts`, structural for the same reason RV-64's was: no React
render harness, and the property is "which call may do this". Two assertions, both mutation-checked
— reverting one site to `.catch` fails the first by name and file; adding a new `.catch(() => {})`
fails the frozen count at 69 against 68.

## Not exercised

**No device pass**, and no e2e for the two RV-88 cards. One was written for Time in Zone against the
established 429-routing idiom in `card-429-error-state.spec.ts` and **removed rather than
weakened**: the card is a configurable Health section and is not in the seeded user's saved set, so
the anchor never appeared. Reaching it needs a section-preference fixture like `enableHomeCards`,
which does not exist yet. The other seven cases in that file still pass.

So the nine fixes are covered structurally and by type, not by a rendered failure. What a failed
fetch *looks like* on each of those nine surfaces is unverified.

## No version bump

Error states that could never fire now can. Nothing else about what the app shows has changed.
