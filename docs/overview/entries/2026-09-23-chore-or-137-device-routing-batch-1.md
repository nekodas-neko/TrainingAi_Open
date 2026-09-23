# 2026-09-23 — device-check routing, batch 1, and the plan that had already done it

Orchestrator. Docs-only. Branch `chore/or-137-device-routing-batch-1`.

## What this was for

The standing task is routing the ~108 owed device checks to the agent that can act on each. The
method was to read the 19 entries under BLOCKED ON A DEVICE CHECK in batches, applying the lane rule
— `Lane:` names who acts NEXT, and the device agent takes an entry only when the next action is a
measurement nobody has run with an objective pass/fail.

## The finding that matters more than the batch

**The device agent had already done this triage, and I did not read its plan before starting.**
[`docs/device-sweep-2-plan.md`](../../device-sweep-2-plan.md) sorts the same entries into stations,
and lists separately what a sitting cannot supply: hardware, a time of day, the owner's judgement,
and the owner's consent. [`device-sweep-1-plan.md`](../../device-sweep-1-plan.md) records that
`RV-143` reads the large specs — `BF-11`, `Q-395`, `Q-168`, `Q-34` — as **mis-gated rather than
device-blocked**, which is a different remedy from sending them to the phone.

Reading it mid-batch **reversed two of my four routings**:

- **`BF-92` → `DV` was wrong.** The check is a deliberate client-side throw in production, and the
  plan's note is *"ask first — it may page someone"*. The next act is the owner's consent, not the
  phone. Now `Lane: O`, `Gate: owner`, and it goes to `DV` the moment that is given.
- **`DV-14` should not have been filed.** I split a screenshot capture out of `Q-395`'s gate as work
  for the device agent. Sweep 2 already visits those screens — station A's meal-builder walk, station
  H's barcode-scanner walk — so it was a second request for one pass. Withdrawn; `Q-395` now points
  at the stations.

**This is trap (b) in a form CLAUDE.md does not yet name.** The rule says a probe *already run* is no
longer the device agent's. The same holds for a probe already **triaged**: re-deciding where an entry
belongs, when the agent who owns the sitting has decided, is not routing — it is overriding, and the
tell is the same (the answer already exists and nobody looked). The discipline that caught it is the
one that paid two days ago: **grep for the existing answer before writing a new one.** It cost two
wrong edits here because I reached for the entries before the plan.

## Batch 1 — ten entries read, four changed

| entry | was | now | why |
|---|---|---|---|
| `RV-111` | `B` · `Gate: device` | **`DV`** | The fix is written and Lane B could type it today, but whether it is the *right* fix is not established: if the native barcode activity intercepts back before the JS listener runs, the defect does not exist and the fix wires a handler for a press JS never sees. Already scheduled as sweep 2 station H. |
| `BF-92` | `A` · `Gate: device` | **`O` · `Gate: owner`** | See above — consent first. |
| `BF-24` | `B` · `Gate: device` | **`O` · `Gate: owner`** | Every buildable item is closed with a reason; what is left is artboard parity and the owner's ④ watching brief. A judgement about whether it looks right, not a measurement. |
| `Q-395` | `B` · `Gate: device` | **`O` · `Gate: owner`** | Same shape, and `RV-143` had already called it mis-gated. |

**Six confirmed correct where they were**, which is the point of reading rather than sweeping:
`PS-8`, `PS-9`, `PS-12`, `PS-16` wait on the **Colmi R09**, not the S25 — `OR-135` annotated all four
the day before, and the device agent cannot discharge them by picking up the phone. `BF-49` and
`LA-36` were both measured on sweep 1; their next act is a fix by the lane that owns the surface.

## Batch 2 — not needed

The nine remaining blocked-on-device entries (`BF-11`, `BF-22`, `Q-418`, `Q-545`, `Q-388`, `Q-114`,
`Q-51`, `Q-34`, `PS-7`) are **already categorised in the sweep plans** — hardware, a time of day, the
owner, or mis-gated. Re-routing them from here would be the same override. Left alone.

**So the honest size of the remaining task is much smaller than "105 device checks need routing".**
Most are owed on entries whose next act is a fix, and of the genuinely device-blocked ones the device
agent has already sorted them into a plan. What was actually missing was four entries carrying a
device gate for work that is a judgement or needs consent.

## One disagreement left standing

`Q-168` is in `Lane: DV` from OR-136 this morning; both sweep plans group it with the spec-sized
entries `RV-143` reads as mis-gated. Both readings are defensible — the entry is large and mostly not
a device question, but the one thing still owed is whether a bottom-anchored control on two navless
routes clears the gesture bar, which is a number. **Recorded on the entry as an open disagreement
with the device agent named as the decider**, rather than resolved by whoever edited last. If it
comes back it wants a `Gate: owner` and a note, not a silent re-park.

## The ratchets' base read has been broken since the backlog passed 1 MiB

CI failed this PR's Custom Rules with *"`docs/implementation-backlog.md` is 27338 lines, over its
27300-line baseline by 38"* — a number the branch had not caused. Two lines above it, the warning
added for exactly this purpose named the cause:

