# 🪐 Orchestrator — baton

> **Successor sessions are titled `🪐 Orchestrator 🟢`** — exactly, emoji included. A renamed successor
> is a lost thread even with a perfect baton.

**Updated:** 2026-08-23 · **By:** the session that ran sweeps 1 and 2 · **Next ID:** `OR-1`

## Now

Nothing in flight. **Sweeps 1 and 2 are done** — `COMPLETED_HEADING_BASELINE` is `new Set([])`
(shrink-only), and the first real batch is assigned. Detail:
[`sweep 1`](../../overview/entries/2026-08-20-orchestrator-sweep-completed-work.md) ·
[`sweep 2`](../../overview/entries/2026-08-23-orchestrator-sweep-aggregation.md).

**Sweep 1's number:** seven of seventeen finished headings were actually finished. **Sweep 2's:**
Q-116 and Q-388, filed 11 days apart, were the same investigation and neither knew — the second had
traced the first's suspected cause to a line. Grep the queue for a symptom before filing.

## Next — in this order

1. **Aggregation, continued (sweep 2).** 201 entries, **7 batched** across three slugs. The native
   seam is largely spent — the honest native count is ~20, not the 56 a naive grep returns. Next
   best axis: entries sharing one **owner conversation**, and the `[nutrition]` surface cluster.
2. **Lane and readiness (sweep 3).** Six `Lane: ?` — `PS-4`, `Q-410`, `Q-535`, `BF-1/2/3` (the
   `BF-` three may need the owner's scope first). Four prose `⛔` markers want a human read:
   `Q-529`, `Q-49`, `Q-3b`, `Q-1b`.
3. **Docs against reality (sweep 4).** **3 of the 85 device-verification rows carry no `needs:`
   tag** (named by line in Q-254); and **Q-49 sits at 🔴 while the public-repo migration it
   describes has happened** — reconciling it wants the owner on what of Phase A remains.

## Blocked

Nothing.

## Claimed paths

None held.

## Do not re-litigate

- **Entry IDs come from per-agent prefixes, not bands** (PR #254) — bands exhausted twice over.
- **The backlog is one file with one global order** — a per-pillar split destroys it.
- **Batches are assigned when an entry is next touched**, never in a bulk pass.
- **Changelog fragments are deferred** — they need codegen across CI, Railway, vitest and local dev.
- **The `/api/sync/pull` fan-out batching fix must not be built.** The pool exhaustion was a symptom
  of event-loop starvation; chunking would have changed nothing. Closed on a production read.

## Gotchas worth carrying

- **Your sweeps are whole-file operations** — the history compaction was done twice (#130, #152).
  List the open PRs before starting.
- **Confirm every completion claim against a merged diff or a production read, never the entry's own
  text** — ten of seventeen did not survive it.
- **An entry's re-check condition is nobody's job unless a sweep does it.** Q-270 asked to be
  re-read "in a day or two"; five days on nobody had, and the fix had not taken.
- **A blocker written as prose is not a blocker.** Q-184 and Q-204 each said in their own body that
  they were held, and both read READY until the prose became `Needs:`.
- **Archiving a Known Issue breaks its relative links** (`docs/reviews/…` → `../reviews/…`), and an
  archived heading naming a still-live ID trips the duplication check. `check:rules` catches both.
- **`total_count: 0` minutes after opening a PR is a stale base, not slow CI.** Fetch, merge, push.
- **Never hand-splice a backlog conflict** — queue position is priority. Take `--ours` and re-insert.
