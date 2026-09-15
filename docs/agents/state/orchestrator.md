# 🪐 Orchestrator — baton

> **Successor sessions are titled `🪐 Orchestrator 🟢`** — exactly, emoji included. A renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-09-15 · **By:** the device-pass rounds session · **Next ID:** `OR-117`
(`grep -rhoE '\bOR-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## Now

**Five rounds of owner device-checks are finished and filed** (OR-111→116, PRs #1167/1169/1171 and
this one). 81 answers via the checklist artifact; **30 entries left the queue**. Queue **326**,
`Verify: device` **31 → 20**.

**The checklist is a published artifact with a `db` capability** — read the answers back with
`Artifact action:read_db`, collection `checks`, rather than asking for an export. Round five is the
live version: 5 items, all answered. Its ids `CHK-*`/`R5-*` are composites covering several entries.

**Ask the owner nothing that is not genuinely theirs.** ~48 entries carry `Gate: owner`; most are
engineering calls, Tuning's calibration, or measurements to take first. That re-triage is the next
real Orchestrator job and is NOT done.

## Next — in this order

1. **Re-triage the ~48 `Gate: owner` entries.** Each is owner's, mine, Tuning's, or needs a
   measurement before anyone can answer. Most are not the owner's.
2. **Two owner actions are accepted and deferred, not done** — `BF-106` (`VACUUM FULL`;
   `oura_raw_samples` is 74 MB, 44 MB of it index) and `LB-52` (classic branch protection beside the
   Ruleset, so auto-merge stops being hand-caught). Re-offer them, do not re-argue them.
3. **`LB-94`/`LA-100` — the journal ceiling.** `fold-journal-entries.js` rewrites citations and took
   345 → 60; unrun since. 4. **`OR-115`** — inventory the admin surface before deleting from it.

## Do not re-litigate

- **Entry IDs are per-agent prefixes, not bands**; the backlog is one file with one global order.
- **`Q-1b` is deferred to a v2 milestone** (owner, three times). Bundling buys **~0.44 s, cold open
  only** — 439 ms of a 472 ms paint is the Railway round trip. Do not re-put it before v2.
- **The calorie anchor is settled** (BF-152) and confirmed on the S25 2026-09-15.
- **`PS-4` stays `Lane: ?`** — each role rewrites its own baton; a sweep set `Lane: O` and reverted.
- **No web-UI checks go to the owner** — the APK is the only surface they use.

## Gotchas worth carrying

- **The clone is shallow** (`git fetch --deepen=1000 origin main` first) and **`total_count: 0`
  minutes after a push is a stale base, not slow CI**. Under concurrency the base goes stale *while
  you work*: three re-merges in one morning on 2026-09-14. Attempting the merge is the reliable
  green check; `get_check_runs` lags by up to 35 minutes.
- **The two conflict files resolve in OPPOSITE directions and look identical.** History is
  append-only (keep both sides, main's first); backlog conflicts are two *deletions*, where keeping
  both resurrects shipped entries. **`.size` files are recomputed after the merge, never spliced.**
- **A finished entry that still advertises is as bad as a blocked one mislabelled.** `keepIsSettled`
  checks both — and **a look that came back FAILED counts as settled**, which the first version
  missed, hiding TN-13 and BF-74 as "shipped, a look owed" while they held live work.
- **A failing device check can move the lane** — TN-13 went A→B: the defect was in the render
  condition, not the shared helper the entry named.
- **Your own prose can defeat `next-item.js`** — a `⛔` anywhere parks the entry, and a bullet merely
  *quoting* a `Verify:` field fails the parser.
- **Confirm a completion claim against a merged diff or a production read**, never the entry's own
  text — ten of seventeen failed that in sweep 1.
- **`pnpm check:rules` is the only custom-rules gate**; quote its `Ran N of N` (**75 of 75** here).