```
base-ref: could not read docs/implementation-backlog.md at origin/main after 3 attempts.
          git said: spawnSync git ENOBUFS
```

**`showAtBase` spawned git with no `maxBuffer`, so it inherited `execFileSync`'s 1 MiB default.**
The backlog is **2.03 MiB**. ENOBUFS is not a path-absent message, so the read was classified
unreadable, retried three times, and then treated as **absent — which is strict**. The effect is
that every ratchet reading the repo's largest tracked doc at base has been unable to answer
*"the base already has this"* for as long as the file has been over 1 MiB.

**It was never intermittent.** It reproduces on demand, in CI and the sandbox alike — it read as a
flake only because the check it breaks reports a line count rather than the read behind it. One line
fixes it, matching what `materialiseBaseTree` in the same file already does:

```js
stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28,
```

`lineCountAtBase` now returns **27300** — the exact baseline CI reported. The regression test uses
the real backlog as its witness rather than a synthetic 2 MiB fixture, because the thing that
regressed is *the repo's largest tracked doc is readable at base*, not a buffer size; it asserts the
witness exceeds 1 MiB so it cannot silently stop pinning anything. Verified by reverting the fix and
watching it fail with `base read failed: spawnSync git ENOBUFS`.

**⚠ This is NOT the goals-route flake, and saying so would be the third wrong diagnosis of it.**
That failure names `app/api/user/goals/route.ts` at **3,870 bytes**, nowhere near the buffer, and its
run printed **no base-ref warning at all** — whereas this failure always warns. Two separate bugs
that both end at `atBase === null`. The goals flake remains undiagnosed; what this does change is
that one of the two paths into that state is now closed, so the next occurrence has one fewer
explanation to rule out.

## `main` was RED — found here, fixed in #1472, crossing the lane line on purpose

Re-merging `main` turned this branch's gate red in
`app/api/next-session/prescription/__tests__/prescription.test.ts`, 4 of 6. **It is not this diff**:
confirmed red on `origin/main` in a clean worktree, 4 failed / 2 passed, identical.

**Cause.** `#1466` (RV-82, *"Hand back the program `getNextSession` already fetched"*) replaced the
route's `repo.getActiveProgram()` call with `recommendation.program ?? null`. The change is right —
`getActiveProgram` is a fixed 5-query composite that was running twice per request. But the spec
still seeded the program through `getActiveProgram.mockResolvedValue(...)`, and its `getNextSession`
mock returned `{ isRestDay: false, session, reason: '' }` with **no `program` key**. So `program`
was `null`, the route took its `!program` branch, and every case got `REST_DAY_RESPONSE` — hence
*"expected true to be false"* on `isRestDay`.

**Nothing failed at compile time, because a `vi.fn()` that is never called is not an error.** A mock
for a call the code no longer makes is dead in exactly the way an unused export is — the `LA-26`
shape, one layer up.

**The fix** carries the program on the `getNextSession` mock in all five cases, keeping
`getActiveProgram` seeded from the same object so the two cannot drift. `#1466` is NOT reverted; the
double-fetch it removed is real.

### Why an Orchestrator touched `app/api/**`

It is Lane A's path and this crosses the rule deliberately, so the reasoning is on the record:

- **`Tests` is a required check, so red `main` blocks every PR from every agent** — including Lane
  A's own live `#1467`, and including the backlog entry that would have documented the breakage.
  Filing it and waiting would have parked the whole repo behind a queue entry that could not merge.
- **It is test-only and mechanical** — no product behaviour changes, and the shape of the fix is
  forced by `#1466`'s new contract.
- **No open PR was fixing it.** Checked before writing anything.
- **The collision risk is the real cost** and it is not zero: Lane A may fix the same file in
  `#1467`. If both land, it is one test file to reconcile and the two fixes would be near-identical.

**It did NOT ship in this PR, and the first draft of this entry said it did.** The fix sat here
through **five** successive lost merge races: this branch edits the shared doc-size baseline, `main`
takes a commit every few minutes, and CI runs about seven — so it conflicted faster than it could go
green, twice being refused at the merge call after all six checks had passed. It was cut onto a
one-file branch with no shared-line edits and merged as **#1472** (`9a2fe4dfa8`). This branch then
re-merged `main` and the file dropped out of its diff entirely.

**The lesson is about bundling, not about the race.** Folding work into one branch was right earlier
in the session, when CI cycles were the scarce resource. It became wrong the moment the branch
carried something that blocked other people: **an urgent fix must have no conflict surface.** A PR
that edits a shared baseline cannot land quickly, by construction.

Filed as `OR-138` at the top of Lane A's queue first, then removed from the queue once the fix was
in flight — a finished entry must not sit in the queue.

**Worth checking next:** whether the other specs touching `getNextSession` seed a program the same
way. Not done here.

## Not done

- **No product code**, no device run.
- `LB-121` was on the plan as work and is not: it is a `Reference:` entry, fixed in #1390 and kept
  because it is the third independent filing of one bug. Reading it before acting is what caught it.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 804 test files passed. Full log kept,
not tailed. The one `base-ref: could not read` line remaining in it is
`base-ref-read-failure.test.ts`'s own deliberate bad ref.
