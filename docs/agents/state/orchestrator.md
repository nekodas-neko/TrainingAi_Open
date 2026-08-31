# 🪐 Orchestrator — baton

> **Successor sessions are titled `🪐 Orchestrator 🟢`** — exactly, emoji included. A renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-09-01 · **By:** the LB-12 lane-sweep session · **Next ID:** `OR-101` (`OR-100` is
live; the original `OR-1` was withdrawn as a duplicate of BF-23, so 1–99 were never used)

## Now

**PR #713 is open, docs-only; merge when green.** It began as BF-55's owner-gate clearing and grew
to unblock four entries — its body lists them. Nothing else in flight. The queue reads **238 entries
· Lane A 67 READY · Lane B 9 READY · 1 UNCLASSIFIED** (`PS-4`, correctly so).

**"B is still saying there is no work for it" has two answers.** The sweep (#708) took Lane B 32 → 8
honestly — the 32 was unlabelled rows shown to *both* lanes, and the queue really is mostly engine
work. But **OR-100** is a defect: four of Lane B's twelve `KEEP` entries are builds, so its true
buildable depth is ~13.

## Next — in this order

1. **Merge #713**, then re-run both lanes and confirm the sections match this baton.
2. **OR-100** — split the four `KEEP`-hidden builds (`Q-519`, `Q-300`, `Q-491`, `Q-403`) into their
   own entries with `Needs:` at the shipped half, then add the check. Lane A's, and it is queued.
3. **The device pass is the largest single blocker** — **35 entries** shipped and waiting only on
   the S25 smoke run, 13 `[nutrition]`. Put it to the owner as one batch, not entry by entry.
4. **Sweeps 2 and 4, still unrun.** `Q-49` sits at 🔴 describing a public-repo migration that has
   already happened; **44 foldable journal entries** against a 20-file chore threshold.

## Do not re-litigate

- **Entry IDs are per-agent prefixes, not bands** (PR #254); **the backlog is one file with one
  global order**; **the `/api/sync/pull` fan-out batching fix must not be built** (closed on a
  production read).
- **Heart rate has not made session RPE redundant for energy** (Q-420, owner correction) —
  `corr(avgBpm, mean set RPE) = +0.083` across 44 sessions. Combine, never override. The combining
  formula stays unpicked deliberately — it needs Q-422's fit, not a number chosen in chat.
- **`oura_heartrate_user_updated` is approved for dropping**, Lane A owns the migration, and **only
  that index** — `rr_intervals_pkey` read `idx_scan` 0 in August and 5,034 now, because `idx_scan`
  counts reads, not constraint enforcement.

## Gotchas worth carrying

- **The clone is shallow** (`git fetch --deepen=300 origin main` before any merge) and
  **`total_count: 0` minutes after opening a PR is a stale base, not slow CI** — both hit every
  session; the fix for both is fetch-deepen-merge-push.
- **A baseline raise computed before a rebase is a guess** — measure after merging `main`.
- **The two conflict files resolve in OPPOSITE directions and look identical.**
  `doc-size-baseline-history.md` is append-only, so keep both sides; `implementation-backlog.md`
  conflicts are two *deletions*, where keeping both resurrects shipped entries. Read the headings.
- **Your own prose can defeat `next-item.js`** — a `⛔` anywhere in a body parks the entry. This
  session re-parked `Q-250` by writing the character inside the note explaining it. Re-run the lane
  query after every edit.
- **`Gate: device` means SHIPPED and awaiting a check — never "will need one when built."** Already
  in the backlog's field rules with three outbreaks; `LA-45` was a fourth. Unbuilt work that will
  need a device gets a **Verification** line, not a gate.
- **Confirm a completion claim against a merged diff or a production read**, never the entry's own
  text — ten of seventeen failed that in sweep 1.
- **A blocker written as prose is not a blocker** — `TN-16`'s "NOT SIGNABLE" was prose for weeks
  while the runner offered it as READY. Convert to a field on sight.
- **`pnpm check:rules` is the only custom-rules gate**; quote its `Ran N of N` (67 of 67 here).
