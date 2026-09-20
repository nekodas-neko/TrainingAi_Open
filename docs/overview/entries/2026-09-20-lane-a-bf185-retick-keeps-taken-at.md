# 2026-09-20 — BF-185: a re-tick moved a real injection's time by 35 minutes

**Branch:** `lane-a/bf185-retick-keeps-taken-at` · **Lane A** · engine half only; the editable-time
control is still owed and is Lane B's.

## What was wrong

`supplement_logs.taken_at` followed the last tap rather than the dose. Ticking a dose, unticking it
and re-ticking it rewrote the stamp, and nothing on screen said so. Measured on the owner's
Retatrutide row 2026-09-20: `taken_at` moved **10:46:33 → 11:21:13**, 35 minutes, on an injection
that happened once. `created_at` did not move, so the row knew when it was first written and
reported the last tap anyway.

It matters because BF-184 exists to correlate dose timing against overnight HR and HRV — the owner's
words were *"dosage night vs hr"*. A stamp that follows the last tap is the one field that analysis
cannot tolerate drifting, and it drifted silently: the only way it was found was asking.

**No double recording, which is what the report suspected.** The upsert correctly revives the day's
soft-deleted row rather than inserting a second. Three rows for three doses, none tombstoned. The
bug was in the one field nobody was looking at.

## This reverses a documented decision rather than fixing an oversight

The comment above the upsert argued its position outright: *"Re-logging re-stamps because the row is
one act of taking it: if the dose was corrected between the untick and the re-tick, the second value
is the true one."*

That reasoning is correct **for the dose**, which still re-stamps. It fails **for the time**, because
the two things a re-tick can mean produce the same two taps — *"I mis-tapped"* and *"I took it just
now"* are indistinguishable from a toggle, and the old rule silently assumed the second. So the
comment is argued against in place rather than deleted, per the entry's own instruction.

## The half that actually fixes the APK is the local one

The entry names two files and reads as though either would do. They are not equivalent:

- The **server** now preserves `taken_at` on conflict unless the caller states one.
- The **device** pushes the `taken_at` it reads back from its own local row, and an explicit value
  **wins** server-side.

So a local store that kept re-stamping would push the re-stamped time straight over the server's
preserved one, and the owner's measured drift would have survived the server fix completely. Fixing
only `adapter.ts` would have produced a green suite, a true-sounding journal entry, and no change on
the device. The local mirror is the load-bearing half.

## A third write path the entry did not mention

`applyDelta`'s manual branch carries the **same** `taken_at=excluded.taken_at` line, and it must keep
it. That path mirrors a server row the device did not author, so the server's value *is* the truth
there — copying the fix into it would make a device ignore a correction made anywhere else. A test
pins it as deliberately different rather than leaving the asymmetry to be read as an oversight.

## Verification

- **Server: 5 tests** against local Postgres — re-tick preserves, plain re-log preserves, an explicit
  time still wins, a NULL stamp is filled rather than pinned, and the control below.
- **Device: 6 tests** — and they are **behavioural, not grep**. The sibling suites in
  `lib/local-store/__tests__/` scan source because `getLocalStore` returns null under node, but the
  SQL is a plain string and `node:sqlite` will run it. So the test **extracts the shipped statement**
  from `sqlite-backend.ts`, substitutes each branch of the real ternary, and executes both against a
  table built from the migration's own DDL. A change to that SQL changes what the test runs.
**Two typecheck errors the gate caught, both mine.** `check-test-typecheck` refused the pair:
`Repository` is not an exported name (it is `WorkoutRepository` — the sibling suite carries the same
error as baselined debt, so it was fixed here rather than baselined again), and `node:sqlite` has no
declarations under the pinned @types/node 20. The second is now `types/node-sqlite.d.ts`, declaring
only the members used and carrying its own deletion condition.

- **Mutation pass, four mutations:**
  - server conflict clause reverted → **3 of 5 red**; the two survivors cover arms the mutation does
    not reach (explicit-wins, NULL-fill), which is correct rather than a gap.
  - `COALESCE` rewritten as an equivalent `CASE WHEN … END` (the deliberate control) → **5 of 5 green**.
  - whole row frozen on conflict instead of just the time → **3 red, the control among them**. This
    is what the control exists for: an over-broad fix passes every "preserve" assertion and fails here.
  - fix wrongly copied into `applyDelta` → **1 red**, the asymmetry guard.
  - local fix reverted → **3 of 6 red**.

## Not exercised

- **Not device-verified.** The toggle is the surface and the timing is what is being measured, so the
  entry's own verification — tick, note the stamp, untick, re-tick, confirm it has not moved — needs
  the APK. `getLocalStore` returns null in the sandbox, so the local path ran here only as extracted
  SQL against `node:sqlite`, never through the real store on the real device.
- **No APK needed, though.** Both halves are TypeScript, so they reach the device through a normal
  Railway deploy.
- **The Lane B half is not built and BF-185 stays queued for it.** Preserving the stamp removes
  today's only way to correct a wrong time, which the entry raises against itself. The server already
  honours an explicit `takenAt` and a test pins that arm, so the editable control has something to
  send — but until it exists, a wrong time is uncorrectable from the UI. That is a deliberate,
  stated regression in reach, taken because a silently-drifting stamp is worse for the analysis the
  field exists to support.
- **`pnpm lint` is the CI command and exits 0.** An `npx next lint --max-warnings 0` run of my own
  making reported a warning in `lib/walk/__tests__/segment-stats.test.ts`, a file this PR does not
  touch; the repo tolerates warnings (749 of them) and CI does not pass that flag. Worth stating
  because a stricter-than-CI local invocation reads exactly like a real failure.
- **The owner decision named in the entry is untouched.** Editable-vs-visible-re-stamp is still open;
  this change is compatible with editable (the entry's, Lane B's and Lane A's shared recommendation)
  and is one line to revert under the other answer.
