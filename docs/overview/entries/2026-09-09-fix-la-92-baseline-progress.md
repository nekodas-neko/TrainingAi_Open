## 2026-09-09 — The baseline card says how far along it is (LA-92)

**Branch:** `fix/la-92-baseline-progress` · **Lane B** · PR #1036

### What shipped

*"3 of 5 exercises logged"* in place of *"Baseline needed"*, on the AI Periodization card.

The old label read identically after zero baseline sessions and after four of five exercises, which
is why BF-131 could not be reported: the owner could only say *"even though the session was done it's
saying baseline needed"*, because the screen had no other words to offer.

### The count is an intersection, not a key count

The entry's own note is the load-bearing part: anchors in `baseline1rm` are keyed by
**session-exercise id**. `Object.keys(baseline1rm).length` therefore counts anchors for exercises
that may no longer be in the session — edit the program and the numerator can exceed the denominator,
so **"6 of 5" is reachable from a plain key count**. `baselineProgress` intersects the anchors
against the session's current exercise ids, which is what keeps the pair consistent. The e2e plants a
stale anchor specifically to prove it is not counted.

### "A rendering job rather than a data one" was nearly true

The entry said the calculation was the whole of it. The denominator was not in the card's payload:
`/api/ai-periodization/program-overview` has `ps.exercises` in scope and does not emit it, and adding
it is an `app/api/**` path this lane does not own.

It resolved without a route change because `workout-data:meta` already carries the full program and
is in the sync provider's warm list at `TTL_LONG` — so the exercise list is a cache read in the
ordinary case rather than a second request for a label. **Third time this session an entry's
"just the surface" claim turned out to be missing a field** (Q-519's `manualSleepStart`, BF-133's
seven-day window, now this). The classification held each time; the estimate of what was left did not.

### The e2e took the Health screen down before it passed

The first draft stubbed **both** endpoints, including `workout-data?tab=meta` with a thin fixture.
That key is shared with several other cards, and the partial payload crashed the whole screen with
`Cannot read properties of undefined (reading 'toLowerCase')` — no tabs, no content, an error
boundary. It looked like the change had broken Health; removing that one stub rendered the screen
perfectly, which is what proved otherwise.

The rewrite reads the **real** program up front and anchors the fixture to real session-exercise ids,
stubbing only the periodization state. That is the shape `score-gap-reason.spec.ts` already uses —
build the fixture from the real response so every other card stays honest.

**Worth stating as a rule:** stubbing a cache key that several components share is not a local act.

### Verification

6 unit tests on `baselineProgress` — the stale-anchor case, zero read as zero rather than as "no
answer", an unknown exercise list returning null rather than inventing a denominator, and the
singular in "1 exercise". `e2e/baseline-progress-label.spec.ts` drives the real Health screen at
412 dp and asserts both the new label and the absence of the old one.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green ·
the new e2e green.

**Not exercised:** the S25 and Samsung WebView. A real partial baseline is also not something the
seed has — the count is proven against a fixture anchored to real exercise ids, not against a
genuinely half-finished baseline.

### A flake found on the way, filed as LB-93

The full suite went red once on this branch — `baseline-anchor-hop.test.ts`, BF-131's own engine
test, `expected false to be true`. The first hypothesis is always your own diff, so it was measured
rather than assumed: it passes in isolation on both trees, passes the full suite on clean `main`, and
passes the full suite on this branch — 1 failure in 2 full runs, on a components-only diff that
cannot change what a Postgres adapter writes.

The mechanism is in the file: it waits for asynchronous work with
`await new Promise(r => setTimeout(r, 300))`, twice, against a Postgres ~865 other test files share.
A fixed sleep is a bet on how long the work takes, not a wait for it. Filed for Lane A with the run
table, because the expensive part of this flake is that it fails on branches that did not cause it —
five runs to rule out, and the next author would start from scratch.

Patch bump — one label.
