# 2026-08-05 — Q-85: the tests weren't flaky, they were slower than the limit

**Domain:** platform — v1.260.1, test infrastructure only

CLAUDE.md carried a standing instruction: *"Before reporting any DB test as failing, re-run that file
on its own — this produced four false alarms in one session on 2026-07-28 and every one passed
alone."* The stated cause was connection-pool oversubscription: many vitest workers, each with a
`max: 10` pool, against one Postgres.

That explanation was plausible and never measured.

## What the measurement says

Every test file that runs a full `aggregateOuraRawSamples` pass, timed **alone, with nothing else
running**:

| file | test time |
|---|---|
| `oura-ble-sleep-bedtime-fragment` | **14.55 s** |
| `oura-ble-sleep-fallback` | 9.42 s |
| `oura-ble-decoded-from-hex` | 7.22 s |
| `oura-ble-sleep-night-merge` | 7.03 s |
| `oura-ble-sleep-staging-rollup` | 6.51 s |
| `oura-ble-aggregate` | 5.92 s |
| `oura-ble-daily-summary` | 5.59 s |
| `oura-ble-sleep-anchor-drift` | 5.24 s |
| …11 more | 3.4 – 4.8 s |

Against vitest's default **5000 ms per test**.

These aren't accidentally slow — they decode, stage, roll up and write a full night. They are
legitimately heavy. But three of them sat within 20% of the limit *with zero contention*, so the
smallest amount of parallel load pushed them over. The suite was flaky by construction, and the
documented workaround was to disbelieve it.

**The obvious suspect was measured and cleared.** v1.259.1 made the daytime-HRV refit do real work
inside `aggregateOuraRawSamples`, so it looked like the cause. Stubbed out, the same files take
5.50 s and 6.11 s against 6.04 s and 5.86 s with it — indistinguishable. The slowness predates it by
a long way.

## The fix

A separate `rollup` vitest project with a **60 s** timeout (4× the slowest solo measurement — the
margin is for contention, which is what tips them over). Everything else stays at 5 s, so a genuine
hang still fails fast.

**Deliberately not a raised global timeout.** That would have been one line, and it would have
hidden real hangs across the other ~380 files. The whole point is to stop *masking* signal, not to
mask more of it.

The glob is pinned to the thing that makes these files expensive:

```
grep -rl aggregateOuraRawSamples lib/data/postgres/__tests__/
```

A new rollup test written outside that glob inherits the 5 s default and becomes the next false
alarm, so the config comment says to keep the two in step.

## The doc change matters as much as the config

CLAUDE.md's rule is now narrowed rather than deleted. The half that was never true — that these
failures are row collisions or purely pool exhaustion — is replaced with the measurement. The half
that is still true is kept and given a distinguishing signature: **genuine pool exhaustion shows up
as a connection-acquisition failure, not a 5 s timeout**, and running a `pnpm dev` server alongside
still makes it likelier.

And the operative line is inverted: **a rollup test that times out now is worth believing** rather
than re-running away. That was the real cost of the old rule — it trained every session to treat a
red suite as noise first.

## Verification

Full suite: **397 files, 3,136 tests, all passing, exit 0.** Same file count as before the split, so
the project division loses nothing and duplicates nothing. The three files that timed out under the
parallel run now pass in it.
