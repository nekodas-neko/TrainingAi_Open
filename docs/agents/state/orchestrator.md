# 🪐 Orchestrator — baton

> **Successor sessions are titled `🪐 Orchestrator 🟢`** — exactly, emoji included. A renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-09-15 · **By:** the device-pass rounds session · **Next ID:** `OR-117`
(`grep -rhoE '\bOR-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## Now

**Five rounds of owner device-checks are done** (OR-111→118); 81 answers, 30 entries left the queue.

**The checklist is a published artifact with a `db` capability** — read answers back with
`Artifact action:read_db`, collection `checks`, never by asking for an export. Its `CHK-*`/`R5-*`
ids are composites covering several entries.

**Ask the owner nothing that is not genuinely theirs.** ~35 entries still carry an unchecked
`Gate: owner`; most are engineering calls, Tuning's calibration, or measurements to take first.
**Eight are marked NOT OWNER-READY** (OR-117) — finish that pass.

## Next — in this order

1. **Re-triage the ~48 `Gate: owner` entries.** Each is owner's, mine, Tuning's, or needs a
   measurement before anyone can answer. Most are not the owner's.
2. **Two owner actions are accepted and deferred, not done** — `BF-106` (`VACUUM FULL`;
   `oura_raw_samples` is 74 MB, 44 MB of it index) and `LB-52` (classic branch protection beside the
   Ruleset, so auto-merge stops being hand-caught). Re-offer them, do not re-argue them.
3. **`OR-115`** — inventory the admin surface before deleting anything from it.

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
  append-only (keep both sides, main's first); a backlog conflict is two *deletions*, where keeping
  both resurrects shipped entries. **`.size` files are recomputed after the merge, never spliced.**
- **A finished entry that still advertises is as bad as a blocked one mislabelled.** `keepIsSettled`
  checks both — and **a look that came back FAILED counts as settled**, which the first version
  missed, hiding TN-13 and BF-74 as "shipped, a look owed" while they held live work.
- **A failing device check can move the lane** — TN-13 went A→B: the defect was in the render condition, not the helper the entry named.
- **Your own prose can defeat `next-item.js`** — a `⛔` anywhere parks the entry, and a bullet merely
  *quoting* a `Verify:` field fails the parser.
- **Confirm a completion claim against a merged diff or a production read**, never the entry's own
  text — ten of seventeen failed that in sweep 1.
- **`check:rules` is the custom-rules gate, NOT the pre-push gate — `pnpm ci:local` is** (it adds
  lint, typecheck and **test**). Running only `check:rules` on a backlog-only PR turned `main` red
  for every lane (#1247, 2026-09-16): restructuring Q-305's `Keep:` removed a gate that
  `keep-gate-set-off.test.ts` pins **by name**. **A queue restructure is a code change to those
  tests.**
