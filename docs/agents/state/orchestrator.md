# 🪐 Orchestrator — baton

> **Successor sessions are titled `🪐 Orchestrator 🟢`** — exactly, emoji included. A renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-09-01 · **By:** the LB-12 lane-sweep session · **Next ID:** `OR-101` (`OR-100` is
live; the original `OR-1` was withdrawn as a duplicate of BF-23, so 1–99 were never used)

## Now

**PR open on `docs/owner-decisions-round2`; merge when green.** A full sweep of all eleven
`Gate: owner` entries in two rounds. **The queue now holds ZERO unanswered owner questions.** Gates
11 → 7, and each of the 7 is a decision made (`Q-1b`, `Q-149`), an action deferred to a later batch
(`Q-11`, `Q-71`), an accepted action (`Q-4`), an explicit hold (`Q-551` — do not re-ask until Q-545),
or a stop sign (`TN-16`). **Do not re-put any of them to the owner.**

**`Q-149` is the one to read.** Its own two premises were falsified against production: the chest
strap is the dominant HR source (156 rows to the ring's 39; 88% coverage to 54%) and the "~7
verdicts" figure was stale at **84**. Mean peak 99 bpm, so the textbook 15 bpm bar fails **76%** of
this owner's sets. Answer is *fit it to the user*; re-gated on signing the number Tuning proposes.

## Next — in this order

1. **Merge the open PR**, then re-run both lanes and confirm the sections match this baton.
2. **OR-100** — split the four `KEEP`-hidden builds (`Q-519`, `Q-300`, `Q-491`, `Q-403`) into their
   own entries with `Needs:` at the shipped half, then add the check. Lane A's, and it is queued.
3. **The device checklist is written** — `device-verification-queue.md`, all 39, one sitting. Chase
   the results; do not re-derive it.
4. **Sweeps 2 and 4, unrun** — `Q-49` is 🔴 over a migration that happened; 44 foldable entries.

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

- **The clone is shallow** (`git fetch --deepen=300 origin main` first) and **`total_count: 0`
  minutes after a push is a stale base, not slow CI** — fetch-deepen-merge-push fixes both.
- **A baseline raise computed before a rebase is a guess** — measure after merging `main`.
- **The two conflict files resolve in OPPOSITE directions and look identical.** History is
  append-only (keep both sides); backlog conflicts are two *deletions*, where keeping both
  resurrects shipped entries. Read the headings.
- **Your own prose can defeat `next-item.js`** — a `⛔` anywhere in a body parks the entry; one
  session re-parked `Q-250` by writing the character inside the note explaining it.
- **`Gate: device` means SHIPPED and awaiting a check — never "will need one when built."** Already
  in the field rules with three outbreaks; `LA-45` was a fourth. Unbuilt work gets a **Verification**
  line, not a gate.
- **Confirm a completion claim against a merged diff or a production read**, never the entry's own
  text — ten of seventeen failed that in sweep 1.
- **A blocker written as prose is not a blocker** — `TN-16`'s "NOT SIGNABLE" was prose for weeks
  while the runner offered it as READY. Convert to a field on sight.
- **`pnpm check:rules` is the only custom-rules gate**; quote its `Ran N of N` (67 of 67 here).
