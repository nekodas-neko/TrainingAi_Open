## 2026-08-02 — Owner queue-unblocking decisions recorded; batch run-list written (docs-only)

Planning/bookkeeping session, no code. Four questions had been stalling the backlog across several
sessions — whether Phase 3 is still live, whether device verification is available, whether
production data is reachable, and whether to spend the `body_hex` bytea migration. The owner
answered all four. The answers are now on the affected backlog entries in place, with an ordered
13-item run-list in a new handoff.

**Shipped**

- `docs/handoff-2026-08-02-platform-batch-queue-drain.md` — the four decisions, the run-list (branch
  + plan doc + whether each item ships via Railway or needs an APK, per item), a "do not pick up"
  table for the deferred/blocked items, a single accumulating owner device checklist, and a
  paste-ready pickup prompt.
- `docs/implementation-backlog.md` — decision banner at the top of the Queue; Q-1 rewritten as
  **deferred, not cancelled**; Q-30's bytea-vs-D4 tension marked resolved (declined, take Q-35
  instead); Q-31 carries the owner's escalation and points at a re-scope planning PR; Q-28 and
  Q-41 finding 4 annotated as unblocked for measurement.
- `docs/domains/platform/README.md` — handoff linked under History.

**One correction worth recording, because it had been quietly costing sessions.** The queue held
several items deferred "no reachable production data". That was wrong.
`CLAUDE_DB_READONLY_URL` is unset in the sandbox — which reads like the feature is off — but it is
consumed by the route on Railway, not by the caller; the bearer path only needs
`CLAUDE_DB_QUERY_SECRET`, which is set. Verified against production this session
(`POST /api/admin/db-query` → `{"rows":[{"ok":1}],...}`, HTTP 200). Q-28's restore sizing, Q-41's
cadence-floor check and Q-30's diagnostics are all doable in-session now. The handoff says to check
this by calling the endpoint rather than by reading env vars.

**Verification.** `node scripts/check-doc-links.js` → OK (696 files). Nothing else applies —
docs-only, no code paths touched, so no `pnpm dev` run and no device surface exercised. No version
bump (nothing user-visible).

**Not done, deliberately.** No queue item was implemented — this session's output is the decisions
and the ordering. Q-31's re-scope is *described*, not written; it is item 6 on the run-list.
`projectOverview.md` is untouched: no status changed, no new Known Issue was found, and the two
device checks it already tracks (Q-36 Retry, Q-37 confirmation) remain open and are now also
carried on the handoff's checklist.
