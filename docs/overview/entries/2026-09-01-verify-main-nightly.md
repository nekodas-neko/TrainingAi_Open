# 2026-09-01 · Lane A — the flake had a cause, and `main` gets a nightly (LB-31)

Branch `lane-a/verify-main-nightly`. Two files, no migration, no product behaviour.

## ① The test was passing on a race, and the entry had half the mechanism

`anchor-source.test.ts` failed once on CI — `expected 'readiness' to be 'sleep'`, then 55 where 77
was written — and never anywhere else. The entry recorded an hour of hunting: green in isolation,
green across `app`, green on the full suite against a fresh database, green on a re-run of the
identical commit.

Its diagnosis was that the second test's own sleep row lets the route build **and persist** a
readiness, out-ranking the `sleep` rung it asserts. That is right, and on its own it predicts a
failure every run — which is not what happens. The missing half:

```ts
if (derivedReadiness == null && !todaySnapshot && readinessPlausible) { … }
```

…and the route's snapshot write is **fire-and-forget**:

```ts
repo.upsertBodyBatteryDaily(userId, { … }).catch(() => { /* best-effort */ })
```

So test 1's GET returns before its snapshot row lands. If the row arrives before test 2 runs,
`!todaySnapshot` gates the build off and the anchor falls to `sleep` — pass. If it loses that race,
the build runs, persists, and the anchor comes back `readiness` — the CI failure, followed by test 3
reading 55 instead of 77 because `resolveAnchor` prefers a persisted snapshot already sourced
`readiness`.

**The whole file was passing on a race between an unawaited write and the next test.**

## Reproduced on demand, which is what makes this a diagnosis

Run the second test **alone** on the unstubbed file — test 1's snapshot never exists — and it fails
with CI's exact message, every time. That is why a whole-file run never reproduced it: in order,
test 1's write almost always wins.

The fix stubs `buildReadinessPayload`, which is the entry's own second option (*"make the readiness
build injectable so the precedence ladder can be exercised one rung at a time"*) with vitest as the
injection, so no production code is shaped to suit a test. The same isolated run then **passes**.

**I nearly shipped the stub with a wrong justification.** A first pass asserted the builder *is*
called in test 2, to prove the stub was load-bearing. It failed — the builder is not called in file
order — and chasing that is what turned up the snapshot gate and then the unawaited write. An
assertion that fails for a reason you did not predict is worth more than one that passes.

## ② A nightly `Tests` run against `main`

`ci.yml` has no `push: [main]` trigger, and the reasoning is sound: `main` is protected, reachable
only through an already-green PR, and re-running costs ~11 billed minutes per merge for a result the
PR run already produced. **That is not touched.**

The gap it leaves is different: a PR is green against the `main` it was cut from, and nothing
re-checks the *combination* after several land together — five merged during the run that produced
this entry. A defect from that interaction first appears as the **next** contributor's red check, on
code they never wrote.

So: `schedule: '0 17 * * *'` (03:00 Brisbane, after the day's merges), with `if: github.event_name !=
'schedule'` on every job except `test`. A night costs one job rather than six, and a failure names
`main` and the merge window instead of an innocent PR.

It is not a merge queue and does not pretend to be — it reports the combination breaking, it does not
stop it landing. If it ever fires, that is the evidence for the larger change. Reversing it is
deleting the `schedule:` block and six `if:` lines.
