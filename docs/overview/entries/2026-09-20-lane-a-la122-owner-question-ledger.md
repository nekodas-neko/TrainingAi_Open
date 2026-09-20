# 2026-09-20 — LA-122: the five owner decisions Lane A is blocked on, written down

**Branch:** `lane-a/la122-owner-question-ledger` · **Lane A** · docs-only · filed at the owner's
request ("either state them here or file them for the orchestrator").

## Why

Five decisions had accumulated across the session, each raised in chat and each blocking a specific
queue item — BF-179 for a day, Q-29's destructive drop for longer, Q-28/BF-9/BF-7 indefinitely. A
chat transcript ends with the session; the queue does not. LA-122 is a `Reference:` entry, so
`next-item.js` prints it in its own section rather than at the head of the work list.

## What is in it

1. **BF-179** — is the 52% still on screen? The row regenerated at 23:10 on 09-19 and
   `session_periodization` keeps no history, so the earlier state is unreadable. One look settles
   whether this is live or a post-mortem.
2. **LA-121** — port `computeBlendedScore`'s temperature ladder onto the composite path, or accept
   `tempZ` as its successor? Either answer re-scores stored days.
3. **Q-28, BF-9, BF-7 carry no `Gate:` field.** They are held back only by an exclusion list inside
   a scheduled routine prompt. Gate them in the file or release them — a convention living in a
   prompt rather than in the file everyone reads is the kind that goes stale unnoticed.
4. **Q-29 Task 5** is a destructive drop of the server raw archive; confirm-first by rule.
5. **The `.size` conflict tax.** Every merging PR and every Lane A PR touch the same ratchet file.
   Today `main` took a commit roughly every 8 minutes against a ~6-minute CI run, and **Q-1a needed
   five rebases and four refused merges to land**. Recommended fix: BugFix batches a sweep into one
   PR. Also recorded: **GitHub auto-merge is unavailable on this repo** — `enable_pr_auto_merge`
   returns *"Protected branch rules not configured for this branch"* — so the CI/CD section's
   auto-merge suggestion does not apply here, which is worth knowing before someone else reaches
   for it.

## Shape

Written as a ledger with a `Keep:` line rather than five separate entries, because they share one
blocker (owner attention) and splitting them would put four more items at the head of a queue that
nobody can start. Each item names the entry it unblocks, so striking it is mechanical.

## Not exercised

Docs-only, no code touched.
