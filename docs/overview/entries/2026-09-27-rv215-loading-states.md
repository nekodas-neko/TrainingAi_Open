# The weekly-stats skeleton can end — and the entry's other twelve cards were already fine

Implementation Lane B, 2026-09-27. `RV-215` item ①; ② is wrong about every example it names;
③ stands untouched.

## What shipped

`cachedFetchToday` swallows `!res.ok` unless the caller passes `onError` — the self-fetching-card
rule in `CLAUDE.md`. Weekly stats didn't, so a failure left `weeklyStats` null,
`loading={weeklyStats === null}` stayed true, and the skeleton animated until the app was killed.

The hub now takes `error`/`onRetry` and renders the shared `EmptyState` with a **Try again**. A
later success clears the flag, so the error cannot sit over data that has arrived.

**The error branch is checked before `loading`, and that ordering is the fix rather than a
tie-break.** A failure leaves `data` null, so `loading` is *also* true — put the loading branch
first and the skeleton still wins and nothing changes. The test pins the order with that reason.

Guarded twice: a source test for the wiring, and an e2e that serves a real 500 and asserts the
screen **leaves** the loading state. Control-run: removing `onError` fails both.

## Item ② is wrong about all three cards it names

It says *"12 components render `null` while loading or empty, so the card vanishes rather than
saying why"*, and names three. Checked, all three:

- `observed-hr-card.tsx` already passes `onError` and renders *"Couldn't load your heart-rate
  profile — pull to refresh"*. Its `return null` sits **after** that branch.
- `workout-density-card.tsx` and `nutrition-activity-trends-card.tsx` return null **only while
  loading**; once loading ends they render *"No workout density trends yet."* Both already carry a
  comment citing this exact rule and explaining that a swallowed failure and "nothing logged yet"
  are indistinguishable there, so they show the empty line either way.

**A `return null` while loading is a defer, not a vanish**, and the reading that produced "12"
cannot tell the two apart. So the count is unreliable and the hand-list is not a starting point —
it is wrong about the three cases anyone can check in a minute.

What a trustworthy version needs is a scan that flags `return null` on a component's **terminal**
state — loading finished, no error branch present. That is the self-fetching-card rule's missing
ratchet and is worth writing; it is simply different work from clearing a list of twelve.

## Not exercised

**Not verified on device.** The failure state was rendered at 412 px dark against a real 500. No
APK needed. The retry re-runs the same concurrency batch the first load used, so nothing here takes
a path the first paint does not.
