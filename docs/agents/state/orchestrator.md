# 🪐 Orchestrator — baton

> **Successor sessions are titled `🪐 Orchestrator 🟢`** — exactly, emoji included. A renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-10-04 · **By:** the device-pass rounds session · **Next ID:** `OR-117`
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

## ⛔ EVERY LANE STOPPED ON 2026-10-01 — read this before planning anything

**Measured 2026-10-04:** commits per day ran **98 · 64 · 113 · 70 · 42** through 09-26→09-30, then
**6 on 10-01 and ZERO on 10-02, 10-03, 10-04.** The sessions are not running. Nothing in the queue
is wrong; there is simply nobody working it.

**What that cost, and it is not nothing:** six PRs were left open mid-flight and **four have since
gone un-mergeable against a moving base** — including **three the owner had already approved on
2026-09-28** (`#1847`, `#1849`, `#1902`). Filed as `OR-207` with the order to rescue them in.
**Auto-merge does not resolve conflicts**, so an approved PR with nobody watching it decays.

**The restart is the owner's** — each role is a session he opens, and Device Verification must be
opened locally with the S25 attached. Until then the queue only accumulates.

## ⚠ LANE B IS STARVED — 0 READY, and the unblock is the phone

`next-item.js --lane B` returns **READY (0)**: 113 entries, of which **83 carry a `Keep:`** — work
that SHIPPED and is owed a device look — and 20 are blocked by a `Gate:` or a `Needs:`. A Lane B
session opened today would have nothing to start.

**So the device sitting is not one owner action among four; it is the thing that unblocks an entire
lane.** Everything else Lane B could do is already done and waiting to be looked at. Plan
[`docs/device-sitting-plan-2026-09-28.md`](../../device-sitting-plan-2026-09-28.md).

Lane A (41 READY), O (62), T (23) and DV (17) are all healthy and can start immediately.

## ⚑ A GATED ENTRY USUALLY BUNDLES BUILDABLE WORK WITH ONE OWNER QUESTION — split, don't wait

**Six entries examined, five split (2026-09-28 → 10-05).** `Q-72`, `PS-31`, `RV-65`, `PS-28`,
`PS-36` each carried a `Gate: owner` naming **one** item while parking **everything else in the
entry** — work that was never the owner's and could have started weeks earlier. Splits:
`OR-204`, `OR-205`, `OR-209`, `OR-210`, `OR-211`.

**The three shapes the buildable half takes**, so it can be recognised rather than rediscovered:
1. **A standing rule already decides it.** `PS-31`'s confidence value gating `source`; `PS-28`'s
   chat tool re-banding ACWR. Both are `CLAUDE.md` violations, not preferences.
2. **It is plain correctness.** `PS-36`'s `sex:'other'` halving VO2max; a best pace with no
   distance floor.
3. **It is the measurement the owner's question depends on.** `RV-65` says *"ship the measurement
   first"* and then gated itself on the removal, so the measurement sat behind a decision that
   cannot be taken until it exists.

**Do NOT ungate the parent to free the half** — that puts an owner question back in the READY list
as though it were buildable, the inversion `CLAUDE.md` warns about. Split, give the parent a
`Needs:` on the split, and leave its gate naming the one item it really covers.

**The counter-case stands and keeps this honest:** reading six gated entries in full on 2026-09-28
found **five correctly gated**. The gate is usually right about *whether* the owner is needed and
usually wrong about *how much* it parks. Read the whole entry, not just the field.

## Session-start reads — last taken 2026-10-04

All three run. **Feedback: 0 rows** (none of the owner's — the watermark above does not move).
**Faults: ZERO non-`bf110` events in 7 days.** **Size: 263 MB** — +2 MB in 5 days, **0.4 MB/day**.
**That retires `OR-203`'s alarm:** it was filed at 4.8 MB/day and the rate did not persist, which
its own caveat predicted. Part of the low figure has a cause — `rr_intervals` has written nothing
since 2026-09-28 (`OR-208`), while the ring tables wrote today.

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

**⚠ THAT SHAPE ESTIMATE DID NOT SURVIVE READING — corrected 2026-09-28 (Orchestrator).** The line
here used to say the remaining gated entries were *"~29 calibration … ~25 engineering calls wearing
an owner gate, the rest product preference"*, and invited the next session to go and unpark them.
**A sample of six was read in full — `PS-41`, `PS-44`, `TN-2`, `TN-33`, `LA-95`, `BF-134` — and
FIVE were correctly gated.** Do not plan a bulk unpark on the old estimate.

**The trap that produced the wrong guess, and it is worth knowing before reading any gated entry:**
**a ✅ recorded owner decision inside an entry does NOT mean its gate is stale.** The gate usually
names a *different* question from the one that was answered, and it says so in the field — which is
the part to read. This session read the ✅ line on `PS-41`, concluded the gate was eleven days
stale, wrote the unpark, and only then read the field: *"NOT the tester question, which he settled
on 2026-09-17 … there is no precedence ladder to slot into. That is what needs his answer."* The
edit was reverted before it shipped. `TN-2` is the same shape — its ✅ sign-off covers the
*direction*, while the gate is waiting on the owner to supply the `.constants.json` set.
**Read the `Gate:` field itself. The ✅ lines above it are not evidence about it.**

**Count is now 34, down from 76.** The one genuine defect the sample found was `BF-134`: it and
`LA-180` both decide what number the day's calorie budget opens at, **neither referenced the
other**, so the same decision sat queued twice and could have been answered twice, differently.
`BF-134` now carries `Needs: LA-180` instead of its own gate.

**Two owner ACTIONS are buried in gated entries and are easy to miss when listing what he owes** —
neither is a question, so neither shows up as one: `TN-2` needs him to supply the `.constants.json`
set (absent from the repo since Q-49 and from every container), and `PS-44` needs a week of
chest-strap-to-bed data he already agreed on 2026-09-17 to record.
