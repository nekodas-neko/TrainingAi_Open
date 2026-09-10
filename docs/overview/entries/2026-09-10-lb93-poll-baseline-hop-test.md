## 2026-09-10 — LB-93: the flaky baseline-hop test, and the regression my own first fix introduced

Lane A. One test file, no product code. LB-93 leaves the queue.

**The entry described the problem correctly and the fix wrongly, and the file said so.** It reports a
fixed 300 ms sleep appearing *"twice"* in one test, with the fix being *"poll `stateOf(sessionId)`
until `baselineComplete` flips"*. The sleep appears **eight times across seven tests**, and that
prescription applies to **three** of them. The other five assert that something did *not* happen,
and there is nothing to poll for in an absence.

**What the call site settles that the entry does not.** `completeWorkoutFromPayload` fires
`recordBaselineAnchorsFrom` and drops the promise on purpose — a completion must never fail on a
periodization write — behind `phase === 'baseline' && !baselineComplete`. So the eight sites are
three kinds, not one:

| kind | n | fix |
|---|---|---|
| positive — the flag flips, the anchor appears | 3 | poll for it |
| negative, but the write *does* run and leaves a partial map | 3 | poll for the partial map's size, **then** assert the flag stayed false |
| negative, and the guard means **no async work starts at all** | 2 | see below — this is where I got it wrong |

**My first version deleted those last two sleeps outright, reasoning from the guard, and the
mutation pass caught it as a regression.** Replacing the call-site guard with `if (true)` was
**caught by the old file** on *"leaves a session that is NOT in baseline alone"* and **survived the
new one**. Deleting the wait did not remove a bet; it removed the test's teeth. Reasoning about the
guard was right about the mechanism and wrong about the consequence.

**The correction, and the general point.** A negative assertion cannot have its bet removed — only
its *direction* chosen. `expectNoWrite` polls for the write to appear and passes when the window
expires, so contention on a loaded runner yields a false **pass** rather than a false **failure**.
That direction is the entire complaint in LB-93: the old sleep failed on branches whose diffs could
not have caused it, and cost five runs to rule out.

**Mutation record, both files, so the comparison is the evidence:**

| mutant | old file | new file |
|---|---|---|
| M-A — the fire-and-forget write takes 800 ms | **5 of 8 FAIL** | **8 pass** |
| M-B — the call-site guard replaced by `if (true)` | test 6 caught (325 ms) | test 6 caught (**33 ms**) |
| M-B against my *deleted-sleep* first draft | — | **survived** — the regression above |

M-A is the direct proof the bet is gone for the six sites that had one: 800 ms is longer than the
300 ms the file used to wager. It also independently confirms the guard reading — under a slow
write, the two no-async-work tests pass in the *old* file too, which is why only five of eight go
red rather than seven.

**Runtime, measured 3 runs each rather than asserted:** 6.25 / 6.32 / 6.62 s → 4.83 / 5.24 / 5.79 s.
About 1.1 s faster, which is 2.4 s of sleeps removed against 1.0 s of windows added.

**Not exercised:** nothing outside this test file changed, so there is no product behaviour to
verify and no device check owed. The flake itself only reproduces under full-suite contention (LB-93
measured 1 of 2 on the same tree), so a green run of this file alone was never going to be the
evidence — the mutants are, because they make the failure deterministic instead of waiting for it.
