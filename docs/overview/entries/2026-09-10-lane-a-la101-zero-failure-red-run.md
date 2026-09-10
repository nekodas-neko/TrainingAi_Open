# LA-101 — the red run with no failing tests: measured, not fixed

**Branch:** `lane-a/la101-worker-teardown-console-race` · **Lane A** · docs only, no code changed.

## What it was

A full `pnpm test` exits **1** while reporting `0 failed`. The entire failure is one line —
`EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending` — a
worker torn down with a `console.*` forward still in flight. Seen twice on 2026-09-10, both during
interactive work, both clean on an immediate re-run of identical code.

## The outcome, stated plainly

**Not fixed. Not reproducible.** 24 controlled full runs produced zero occurrences: 8 with
file-based console tracing, 8 plain, 4 under a concurrent `pnpm dev` server driving 200 API requests
against the same Postgres. Contention was the leading theory and the experiment killed it.

So no fix shipped, deliberately. Without a reproduction there is nothing to verify against, and the
one candidate change — `disableConsoleIntercept: true`, which would make `onUserConsoleLog`
structurally impossible — costs per-file log attribution for everyone. Buying that with a fault
nobody can trigger is a bad trade, and an unverifiable fix in the tree is worse than an accurate
note.

The deliverable is the recognition rule, in
[`local-dev-database.md`](../../local-dev-database.md), beside the two sibling causes of the same
zero-failing-test shape already documented there (the `migration-test-lock` hook and Q-249's
Playwright pickup). Three distinct causes now wear those clothes; a session that meets a red run with
no failing tests should check all three before believing it.

## Two things I got wrong, both worth carrying

**The entry's own first version named a culprit it had not tested.** It said to *"suspect the
interaction"* with `check-comment-blindness`, reasoning from that check's heavy console output.
Three paired runs: clean. A guess written in the same breath as a finding reads afterwards like a
lead, and it was sitting in the queue pointing the next session at a dead end. Retracting it was
worth more than the entry was.

**The run log cannot settle this, and I nearly treated it as though it could.** I grepped the failing
log for `[pg pool] idle client error` — the one console writer that fires asynchronously outside any
test's control — found nothing, and started to read that as ruling it out. It does not: **the pending
`onUserConsoleLog` is the log that never got delivered**, so the message you want is the one the
failure destroys. Its absence is guaranteed under every hypothesis. That is why the tracing appends
through `fs.appendFileSync` rather than console. The harness worked; it simply had nothing to catch.

## What the investigation did find, by breaking things

Killing a suite mid-run leaves two kinds of residue, and I hit both by `pkill`-ing my own batch:

1. **Fixture rows.** DB tests clean up in `afterEach`, which a killed run never reaches, so the next
   run failed on `A program named "LB-66 Program" already exists` — an error that reads like a bug in
   the program-name guard. It self-heals, so it fails once and looks like a flake.
2. **Real source files, permanently.** `check-comment-blindness` injects fixtures into actual
   components and restores them in a `finally` the kill skips. The next run then reads the *polluted*
   file as its baseline and restores to that. A `// <svg><polyline .../>` comment sat in
   `components/workout/set-card.tsx` across eight clean full runs and would never have cleaned
   itself. It never reached `main`, and the stop-hook prompt to commit it was declined for exactly
   this reason.

Both are now documented next to the existing `pkill` warning, which covered exit 143 and not these.

## Not exercised

No product code changed, so nothing to exercise and no device check owed.
