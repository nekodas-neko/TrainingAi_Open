# 2026-09-27 — the PR register had fallen behind by five, and two PRs said "waiting on you" while a required check was red (TN-80, BF-210)

The owner asked for a backlog and PR review. The queue itself is healthy — 542 entries, no duplicate
IDs, no `Needs:` cycles, migration 286 and SQLite v41 matching source. The finding is in the PRs.

## The register had the same defect it was filed about

`TN-80` exists because PRs needing the owner were tracked nowhere. It named three: #1607, #1592
(**already merged as #1616** before the entry was written) and #1499. Seven need him now.

Checked by counting each PR number in the backlog: **#1755 appeared zero times**; #1749, #1672 and
#1671 appeared once each, inside their own closing entries rather than as items awaiting him.

Rewritten as a live register of all seven, worst state first, with CI read per job rather than
assumed, and a line making it the place such a PR gets written down.

## Two of the five "waiting on your yes" are blocked, not waiting

Both descriptions report their gates passing. Both have a **red required check**.

**#1749** (`LA-142`, drop four dead columns) — Migration Check: `applied 228, skipped 0, **58
failed**`, every one `column t.active_calories_est does not exist`, spanning migrations **142 through
285**. Dropping a column from a `claude_ro`-covered table breaks every historical twin migration that
names it, because each twin recreates the view set with an explicit column list. The PR found this
for the *current* view and added a `DROP VIEW`; nothing in the file it edited points at the 58 behind
it.

**#1499** (`OR-138`) — Build fails at the test-typecheck gate:
`app/api/__tests__/or138-readonly-pivot.test.ts: 6 error(s) — this file had none`. Its description
says *"`npx tsc --noEmit` — clean"*, which is true and is **a different gate**: that reads
`tsconfig.json`, the CI step reads `tsconfig.tests.json`.

The shared lesson: **a local gate's name is not the CI gate's name.** Both PRs reported honestly
against the command they ran.

## BF-210 — the general form, and it has a precedent

Filed for Lane A. Only `--replay` reaches this: a fresh database runs 142 while the column exists,
and production skips all 58 by filename. `REPLAY_EXEMPT` already exists for exactly this shape —
`001_initial.sql` is exempt because *"002 renamed the column it references … incoherent rather than
non-idempotent"*. Rename → drop is the same sentence.

The durable half is the rule it establishes: **a `DROP COLUMN` on a covered table costs N replay
exemptions, where N is the number of twins written since that column appeared** — proportional to the
column's age, so it grows quietly. This one cost 58.

## #1465 closed

Superseded entirely: its base-read fix shipped as `LA-132` (`base-ref.js:69` carries the
`maxBuffer`), `BF-24` and `Q-395` already carry the lane it proposed, and `RV-111` and `BF-92` have
left the queue. Conflicted with zero CI runs — which is what a conflicted PR always looks like,
since GitHub schedules no workflow for one. Closed with a comment recording each check, after the
owner confirmed.

## Not exercised

Docs-only. No product code, nothing run on the device, and **no fix pushed to #1749 or #1499** —
both belong to another session, and this session is watching them rather than driving them.
