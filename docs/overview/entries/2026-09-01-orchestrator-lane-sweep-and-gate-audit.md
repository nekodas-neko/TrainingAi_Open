# 2026-09-01 — the lane sweep lands, and four entries were stuck on a field rather than the work

Branch `docs/bf55-owner-decision` (PR #713), after `docs/lane-sweep-lb12` (#708). Both docs-only.

## What prompted it

The owner asked whether every task now has a lane, because **Lane B was reporting no work**. It
does — the sweep left zero `⟨lane unstated⟩` rows in READY for either lane — and the honest first
answer was that Lane B going 32 → 8 is the real number, not a regression: the 32 was inflated by
unlabelled entries the runner showed to *both* lanes.

That answer was half right, and chasing the other half is what this session found.

## Four entries could not be started for reasons that were not about the work

- **`Q-250`** — an Android emulator job in CI, the entry that closes **17 device-gated rows** —
  carried `Gate: device`. It was parked behind the exact bottleneck it exists to relieve. Nothing in
  it needs a phone: the assertion runs on a GitHub `ubuntu-latest` emulator against a seeded local
  Postgres. It then parked a **second** time on a `⛔` in its own prose, and a third time when the
  note explaining that hazard contained the character it was explaining. Now Lane A READY.
- **`LB-37`** asked outright for a number before its shape could be chosen, and said a session that
  measures without recording leaves the next to measure again. **282 errors across 83 test files**
  are hidden by `tsconfig.json`'s `"**/__tests__/**"` exclusion — 289 raw against a 7-error sandbox
  baseline, none of which is in a test file, so the split has no false positives. `TS2493` ×50 and
  `TS2741`/`TS2739` ×53 are both *the fixture drifted from the type it stands in for*, and
  `lib/__tests__/ai-dynamic.test.ts` imports a module that does not exist. That settles it as a
  ratchet, not a one-PR fix. `tsconfig.json` is unchanged — the exclusion was neutralised only to
  measure, and restored.
- **`Q-187`** sat in UNCLASSIFIED where both lanes saw it and neither could start, because its lane
  *is* the pending decision. Gated on the owner with a recommendation attached.
- **`LA-45`** — the DEXA-corrected body fat that no screen reads — carried `Gate: device` on
  **unbuilt** work. The backlog's own field rules already forbid exactly this, in terms, with three
  recorded outbreaks. This was a fourth. Now Lane B READY #2, which matters: the Health screen shows
  25.3% while the calorie goal is already computed from 28.5%.

## The finding that changes the picture

`Gate: device` on unbuilt work is documented. **`Keep:` was not documented at all**, and it routes
an entry into a section headed *"shipped; only the stated residue is owed. Not new work"*.

Measured on Lane B's twelve `KEEP` entries: five are device checks and belong there, one is an owner
call, one says outright *"nothing to build"* — and **four are builds**. `Q-519`'s entire UI half sits
there, fully specified, with its engine half shipped in migrations 233/234 and nothing able to write
a bedtime because there is no control. So **Lane B's real buildable depth is ~13, not the 9 READY
reports.**

Same mechanism as the gate, one section over: a field written to mean *partly done* is read by the
runner as *do not start*. `Keep:` is now specified where entries are written, and **OR-100** carries
the fix — split the residue into its own entry per the existing two-entry rule, then enforce it.
Routing `KEEP` into READY was considered and rejected: it would surface four and bury seven, and
READY would stop meaning startable.

## Also landed

`BF-55`'s owner gate cleared. Both of the owner's stated conditions were re-verified against
production rather than resting on the 2026-08-30 reading: `oura_heartrate_user_updated` reads
`idx_scan` **0** and `idx_tup_read` **0** at **20 MB**, while a sibling index on the same table shows
**40,195 scans / 18.6 M tuples** — so the planner never chooses it, on a table that is not quiet.
`getOuraTimeseriesDelta` has no caller. Handed to Lane A without a migration number.

**The entry's own warning held and is worth repeating:** `rr_intervals_pkey` read `idx_scan` 0 on
2026-08-30 and reads **5,034** now. `idx_scan` counts reads, not constraint enforcement. Drop that
one index and nothing else from that table.

## Not done

The device pass. **35 entries are shipped and waiting only on the S25 smoke run**, 13 of them
`[nutrition]` — the largest single blocker in the queue, and the only one the owner can clear in one
sitting. Sweeps 2 and 4 remain unrun.
