## 2026-08-17 — the standing-agent model, and six findings from actually using the app

**Branch:** `claude/docs-review-agent-setup-3ocl7m` · **Domain:** `platform` (also `devices`,
`sleep`, `app-shell`) · **PRs:** #12, #14, #19, #22 merged; #26 open.

Session wrap. Full narrative in
[`docs/handoff-2026-08-17-platform-agent-model-and-device-session-findings.md`](../../handoff-2026-08-17-platform-agent-model-and-device-session-findings.md).

### What was asked for, and what it turned into

Two housekeeping requests — review and reorganise the documentation, and write an operating model
for four agents meant to run continuously. Both delivered in #12. The second half of the session
was unplanned: taking the app through a real APK reinstall and Oura re-sync, which produced more
findings than the review did.

### The model

`docs/agents/README.md`, five cold-start prompts, five batons, rules in `CLAUDE.md`. Three
decisions carry it: **only the Implementation lanes write code** (so the collision surface across
five concurrent sessions is Lane A against Lane B, and everything else merges freely); **the lane
seam is file ownership rather than subject**, because file ownership is what actually causes
conflicts; and **Q numbers come from per-agent bands**, because the shared pointer is a floor that
cannot see an unmerged PR.

That last one was validated the hard way within hours. The bands prevented **every** collision
between standing agents. **Both** collisions that occurred came from one-off sessions drawing on
the shared pointer — Q-311 against #9, and Q-530 against #25. Each was caught by
`check-backlog-pointers` on its first run after the merge, which is what it was written for. The
gap is real and unclosed: the bands cover the five standing roles and leave planning sessions on
the old failure mode.

### The cleanup

`projectOverview.md` 9,647 → ~6,300 lines (157 dated status notes archived; its version claim was
14 releases stale). Backlog header 397 → 48 lines, of which 268 were one nested `Previously N`
chain hiding three live pointers that were all wrong — the migration pointer 11 behind, SQLite 4
behind, and two duplicate Q numbers. 498 journal entries compacted into nine history files against
a documented threshold of 20. `agents.md` reduced to a pointer after drifting into contradicting
`CLAUDE.md`.

Two CI guards make the rot fail rather than accumulate, both mutation-tested. They have since
caught two real collisions on other agents' PRs and a stale baseline on #13.

### What using the app found

| | |
|---|---|
| **Q-536** | 43 of 82 nights show midday bedtimes. **Ring clock-epoch collision** — epoch 3 was created at 06:58 by the reinstall, its `ds` range overlaps epoch 2's. Handed to Lane A, top of queue. |
| **Q-534** | Production hit `pg 53100` `disk_full`. **291 MB of `oura_raw_samples`' 466 MB is index, not data**, and autovacuum has never run on the table. |
| **Q-535** | Redecode reports `failed: 502` for work that succeeds — the request outlives the platform timeout while the off-loop work completes. |
| **Q-537** | An uninstall destroys the ring key. It exists only in SharedPreferences; there was no other copy. |
| **Q-531/532** | Owner feedback: Q-234's console relocation made these screens worse in use; the BLE screen re-centres during scans. |
| **Q-533** | The drain already runs unattended — only its *ending* is missing. |

### Corrections made during the session, kept because they are the useful part

- **The `hrv_event` shortfall was a misreading.** Flagged 867 rows / 41 days as "a fifth of
  expected"; the drain data showed `hrv_event` tracks `sleep_acm_period` exactly, both being
  sleep-derived. Withdrawn.
- **The sleep-window diagnosis was wrong first time.** Timezone double-conversion was the obvious
  shape and the epoch evidence superseded it. Q-536 carries both, corrected, because the wrong
  hypothesis is the one a reader will otherwise re-derive.
- **The emulator job was merged before it could work.** `getLocalStore` requires a signed-in user,
  so its assertion could never pass. Disabled rather than left permanently red.

### Not exercised

No application code changed in any merged PR. The Oura re-sync path *was* exercised on the S25 —
694 batches, `bytesLeft=0`, device and server cursors matched at ds 37,138,611. The emulator
assertion has never run. **The agent model is unproven**: no session has run start to finish from
one of the five prompts, and the lane tie-break for unlisted paths has never been tested under
contention.
