## Orchestrator — Q-287, account deletion: all seven plan decisions resolved (2026-08-23)

Continuing the owner walkthrough. Q-287's own plan (`docs/superpowers/plans/2026-08-16-account-deletion.md`)
carried **seven** marked owner decisions, not the five the queue entry's earlier summary named —
the queue entry had drifted from its own plan doc.

### Three the owner decided

1. **Hard delete, not a tombstone.** Google Play requires deletion to actually remove the data;
   `oura_raw_samples` alone is over a million rows for one user, and a tombstone means carrying
   that weight forever for an account nobody is coming back to.
2. **A 14-day grace period** — chosen over the plan's own "no grace period, export-first" default.
   The mechanism problem that recommendation existed to avoid (no cron layer to execute an expiry)
   has an answer already used elsewhere in this repo: **check on the next authenticated request**,
   the same shape Q-270 used to warm a route once per app launch instead of inventing a scheduler.
3. **Refuse deletion for the last remaining admin.** The owner is currently the only one; a
   self-lockout would take `db-query` and every other admin tool this repo's own session routine
   depends on down with it.

### Three decided without going back to the owner

Each was cheap, reversible, and a mechanical call rather than a preference — the CLAUDE.md rule that
a decision like this doesn't need to interrupt anyone:

- **The big-table delete** measures the indexed `user_id` path first, falling back to a chunked
  delete only if that proves too slow. The plan's own recommendation; no owner preference involved.
- **`friendships` rows delete outright, on both sides**, on the reasoning that a friendship with a
  deleted account is meaningless — the same rule applied everywhere else a hard delete cascades.
- **The web-accessible path Google Play requires** is a route on the sign-in flow that already
  exists, not a new email process.

The seventh item in the plan's original list — reusing the existing table-scoping map rather than
hand-writing one — was never a preference to begin with; it is a finding, and stays in the queue
entry as guidance rather than a decision.

### What this unblocks, and what it does not

Q-287 goes from `Gate: owner` to `Lane A`, `Needs: Q-288` — it now correctly parks behind the export
completeness fix rather than reading as startable with an owner blocker buried in prose. **This does
not exempt the eventual PR from confirmation before merge.** `CLAUDE.md`'s destructive/irreversible
carve-out still applies to the code, not to the decisions that unblock writing it.

Both the plan doc and the queue entry were updated together, and the queue entry's stale duplicate
paragraph (the plan summary had been copy-pasted twice, once current and once from the original
filing) was trimmed rather than left to drift again.

### Verification

`pnpm check:rules` — **54 of 54**. `check-backlog-pointers` — 191 entries, 14 `Needs:` with no
cycles, every target known. `next-item.js` places Q-288 READY and Q-287 parked behind it.

**Not exercised:** nothing here touched the app. No runtime, no device, no version bump.
