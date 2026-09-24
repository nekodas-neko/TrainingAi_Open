# 🪐 Orchestrator — baton

> **Successor sessions are titled `🪐 Orchestrator 🟢`** — exactly, emoji included. A renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-09-15 · **By:** the device-pass rounds session · **Next ID:** `OR-117`
(`grep -rhoE '\bOR-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.)

## In-app reports — the triage watermark

**Last triaged:** `1970-01-01T00:00:00Z` — nothing has been triaged yet, and nothing is owed.
**A report with `created_at` after this line is untriaged.** Move it only once every report above it
has become a backlog entry or been recorded as not-a-defect with its reason.

Read them with the query in CLAUDE.md's session-start list (`claude_ro.feedback_submissions`). The
loop: **read → review → file at the right priority with a lane → move this timestamp.** Never reply
to a report as the whole answer; the queue is what outlives the session.

**Measured 2026-09-23:** the view returned **0 rows** while the table's lifetime `n_tup_ins` was
**1** — the view is row-scoped to the owner, so that one report is someone else's and is invisible
here by design. So *"no reports"* means **none of the owner's**, and the feature has effectively
never been used. That is the reason the owner chose a watermark over a status column: a migration
and a Lane B surface is a lot of machinery for a feature with one lifetime submission, and this
costs nothing to abandon.

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

## Owner-gate triage — where it got to (2026-09-24, OR-143/OR-144)

76 entries carry `Gate: owner`. Seven of them were `Lane: O` as well, which PARKS them out of the
Orchestrator's own READY list — the exact inversion CLAUDE.md now warns about. Four were ungated in
OR-144 (`RV-113`, `BF-92`, `BF-24`, `Q-395`): each is genuinely the owner's judgement, and in each
case nobody had put it to him, so the gate was what stopped it being asked.

Three keep their gate correctly: `BF-106` (acknowledged, deferred, his action), `LB-52` (asked
2026-09-24, he parked it ~5 h), `Q-551` (explicitly *"do not re-put this"* until Q-545 lands).

**Owed, deliberately not done in OR-144:** the four sit at ranks 23, 40, 41 and below the cut, and
CLAUDE.md says an owner question belongs near the top of `O`. Physically moving entries is the
highest-conflict edit possible on the backlog, so it is its own pass rather than a rider on the
ungate — doing both together risked losing both.

**Also owed:** the other 69 gated entries are triaged only as a shape (~29 calibration that should
arrive as a Tuning proposal, ~25 engineering calls wearing an owner gate, the rest product
preference). Each still needs reading before it moves.
