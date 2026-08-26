# 2026-08-26 — `replaceOuraDailySummary` never commits a wipe (Q-528)

**Branch:** `fix/daily-summary-replace-guard` · **Lane A** · v1.382.2

## The entry asked for one fix; there were three

Q-528 reported that `replaceOuraDailySummary` deletes every one of the user's rows and *then*
returns early on an empty input, so a full-history pass that assembled no nights commits a wipe and
returns successfully. That is real. Two more of the same class were in the same seven lines:

| | defect | reproduced as |
|---|---|---|
| 1 | guard sat below the delete | `replace(user, [])` took the table **3 rows → 0** and returned success |
| 2 | delete and insert were separate statements | a rejected insert left the delete committed: **3 → 0** |
| 3 | insert had no `ON CONFLICT` arm against the `(user_id, date)` UNIQUE | a repeated date raised **`23505`**, rejecting all three rows |

Defect 3 is Q-280's shape under a different SQLSTATE — one duplicate taking its neighbours down —
and it is the reason this landed the day after that sweep. Defect 2 is not in the entry at all.

`replaceDaytimeStressBuckets`, forty lines further down the same file, already has all three right,
and its own comment says why: *"the delete and the insert share a transaction so a day is never
briefly empty for a concurrent reader."* The fix is to make this function match its sibling.

## Reproduced before it was fixed, deliberately

The entry states outright that *"the mechanism is read from source and not reproduced"*, and its own
predecessor had been **retracted** once for exactly that — it reported the table held 1 row from
`n_live_tup`, a planner estimate, against 45 real rows, and suspended another entry on the strength
of it. So `daily-summary-replace-guard.test.ts` was written and run **against unmodified `main`**
first: 3 of its 5 cases failed, one per defect, with the `23505` arriving as
`Key (user_id, date)=(…, 2026-04-01) already exists`. The two control cases — it still replaces a
real history, and its delete stays scoped to one user — passed before and after.

Each of the three fixes was then reverted independently: **each one fails exactly one test**, and
restoring gives 5/5. Every mutation asserted its own anchor first, so a drifted `sed` fails loudly
rather than mutating nothing and reporting a pass.

## The trade this makes, stated

Guarding above the delete means a user whose history genuinely *should* end up empty now keeps stale
rows — the function can no longer distinguish "there is correctly nothing to store" from "this pass
failed to compute anything". That is the right side to err on: the first case requires a deliberate
act (deleting the raw archive) which can have its own path, while the second is a decode failure or a
narrow window and gives no signal at all. Inferring a wipe from an empty argument is precisely what
made the original silent. Recorded in the function's own comment so it is not re-litigated.

## What is NOT in scope, and why

TN-1 carried a note saying *"do this with Q-528, not after it — one branch should reorder that guard
and add this count"*, reasoning that `fullHistory` is both the only path reaching the chronic-stress
model and the flag arming this delete. **They were not batched, and TN-1's note is amended to say
so.** Q-528 offered two fixes; the batching argument only holds for one of them. Reordering the
`fullHistory` branch in `run.ts` would have shared a diff with TN-1 — but fixing the function itself
is the better fix, because it protects every caller rather than the one path, and it touches nothing
TN-1 touches. There was no shared diff left to share a branch for.

## Also in this PR

**LA-33 filed** — three shared-line ledgers cause a merge conflict on essentially every pair of PRs.
Measured rather than reasoned: PR #544 was outrun by `main` **four times in 35 minutes**, and all
four conflicts were in `doc-size-baseline.json`, the backlog, and `package.json`/`changelog.ts` —
never in code. The repo already solved this exact shape once, when the session journal moved from a
shared `history-*.md` to one file per entry and took its conflict rate to zero. Filed with a
`Gate: owner` on the format choice, and deliberately scoped to the baseline ledger alone: the
backlog's conflict is a *judgement* (two deletions vs two additions) and splitting it is a much
larger restructuring, because queue order is currently expressed by position in one file.

## Verification

Full suite, `pnpm check:rules`, `tsc --noEmit`, lint. Five DB-backed cases, each mutation-proven.

## Not exercised

Native SQLite / Capacitor, safe-area, Samsung WebView, real device — this is a server write path with
no UI. **Not exercised on production data either, and that matters here:** the fixed function is
reached only by the hand-triggered `fullHistory` redecode, so nothing in routine ingest will exercise
it. The wipe was latent when filed and stays latent; what changed is that it can no longer happen.
