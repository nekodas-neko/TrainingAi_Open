# 2026-08-25 — the raw-store console says what its numbers mean (Q-538, the visible half)

**Branch:** `feat/raw-store-findings` · **Lane B** · `components/oura-ble/**` only. No schema, no
route, **no APK** — this is JS in the WebView, so it reaches the device on the next Railway deploy.

Q-538 asks for two things: **a bound** on the device raw store, and **a visible failure state**. This
is the second. The first is still blocked and this PR does not pretend otherwise.

## What was missing

`RawStoreStatusConsole` has printed `total / rolled up / unrolled / on disk / low disk` since Q-33,
and the numbers were correct. **Nothing said what they meant.** The owner took the first-ever device
reading on 2026-08-18 — **209,326 rows, 0 rolled up, 31.2 MB** — and establishing that `0 rolled up`
was *the fault* rather than a curiosity took a source trace: `pruneRaw`'s predicate is
`rolled_up = 1 AND synced = 1 AND measured_at < ?`, so with nothing marked rolled up the documented
14-day retention window can delete **no row at all**, and the store grows unbounded at the measured
~3.4 MB/day.

A readout that needs a source trace to interpret has a missing half.

## What shipped

`components/oura-ble/raw-store-health.ts` — a pure function over the plugin's own return shape,
producing the findings the numbers already support:

- **warn** — nothing rolled up, so the prune matches nothing and the store has no upper bound.
- **warn** — past Android Auto Backup's 25 MB per-app quota, so none of it is backed up. Re-verified:
  `AndroidManifest.xml:14` still sets `allowBackup="true"` with no `dataExtractionRules`.
- **warn** — `lowDisk`, i.e. the service is shedding rows and frames are being lost outright.
- **note** — a *partial* rollup, with the percentage. Said deliberately, because "some rolled up" is
  the state that looks healthy while falling behind, which is the retention decision's own warning.

Rendered as a list under the readout, each line carrying a `!` or `·` **beside** the colour rather
than relying on it — the repo's colour-only-state rule, and this card gets read on a phone in
whatever light the owner is standing in.

It is a pure function on purpose: the console is native-only (`getOuraBle()` returns `null` in a
browser), so the interpretation is the part that can be tested at all.

## Verified

- `components/oura-ble/__tests__/raw-store-health.test.ts` — **7 passed**, including the 2026-08-18
  device reading verbatim (both warnings fire on it), the quota boundary asserted at *and* just over,
  an empty store staying silent, and a store that is unbounded **and** unbacked **and** shedding
  reporting all three rather than the first.
- **Rendered** against those same numbers via a temporary scratch route: two lines, both
  `text-destructive`, both prefixed `!`. Route deleted, `.next` cleared afterwards.
- `tsc --noEmit` clean · eslint unchanged (1 pre-existing warning in a sibling file) ·
  `pnpm check:rules` **Ran 56 of 56**.

## What is still blocked, and why it is not this PR

**The bound.** `pruneRaw` can only delete rows marked `rolled_up`, and the only thing that sets that
flag is `markRolledUp`, whose sole caller would be the WebView rollup consumer — **D2 Task 5, still
not built** (re-verified: a repo-wide grep finds no caller for `markRolledUp`, `pruneRaw` or
`getUnrolledRaw` outside the plugin interface declaration). Wiring the prune today would delete zero
rows, which is what Q-538 has said from the start and what the device reading proved.

That work is a rollup consumer over local storage — Lane A's — and there is no queue entry for it to
point a `Needs:` at, so Q-538 keeps it as a written blocker rather than a field that would read as
"already shipped" if the target were absent.

## Not exercised

- **On device.** The findings have never been rendered from a real `rawStats()` call — only from the
  numbers one produced. `Gate: device`, and the check is one press of **Read stats** on
  `/admin/oura-ble` in the APK.
- **The partial-rollup note has no way to be true yet.** Nothing sets `rolled_up`, so that branch is
  unreachable in production until D2 Task 5 lands. It is tested and dead, deliberately: it is the
  case that will matter first when the consumer starts falling behind.
