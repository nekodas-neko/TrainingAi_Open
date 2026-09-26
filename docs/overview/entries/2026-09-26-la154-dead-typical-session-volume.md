# 2026-09-26 — LA-154: the dead volume input, and three stale comments behind it

**Branch:** `fix/la154-dead-typical-session-volume` · **Lane A** · closes `LA-154`.

`Q-190` replaced the activity score's volume target — it used to be
`typicalSessionVolumeKg × strengthFreqGoal`, the median of the user's *own* sessions, which meant
training harder raised the target and the score stayed put. It became an absolute
`sessionVolumeGoalKg × strengthFreqGoal`. The median input stayed behind.

## The entry I filed for this was wrong about scope

`LA-151` filed `LA-154` saying to remove the field everywhere, with "the score audit no longer
prints a row for it" as the done-when. That would have deleted something deliberate: the audit row
exists, is rendered, and is correctly labelled *"Reported for context only — Q-190 took the volume
lane off it"*. The field's own docstring said as much — **"Kept because the audit view displays
it."** So the thing `LA-151` announced as a discovery was already written at the declaration.

What was actually dead, checked surface by surface:

| surface | verdict |
|---|---|
| `ActivityScoreInput.typicalSessionVolumeKg` | **dead** — the scoring function never reads it, so four call sites passed a value only because the type demanded it |
| `activitySignals.typicalSessionVolumeKg` (readiness payload) | **dead** — written into the payload, read by no UI |
| the score-audit row | **alive** — rendered, and its note is accurate. Kept |

## What that uncovered

Removing the field made `load` — an entire `computeVolumeAcwr` call — dead in
`app/api/ai/health-insight/route.ts`. It existed solely to supply the median, so every request to
that route was computing an ACWR nothing used.

That in turn exposed a comment crediting the route's 28-day session fetch to the ACWR helper
(Q-512), which the route no longer calls. **The fetch has to stay wide anyway, for a different
reason the comment never gave:** the 7-day filter below it is anchored on the *requested* `date`,
which the body may set to any past day, while the fetch counts back from now. Narrowing it to 7
would silently drop sessions for any past-dated request. The comment now says that.

**And `Q-137`'s test comments had been wrong for six weeks.** They computed the volume target as
`4,700 × 3 = 14,100` and `4,700 × 5 = 23,500` from `typicalSessionVolumeKg × strengthFreqGoal` —
the formula Q-190 removed on 2026-08-11. The real targets are `5,000 × 3 = 15,000` and
`5,000 × 5 = 25,000`. Every assertion was right the whole time and the arithmetic printed beside
it was not, which is the hard kind of stale comment: nothing fails, so nothing draws attention.

`Q-190`'s own regression case — three different personal medians against one training week,
asserting the score does not move — **can no longer be written**, because the input is gone. That
is a stronger guarantee than the test was, and the file says so where the case used to be. What
replaced it is the positive half that still has teeth: the target responds to the *goal*.

## Verification

- Full suite green; lint **831**, exactly baseline; `check-test-typecheck` at baseline; Custom
  Rules **80 of 80**. No version bump — nothing user-visible changed.
- Mutation pass on `volumeTargetKg`: pinning the target to a constant killed 3, freezing
  `strengthFreqGoal` killed 4.
- **My first control was not equivalent and killed a test**, which is worth recording rather than
  quietly replacing: relaxing `Math.max(x, 1)` to `Math.max(x, 0.5)` looked like a no-op on goals
  that are never below 1, but a test asserts `volumeTargetKg({0, 0}) === 1` directly — the floors
  are the contract, not defensive padding. The real control, commuting the multiplication,
  survived.

**Not exercised:** the score-audit and Activity screens were not rendered. The change is a type
narrowing plus the removal of an unread payload field, so there is nothing for them to show
differently — but the audit row's continued presence was confirmed by reading `activity.ts`, not
by looking at the console.
