# 2026-09-27 — `projectOverview.md` 309 KB → 17 KB, and four entries from an outside architecture review

**Branch:** `chore/compact-project-overview-status` · Orchestrator

An outside contributor (jsboiss, relayed by the owner) reviewed the agent architecture and argued
three things: move the task queue out of git into blob storage, merge the separate agents into one
long-running workflow, and run on a persistent server instead of rebuilding the environment each
session. Measuring the claims is what produced this PR — the largest cost turned out to be somewhere
none of the three proposals touched.

## What the measurement said

| Read by **every session of every role**, before any work | Was |
|---|---|
| `projectOverview.md` | **309 KB** |
| `CLAUDE.md` | 120 KB |
| `docs/agents/README.md` | 52 KB |

**292 KB of the 309 KB was one section**, `## 🔖 Current Status`, and none of it was status. It was
a reverse-chronological changelog — 281 per-PR narrative paragraphs — living inside the one document
every agent reads before it can start.

The blob-storage proposal targets a cost that is not there: agents never read the 2.7 MB queue into
context, because `next-item.js` parses it out of band and prints about ten entries. Moving the same
bytes elsewhere saves no read tokens and costs the CI-enforced invariants (no dependency cycles, no
duplicate IDs, no completed entry left in the queue), git's conflict detection on concurrent edits,
and the history of why an entry changed. Declined, with the reasoning in the chat and the parts
worth keeping filed below.

## The compaction

**Relocated, not curated.** The whole narrative block moved whole to
[`docs/overview/history-2026-09-27-status-narrative.md`](../history-2026-09-27-status-narrative.md).
Nothing was edited, summarised or dropped.

That was a deliberate choice against the obvious one. Of the 281 paragraphs, **152 end in a pointer
to a journal entry that still exists** — for those this was a second copy. **129 carry no pointer at
all**, so `projectOverview.md` was their only record. Sorting 281 paragraphs into keep-and-delete
buys exactly the same token saving as moving them all and is where a mistake would be permanent, so
the duplicated half stays for a later sweep inside the archive, where it costs no session anything.

**Result: 2,812 lines → 179. 309 KB → 17 KB.** The baseline was tightened to match rather than left
slack. What remains is the version header, the five real status subsections (Security, Local-first
reads, Derived-score read paths, Device-only, Nice-to-have) and the Document Map.

**178 relative links were rewritten.** A link written from the repo root resolves differently from
`docs/overview/`; `check-doc-links` reported three and the fix was applied to all 178, the same class
as the known-issues move earlier this month.

## A defect found by moving the file

One `Detail:` pointer was stale: `LB-158`'s cited an entry that `fold-journal-entries.js` had already
folded into a batched history. **The fold moves files and rewrites nothing that cites them**, and
because these are bare paths in backticks rather than markdown links, `check-doc-links` structurally
cannot see them — it reported OK on the same file. 1 of 152 is a low enough rate to be trusted and
quiet enough to spread. Fixed here; the mechanism is `OR-198`.

## Filed

- **`OR-194`** — three guards a persistent local environment needs first: separate working copies,
  per-lane databases (`setup.sh` hardcodes one port and one name), and a re-create-from-migrations
  rule. The third is the sharp one: the `claude_ro` view generator reads the dev database, and
  generating against a drifted one silently drops columns from the security views. The fresh clone
  is what makes that impossible today.
- **`OR-195`** — move **Lane A only** to a local persistent session. The argument is capability, not
  speed: Lane A owns `android/**` and cannot build it, because the sandbox has no Android SDK.
  Lane B stays in the cloud as a control group.
- **`OR-196`** — docs-only PRs run the full suite. The obvious `paths-ignore` fix would leave the
  required checks "Expected" forever and block every merge; the workflow's own comment already says
  so. Needs a no-op job publishing the same names, and a before/after measurement.
- **`OR-198`** — the fold-breaks-pointers mechanism above.

## Not done, deliberately

The 152 duplicated paragraphs still sit in the archive. `CLAUDE.md` (120 KB) and
`docs/agents/README.md` (52 KB) are now the largest fixed reads and are the obvious next targets —
`CLAUDE.md` was already taken from 1,061 to 937 lines this month.

**Not exercised:** documentation only, no code changed and no runtime surface touched. Gates at
close: `Ran 83 of 83` Custom Rules, `check-doc-links: OK (891 files)`,
`check-backlog-pointers: OK — 553 entries`.
