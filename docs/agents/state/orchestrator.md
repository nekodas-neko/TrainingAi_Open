# Orchestrator 🪐 — baton

> **Successor sessions are titled `Orchestrator 🪐`** — exactly, emoji included. The title is how six
> concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a perfect
> baton.

**Updated:** 2026-08-20 · **By:** the session that created the role · **Next ID:** `OR-1`

## Now

Nothing in flight. The role was created on 2026-08-20 and has not run a sweep yet.

## Next — in this order

1. **Completed work (sweep 1).** `COMPLETED_HEADING_BASELINE` in
   `scripts/check-backlog-pointers.js` holds **17** queue entries whose heading announces its own
   completion. That is the concrete worklist. Confirm each against a merged diff before removing it,
   and take its ID out of the baseline in the same PR. Three are known to be deliberate keeps rather
   than deletions — `Q-213` says "entry kept only until the prod check", `Q-217` says "owner still
   …", `Q-71` is code-shipped with a historical redecode still owed — so those get a
   `- **Keep:** <what is owed>` line instead. **Do not assume the other 14 are simple**; the heading
   is a claim, not evidence.
2. **Aggregation (sweep 2).** 211 entries, **4 carry a `Batch:`** — the two seeds
   (`calorie-budget-surface`, `scale-weighing-ui`). The measurements that decide the axis are in
   `docs/agents/README.md` §3: 320 files named and only 39 shared, `platform` alone at 106 entries,
   41 migration-touching, 20 native, 18 already-a-sweep. Start with the 20 native entries — each is
   an APK cycle, which is the most expensive verification the owner performs.
3. **Lane and readiness (sweep 3).** One `Lane: ?` outstanding (`PS-4`, baton compaction — it is
   genuinely not one lane's job and may stay `?`). Five entries still carry a prose `⛔` marker and
   were left deliberately because classifying them needs a human read: `Q-529`, `Q-71`, `Q-49`,
   `Q-1b`, `Q-3b`. `next-item.js` prints them with their marker text.

## Blocked

Nothing.

## Claimed paths

None held.

## Do not re-litigate

- **Entry IDs come from per-agent prefixes, not bands** (2026-08-19, PR #254). Bands exhausted and
  their ledger drifted twice. Do not propose reinstating them.
- **The backlog is one file with one global order.** A per-pillar split was proposed and withdrawn:
  it destroys the single priority order that makes "take the top item" work.
- **Batches are assigned when an entry is next touched**, not in one bulk pass over work nobody is
  about to start. That is your job, done repeatedly, not a one-off migration.
- **Changelog fragments are deferred**, not forgotten: `changelog.ts` is 7,129 lines read by five
  call sites, so fragments need a codegen step across CI, Railway, vitest and local dev. Revisit only
  if the ~30% conflict rate still hurts now that the doc-size ratchet no longer conflicts.

## Gotchas worth carrying

- **Your sweeps are whole-file operations.** The history compaction was done in duplicate twice
  (#130, #152) and one PR's work was discarded whole. Check the open-PR list before starting.
- **`get_check_runs` returning `total_count: 0` minutes after opening a PR is a stale base, not slow
  CI.** Fetch, merge `origin/main`, push. This happened three times in one session on the PR that
  created this role.
- **Never hand-splice a backlog conflict.** Queue position is priority, so a bad splice silently
  reprioritises someone else's work. Take `--ours` and re-insert against a fresh anchor.
