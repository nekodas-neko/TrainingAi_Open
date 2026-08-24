# Handoff — 2026-08-24 · Orchestrator's first run

_Domain: `platform` (touches `workouts`, `nutrition`, `sleep`, `readiness`, `activity` via the owner
decisions recorded) · Branch: `claude/orchestrator-sweep-jtehzy` · PR: none yet for this wrap-up —
opened and merged docs-only in the same pass as this doc_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/implementation-backlog.md` (the queue), then
> `docs/agents/README.md` §3 (the lane contract). This file covers only what this session did and
> what it leaves behind.

## Goal

First run of the Orchestrator role (created 2026-08-20, PR #263). Its job is the health of the
queue and the docs, not the app — clear stale completion claims, assign batches, resolve lane
ambiguity, and reconcile docs against reality. This session ran sweep 1 (completed work) and sweep
2 (aggregation), then spent the rest of its time walking the owner through every entry parked on
`Gate: owner`, one question at a time, at the owner's explicit request.

## Current status

- **Build/test:** docs-only session. No `pnpm dev`, no test suite run beyond what
  `pnpm check:rules` and `node scripts/check-backlog-pointers.js` exercise. Both green at every
  commit in this session — re-run and confirmed clean immediately before writing this doc.
- **Device-verified:** N/A — nothing here touches application code, UI, or native paths.
- **Queue state at handoff:** 182 entries (was 201 at session start; other lanes' concurrent work
  also added and removed entries in between — the net is not this session's number alone).
  `check-backlog-pointers` reports 0 baselined done-headings, 14 `Needs:` with no cycles, 24
  `Gate:`, batches `scale-weighing-ux×2`.

## What shipped

All docs-only, all merged to `main`:

- **#269 — sweep 1.** `COMPLETED_HEADING_BASELINE` (17 entries whose heading claimed they were
  finished) worked to `new Set([])`. Only **7 of 17** were actually finished and removable; 3 kept a
  `Keep:` line for an owner action still owed; **7 had never finished at all** — Q-270 was the
  sharpest: marked FIXED FORWARD on 2026-08-15 with its own re-check condition unrun, still 0 of 96
  days five days later. Q-213/Q-107 closed on a production `error_events` read showing all three
  fault families stop dead the day their fix shipped.
- **#305 — sweep 2.** First real `Batch:` (`ring-service-device-pass` — Q-537/Q-533/Q-388, one APK
  instead of three). Found Q-116 and Q-388 were the same investigation filed 11 days apart, neither
  referencing the other; cross-linked with `Needs:`. Converted 3 prose blockers (Q-184, Q-204, and
  later Q-116) into `Needs:` fields — each read READY while its own body said it was held.
- **#327 — the nutrition rework split.** Q-395 (269 lines, sixteen screens, one queue item) split
  into a chain: `Q-406 → Q-395a → Q-395b → Q-395c → Q-395` (checkpoint). Q-406 turned out to be the
  entry point, not the prerequisite it was filed as — its 2026-08-19 correction says the row can't
  be extracted before the design is decided, and the design is now decided. Backlog baseline raised
  11334 → 11377 with the reason recorded in `docs/doc-size-baseline-history.md`.
- **#344 — Q-393 folded into Q-392.** Clearing `Gate: owner` on Q-393 (which turned out to already
  be self-answered) put it directly above Q-392 in the queue and exposed that `mealLabelStyle` was
  already a row in Q-392's table. Two entries, one piece of work — removed rather than unblocked.
  Also carries the **Q-85 decision** (owner walkthrough): compress accessory rest at a Quick budget,
  floor 45s, the main compound untouched.
- **#349 — Q-420, Q-137, Q-287.** Q-420 (session RPE): drop the user-facing prompt, derive intensity
  from set RPEs, and — the owner's correction, not mine — combine it with heart rate rather than let
  HR override it; `corr(avgBpm, mean set RPE) = +0.083` across 44 real sessions, and the code today
  is a hard override where RPE contributes nothing whenever `avgBpm` exists. Q-137 removed (already
  decided and shipped, its own text said to strike it, nobody had). Q-287 (account deletion): all
  seven of its plan's decisions resolved — three by the owner (hard delete, 14-day grace period via
  the same no-cron pattern Q-270 used, refuse deletion for the last admin), three decided directly
  as cheap/reversible/mechanical calls (the big-table delete order, friendship-row deletion, the
  web-accessible path). Also carries **Q-72** (Sleep Score): its real gate had already been answered
  on 2026-08-12 and shipped; what was left was a partial-data flag, now specified against the
  model's own weights (`hr`+`hrv` = 28 of 110, 25%) and the gate cleared.
- **LB-2 declined**, folded into this same PR run: no bulk-delete option for a meal type's food
  logs, move-only stays. Recorded in `docs/domains/nutrition/README.md` under **Decided, and
  deliberately not built** rather than left in the queue.

Journal entries, one per sweep/decision cluster:
[`2026-08-20-orchestrator-sweep-completed-work.md`](overview/entries/2026-08-20-orchestrator-sweep-completed-work.md) ·
[`2026-08-23-orchestrator-sweep-aggregation.md`](overview/entries/2026-08-23-orchestrator-sweep-aggregation.md) ·
[`2026-08-23-orchestrator-q395-phase-split.md`](overview/entries/2026-08-23-orchestrator-q395-phase-split.md) ·
[`2026-08-23-orchestrator-owner-decisions.md`](overview/entries/2026-08-23-orchestrator-owner-decisions.md) ·
[`2026-08-23-orchestrator-q287-decisions.md`](overview/entries/2026-08-23-orchestrator-q287-decisions.md).

## Deliberately NOT done

- **Sweep 3 (lane and readiness) never ran.** `Lane: ?` entries grew **6 → 10** over the session
  (other lanes filed new BF entries concurrently) rather than shrinking. This is the top of the
  next Orchestrator session's list, not an oversight.
- **Sweep 4 (docs against reality) never ran.** Two concrete leads sit unaddressed: **Q-49** is
  still 🔴 in the queue describing a public-repo migration that has already happened (this repo is
  the public one), and **3 of 85 device-verification rows in `projectOverview.md` carry no
  `needs:` tag** (named by line in Q-254).
- **Q-549 (Postgres oversized for its data) and Q-551 (stay on Railway or leave) were explicitly
  not turned into owner questions.** Both need something only the owner can supply — a Railway
  console reading — or are correctly sequenced to wait on other work. Asked directly in chat
  instead of forced into this walkthrough's shape.

## Key decisions (with rationale)

All seven are written into their own backlog entries with full reasoning, not just recorded here.
The one worth restating because it reverses a premise two other entries shared: **heart rate has
not made RPE redundant for workout energy.** Both Q-420 and Q-421 assumed it had; the owner
rejected that (*"HR only depicts cardio/heart rate, not CNS"*), and the measurement backs them —
uncorrelated in 44 real sessions, and the mechanism is structural (`summariseWorkoutHr` averages
across rest periods; Keytel has no anaerobic term). The fix is combination, not override, and the
combining formula is deliberately left unpicked here — it needs Q-422's adaptive-TDEE fit, not a
number chosen in chat.

## Gotchas / what did NOT work

- **The container's clone is shallow, and a normal `git merge origin/main` fails with `refusing to
  merge unrelated histories` when the two histories haven't been deepened past the shallow
  boundary.** Hit three times this session. Fix: `git fetch --deepen=300 origin main` (or more)
  before merging, not a `git pull` or a fresh shallow re-clone.
- **A squash-merged PR can show an entire file as "new" in its own diff** — an artifact of an
  internal `Merge origin/main` commit inside that PR's history being squashed against a later tip,
  not evidence the file was replaced or that data was lost. Hit once resolving a real backlog
  conflict against PR #345: the honest fix was checking what `main` **actually contains** right
  now (`git show origin/main:<path> | grep ...`) rather than trusting that diff, which would have
  read as "everything changed" when nothing had.
- **A backlog merge conflict is (almost always) take `--ours`, but confirm first that the other
  side isn't a genuine independent addition wearing the same shape.** The LB-2 conflict above
  looked identical to an ID collision on first read; it wasn't — `main` simply didn't have this
  session's not-yet-merged decline yet. Check `git log --oneline origin/main -- <path>` for what
  actually landed before resolving, not just the marker text.
- **My own prose can defeat the tooling I'm trying to fix.** A `⛔` written in an entry's prose
  during the Q-420 rewrite was read by `next-item.js` as a blocker marker, parking an entry I'd
  just unblocked. The tool was right; the marker was mine. Worth re-reading `next-item.js`'s output
  after any edit that touches an entry already carrying fields, not just after adding new ones.

## Files to look at

- `docs/implementation-backlog.md` — the queue itself; 182 entries at handoff.
- `docs/agents/state/orchestrator.md` — rewritten in full as part of this handoff, not appended.
- `docs/agents/README.md` §3 — the lane-ownership rule (`Both → Lane A, engine half first`), needed
  for sweep 3.
- `scripts/check-backlog-pointers.js` / `scripts/next-item.js` — read their own source before
  trusting their output blindly; both have caught real mistakes this session and both have
  peculiarities (the `Needs:`-absent-target-means-shipped rule, the prose-marker sensitivity above).

## Open questions / blockers

- **Q-549** — needs the owner to read two numbers off the Railway console (steady-state RAM after
  a full day, whether `max_connections` is adjustable) whenever convenient. Not urgent.
- **PR #351** (merged) — self-configures on deploy; the only remaining check is that the next
  `error_events`/DB-size read at a future session start returns real rows rather than empty ones.
  If empty, the fallback `ALTER ROLE claude_readonly SET app.claude_ro_owner = '<uuid>'` (in the PR
  body) fixes it without a redeploy.
- **PR #355** (merged) — a nutrition-tab layout change; needs one on-device look to confirm the
  new order (meals → finish-logging → Supplements → End of Day).
- **PR #265** — still open, still correctly marked "do not merge yet" by its own author. No action
  needed; noted here only so a future session doesn't read it as stalled.

## Pickup prompt

```
Set this session's title to `🪐 Orchestrator 🟢` — exactly, emoji included. (Leading emoji is the
role, trailing is this session's own status — the previous session flipped its title to
`🪐 Orchestrator 🔴` as its last act specifically so you don't confuse the two in the session list.)

Read, in this order:
1. docs/agents/state/orchestrator.md — your baton, rewritten in full by the previous session.
2. docs/handoff-2026-08-24-platform-orchestrator-first-run.md — that session's full record:
   what it did, the decisions it walked the owner through, what it deliberately left, and the
   gotchas it hit (a shallow-clone merge trap, a squash-merge diff artifact, a backlog conflict
   that looked like an ID collision and wasn't).
3. docs/agents/README.md §3 — the lane contract, needed before touching sweep 3.
4. node scripts/check-backlog-pointers.js and node scripts/next-item.js — the queue as it
   actually stands right now, not as described above (other lanes are working concurrently).

Orient fully against those four, and against the current state of docs/implementation-backlog.md,
projectOverview.md, and any open PRs — but do NOT start a sweep, make any edits, open any PR, or
answer any owner question on your own initiative. The owner has follow-up instructions coming and
wants you oriented and ready, not mid-task. Reply with a short summary of what you found — the
queue's current state, what's changed since the handoff was written, and anything that looks like
it needs attention — and then wait.
```

