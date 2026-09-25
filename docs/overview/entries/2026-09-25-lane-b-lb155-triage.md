# 2026-09-25 — LB-155: "~20 conversions remain" was three, and the triage is the deliverable

Lane B, v1.465.60. `components/activity/done-activity-screen.tsx`,
`components/nutrition/meal-plan-setup-sheet.tsx`, `scripts/check-bare-api-fetch.js` and its test,
plus `LB-156` filed for Lane A.

## Why the entry had been sitting at the top of the lane

`LB-155` shipped the *enforcement* of the bare-`fetch` rule and left "~20 conversions remain". Read
site by site rather than counted, the 24 tracked sites split four ways — and only three of them were
Lane B's to do:

| | sites | |
|---|---|---|
| **converted here** | **3** | the key was already in an invalidation group |
| **authoritative reads** | 3 | a conversion would **break** them; now a third scanner population |
| **blocked on Lane A** | 10 | the key is in no group, and `lib/cache-groups.ts` is Lane A's |
| **deliberately deferred** | 8 | per-query reads whose key would churn for nothing |

So the remaining Lane B work was **zero**, and the entry now carries `Needs: LB-156` rather than a
count.

## The three that converted

**`dietary-restrictions`** in `meal-plan-setup-sheet.tsx`. `invalidateMealPlans()` has cleared that
key since it was written — for a reader that did not exist. Two things came with the conversion, and
neither is optional: `onError`, because `cachedFetch` swallows `!res.ok` and `restrictionsFailed`
gates the one thing this screen must never do quietly (start a plan from a blank restriction set and
forget an allergy); and an `invalidateMealPlans()` after the restrictions PUT, which **did not exist
before** — `handleSave`'s call is in a different function and does not run when the user edits an
allergy and then abandons the plan.

**Both `hr-window` reads** in `done-activity-screen.tsx`, onto **one** key. The effect built its
query with `URLSearchParams`; the treadmill handler hand-built the same query as a template string.
Same window, two strings, so entering a distance re-requested a trace the screen already had. One
helper builds it now, and the key shape (`hr-window:<query>`, `HR_WINDOW_TTL`) is the one
`activity-detail-sheet.tsx` and `exercise-review-sheet.tsx` already use.

## The three that must never convert — the finding worth keeping

These are not debt and are not waiting for anyone. Each one's contract is *see what the server has,
or nothing*, so painting a cached value first is a correctness bug:

- **`meal-plan-edit-sheet.tsx`** re-reads the plan straight after PATCHing its meals, to hand the
  updated object to `onChanged`. A cached paint is the pre-edit plan.
- **`use-food-logs-loader.ts`** already caches this key on its no-store path; *this* call is the
  authoritative server copy that feeds `applyDelta`. A cached value would be applied as authoritative
  and re-insert rows the outbox has already deleted — BF-47, exactly.
- **`workout-screen.tsx`**'s `/api/achievements` is the **XP delta baseline**. `recordXpEarned`
  subtracts the pre-workout XP from this response, so a cached pre-workout value makes the gain read
  **0**. It already writes the answer back with `setCached`, which is the caching half done right.

They now live in an `AUTHORITATIVE_READS` population in the scanner, keyed by file **and** endpoint —
because `workout-screen.tsx` holds one of each kind, and a per-file exemption would have excused its
convertible sibling too. Each row covers exactly one call: a second bare GET of the same route in the
same file falls through to the baseline and fails. A row that stops matching anything is reported as
an orphan, because a reason asserted for a call that no longer exists is worse than no row.

The test asserts every row's reason is longer than a label (the shortest real one is 118 characters).
Mutation-tested: replacing one with `'needed live'` fails it; breaking a row's endpoint reports the
orphan and exits 1; adding a second bare GET of an authoritative route fails the baseline. Exit codes
read directly, not through a pipe.

## LB-156, and the sharp case that makes it real

Ten conversions need five cache keys registered in the groups whose writes change them — Lane A's
file, so filed rather than done. `day-checkin:` is why this is not bookkeeping:
`invalidateNutritionWrite` has cleared that prefix since it was written, **for a key nobody ever
created**, while `invalidateCheckinAffectsPrescription` — which the check-in writes themselves call —
does not clear it at all. Converting those three readers without LB-156 would cache a check-in that a
*food log* evicts and a *check-in save* does not: fresh by accident, stale by the write that actually
changed it.

## Counts

`check-bare-api-fetch`: 65 → **62** total; 3 authoritative; tracked 24 across 18 files → **18 across
14**. Cleared rows are deleted rather than lowered, so a regression fails outright.

## Not exercised

The done-activity screen's HR trace against a real Oura back-fill, and the meal-plan setup flow's
restrictions PUT — both were driven only by the suite and the build. The behavioural claim that the
treadmill path now reads the effect's already-fetched window is reasoned from `cachedFetch`'s
key-level dedup, not observed on the device. No device check filed: both keys are read the same way by
three and one other sites respectively, and the sandbox cannot produce the ring data that would make a
look meaningful.
