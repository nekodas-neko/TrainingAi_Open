# 2026-09-22 — Lane A · RV-85: the helper that prevented a blank widget could not say it had failed

## The defect

`{readiness && <OuraScoreChipRow …>}` gates Home's whole score row, and with it the illness advisory
and the early-deload banner. On a failed fetch there was **no row, no skeleton and no message** —
`showHomeSkeleton` requires `refreshing`, so a persistent failure rendered nothing at all on the
owner's most-used screen (22 of 56 resumes in the telemetry window).

`/api/readiness-score` has no null-payload path — it answers a payload or an error status —
re-verified against `main`. So an absent value there is always a failure, never "nothing to say".
This was a failure-vanish, not a hide.

**And the helper meant to prevent it is the one that permitted it.**
`packages/shared/src/fetch-with-retry.ts` says in its own header that it exists because a blip
*"silently yields nothing and never retries, leaving the readiness/sleep widgets blank until the app
is restarted"*. It retries three times (2.5s/5s/7.5s) and then returns `void` with a
`.catch(() => {})` — fixing the transient case and quietly accepting the persistent one, landing on
exactly the blank widget it was written to prevent.

## What shipped

An `onExhausted` channel on `fetchWithRetry`, and a one-line *"Scores didn't load — pull to
refresh."* in the row's slot. The retry ladder is unchanged: same three retries, same delays.

**The distinction is the whole feature.** An absent value means "still trying" until the attempts
are spent and only then means "failed", so the message cannot appear under a request that is about
to succeed. It is cleared on every refresh, so pulling to refresh retries and the message goes away
rather than sticking.

## What the entry left open, and what checking it changed

- **The `.catch(() => {})` it flags as "RV-84's dead shape" is load-bearing here and was kept.**
  Without it the chained `.finally` returns a rejected promise and the failure becomes an unhandled
  rejection. RV-84's finding is about sites that swallow an error *beside a wired `onError`*; this
  one has no `onError` to reach, because `fetchWithRetry`'s `fetchFn` parameter is four positional
  arguments with no options bag. Passing one through would be a wider change than this entry, and
  `onExhausted` covers the user-visible need either way.
- **The line numbers had drifted** — `:1128` is now the early-deload card; the row is at `:1110`.
  Each site was found by grep rather than by the cited line.
- **No sibling to sweep.** `fetchWithRetry`'s other caller is the sleep fetch, and `sleepData` only
  feeds a `provisional` flag and one prop — it gates no row, so it has no failure-vanish of this
  shape. Checked rather than assumed.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**, including the two e2e-specific rules (a stub must block the
  service worker; a stub must not hand the app a literal date).
- Full suite — **9,375 tests / 991 files**, green. `check-test-typecheck` none above baseline.
- **There were no tests for `fetch-with-retry.ts` at all.** There are now nine, and they pin the
  shipped retry count and ladder as well as the new channel, since the exhaustion point is derived
  from them.
- **Mutation pass: 5 caught, 1 equivalent control passed.** Firing on every failed attempt instead
  of the last; firing when cancelled; firing when a retry succeeded; an off-by-one in the attempt
  cap; dropping the `responded` guard.
  **One gap was found and closed by the pass rather than by writing more tests up front:** the
  "cancelled" case passed against a deliberately weakened guard, because cancelling at attempt 0 —
  and even between attempts — never reaches the exhaustion branch at all; the timer's own
  `isCancelled()` check stops it first. The case that separates them is an unmount while the **last
  attempt is in flight**, which is the realistic one: the ladder runs about fifteen seconds. That
  test now exists and the mutation fails against it.
- **The e2e spec was run locally, and mutation-checked.** `e2e/rv85-scores-say-they-failed.spec.ts`
  fails the route persistently and asserts the slot is still **empty partway through the ladder**
  before asserting the message appears — 18.3s, matching the ladder. Disabling the render branch
  fails it. It carries a control case (a working fetch leaves no message), because a test that only
  asserts the message appears would also pass against a build that showed it unconditionally, which
  is a worse bug than the blank it replaces.

## Not exercised

Not seen on the device. It is a WebView-reachable change (no `android/**`, no plugin), so it arrives
through a normal Railway deploy. The **real-world trigger** — the route's 20/60s rate limit being
exceeded by the mount + tab-show + pull-to-sync fan-out — was **not reproduced**; the entry lists
that as not established and it still is. What is verified is that when the fetch does fail, the
screen says so.
