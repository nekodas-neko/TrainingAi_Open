# Orchestrator 🪐 — baton

> **Successor sessions are titled `Orchestrator 🪐`** — exactly, emoji included. A renamed successor
> is a lost thread even with a perfect baton.

**Updated:** 2026-08-20 · **By:** the session that ran sweep 1 · **Next ID:** `OR-1`

## Now

Nothing in flight. **Sweep 1 (completed work) is done**; `COMPLETED_HEADING_BASELINE` is
`new Set([])` and stays shrink-only. Detail:
[`entries/2026-08-20-orchestrator-sweep-completed-work.md`](../../overview/entries/2026-08-20-orchestrator-sweep-completed-work.md).

**Seven of the seventeen were actually finished.** Three had shipped their code and still owed the
owner an action. **Seven had never finished at all** — a heading announcing a diagnosis, one half of
the work, or a fix production later refuted. That is why the check exists.

## Next — in this order

1. **Aggregation (sweep 2).** 204 entries, **4 carry a `Batch:`** — still only the two seeds.
   `docs/agents/README.md` §3 holds the measurements that decide the axis. **Start with the ~20
   native entries**: each is an APK cycle, the priciest verification the owner performs.
2. **Lane and readiness (sweep 3).** One `Lane: ?` (`PS-4` — may legitimately stay `?`). Four prose
   `⛔` markers left for a human read: `Q-529`, `Q-49`, `Q-3b`, `Q-1b`. Queue now carries 4 `Needs:`
   and 20 `Gate:`.
3. **Docs against reality (sweep 4).** Two leads sweep 1 surfaced and did not take: **3 of the 85
   device-verification rows carry no `needs:` tag**, named by line in Q-254,
   and **Q-49 sits at 🔴 while the public-repo migration it describes has happened** —
   this repo is the public one. Reconciling it probably wants the owner on what of Phase A remains.

## Blocked

Nothing.

## Claimed paths

None held.

## Do not re-litigate

- **Entry IDs come from per-agent prefixes, not bands** (PR #254) — bands exhausted twice over.
- **The backlog is one file with one global order.** A per-pillar split destroys the single priority
  order that makes "take the top item" work.
- **Batches are assigned when an entry is next touched**, never in a bulk pass.
- **Changelog fragments are deferred** — they need codegen across CI, Railway, vitest and local dev.
- **The `/api/sync/pull` fan-out batching fix must not be built.** The pool exhaustion was a symptom
  of event-loop starvation; chunking would have changed nothing. Closed on a production read.

## Gotchas worth carrying

- **Your sweeps are whole-file operations.** The history compaction was done in duplicate twice
  (#130, #152). List the open PRs before starting.
- **Confirm every completion claim against a merged diff or a production read, never the entry's own
  text.** Ten of seventeen did not survive it. `grep` the named file and line, run the named test,
  read `claude_ro` for anything framed as a production question.
- **An entry's own re-check condition is nobody's job unless a sweep does it.** Q-270 asked to be
  re-read "in a day or two"; five days later nobody had, and the fix had not taken.
- **Archiving a Known Issue breaks its relative links** (`docs/reviews/…` → `../reviews/…`), and an
  archived heading naming a still-live ID trips the duplication check. `check:rules` catches both.
- **`total_count: 0` minutes after opening a PR is a stale base, not slow CI.** Fetch, merge, push.
- **Never hand-splice a backlog conflict** — queue position is priority. Take `--ours` and re-insert.
