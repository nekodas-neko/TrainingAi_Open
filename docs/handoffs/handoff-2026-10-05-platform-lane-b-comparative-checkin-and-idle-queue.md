# Handoff — 2026-10-05 · Lane B: the comparative check-in, then an empty queue

_Domain: `platform` (also touches `readiness`, `app-shell`, `nutrition`) · Branch: `docs/lane-b-session-close` · PR: open, docs-only_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/agents/state/implementation-lane-b.md` (the baton —
> it carries state; this file carries the narrative). This covers one Lane B session:
> 2026-09-30 through 2026-10-05.

## Goal

Work `docs/implementation-backlog.md` top-down as Implementation Lane B. The session ended up doing
two unrelated things: it rebuilt the morning check-in's comparative control, and then it spent four
days with nothing startable and had to establish that the emptiness was real rather than a stall.

## Current status

- **Build/test:** last implementation PR was #2031 (2026-10-01). Everything merged green on all five
  required checks. `pnpm check:rules` ran **86 of 86** on each. This wrap-up PR is docs-only.
- **Device-verified:** no. Nothing this session was seen on the S25. The comparative control's
  behaviour was measured end-to-end against local Postgres (a real Save stored
  `vs_normal='same', vs_question=2`) but never on the APK, and the Samsung WebView, safe-area and
  offline paths were not exercised at all.
- **Queue:** `node scripts/next-item.js --lane B` → **READY 0**, re-checked 2026-10-05 against a
  `main` that had moved twenty PRs (#2028 → #2048). KEEP is **47**.

## What shipped

| PR | what |
|----|------|
| #2023 | Two e2e specs that my own `RV-208` ⑤ brand reorder had left asserting a retired string. They were red for four PRs before anyone noticed. |
| #2026 | `LB-191` — the morning check-in's comparative control opens on the neutral *"About the same"*. `VS_NORMAL_DEFAULT` lives in `components/checkin/vs-normal-picker.tsx`, beside the option list that defines the labels. |
| #2027 | `OR-206` — the prompt became *"Compared to normal"* and `CURRENT_VS_QUESTION` flipped to `.NORMAL` **in the same commit**. |
| #2028 | Cleared the Lane B queue head: `OR-167` decided without code (the owner keeps both icon libraries), `BF-183` routed to Lane A as `LB-199`. |
| #2029, #2030 | Linked and then resolved the three entries that were separately tracking one browser crash; named `LB-106`'s cause from its own log. |
| #2031 | Refreshed `OR-174`'s branch count and corrected a baton line that had gone stale between two of my own PRs. |

Earlier same-day work is in `docs/overview/entries/2026-09-30-*.md`.

## The one rule this session produced

**The prompt on screen and the marker stamped on the row move together, forever.** `vs_question`
records which wording an answer replied to (1 = *compared to yesterday*, 2 = *compared to normal*).
A screen asking one question while rows record the other mislabels every row in between, silently,
and nothing downstream can detect it. `components/checkin/__tests__/tn58-vs-normal-control.test.ts`
asserts the pair: it reads the picker's own text and fails if `CURRENT_VS_QUESTION` disagrees.

## Deliberately NOT done

- **The seeded neutral is an unmarked second boundary and I did not mark it.** With a value seeded,
  dismissing the sheet is the only thing separating "did not answer" from "about the same" — there is
  no column default and the row writes solely on Save. That wants a `vs_normal_touched` flag, which is
  Lane A's: filed as **`LB-198`**.
- **47 KEEP residues left alone.** Every one is shipped work owed a device look. Building on top of
  them without the look is how a residue becomes two.
- **47 sweepable remote branches left in place.** `OR-174`'s own lane, and its first attempt was
  wrong about four of them. The git proxy also refuses the remote deletes.
- **The stranded PRs were not touched.** Four un-mergeable PRs sat mid-flight, three of them
  owner-approved since 2026-09-28. None were mine, so the ceiling was review, not merge. The
  Orchestrator rescued them on 2026-10-05 (`OR-207`, #2038) and #1847, #1849 and #1902 have landed.

## Gotchas / what did NOT work

- **A mid-flight rename collided with an open green PR.** Lane A's #2025 renamed
  `vs_yesterday` → `vs_normal` after #2026 was already green; GitHub marked it `dirty` and
  auto-merge correctly refused to fire. Taking the rename everywhere and keeping my own behaviour was
  the fix. Expect this: a green check goes stale while you work.
- **A backlog conflict was a deletion against a modification, not two deletions.** `main` had
  *deleted* the shipped `LB-190`; my branch had *modified* it. Keeping both sides would have
  resurrected a finished entry — the documented three-time trap. Read the headings before choosing.
- **Gating with unmerged paths in the tree gives false failures.** `check-bare-api-fetch` reported
  `morning-checkin-sheet.tsx: 3 bare /api/ GET(s), baseline 1` against one real GET, because
  `git ls-files` emits an unmerged path once per stage. `git add` the resolution first, then gate.
- **Never restore a conflicted file from `HEAD`.** `git stash` refused mid-merge, my `&&` chain
  carried on, and `git checkout HEAD -- <file>` then restored the *pre-merge* side — silently
  discarding one file's conflict resolution. Re-derive from `git show origin/main:<path>` instead.
- **Two cheap-lookup failures, inverted.** `LB-149`: I wrote up `SEGV_MAPERR 0000000001b0` as a new
  witness without grepping the backlog — `LB-56` had the same fault address six times since
  2026-09-09. `LB-106`: the cause was in the entry's own log and had been dismissed as runner
  instability. Both were expensive reasoning next to a lookup I skipped. Both corrected in place.

## Files to look at

- `components/checkin/vs-normal-picker.tsx` — the option list and `VS_NORMAL_DEFAULT`.
- `components/morning-checkin-sheet.tsx` — seeds from the constant on mount and on close, but the
  restore path uses `?? null` on purpose: a stored NULL is either a cleared answer or a pre-seed row,
  and re-seeding the neutral over it shows the owner's screen agreeing with itself.
- `packages/shared/src/types/day-checkin.ts` — `VS_QUESTION` and `CURRENT_VS_QUESTION`, the single
  switch. Lane A's file.
- `docs/device-sweep-5-plan.md` — **the unblock for this lane.** Six sittings, failure-first, and it
  already covers fifteen of Lane B's owed looks: `BF-204`, `BF-206`, `BF-208`, `LB-5`, `LB-53`,
  `LB-61`, `LB-129`, `LB-162`, `OR-162`, `RV-114`, `RV-115`, `RV-208`, `RV-209`, `RV-210`, `TN-85`.

## Open questions / blockers

- **Nothing is waiting on an answer from the owner from this lane.** `LB-197` (check-in pills wrap at
  384 px) sits in `Lane: O` at rank 61 as a cosmetic call.
- **READY 0 is the state, not a fault.** Three head items resolved three different ways on
  2026-09-30 and nothing refilled behind them. Lane A had 41 READY at the time, so an idle Lane B was
  worth reporting rather than filling. Do not un-park anything to manufacture a queue item.
- **The lane's own silence from 2026-10-01 to 10-05 has two causes and they should not be
  conflated.** Lane B was idle because its queue was empty. The repo-wide stall recorded in #2032
  (every lane stopped, commit rate from ~113/day to zero) is a separate thing that happened to
  overlap. The repo unstuck on 2026-10-05.

## Pickup prompt

```
You are the standing Implementation Agent (B) for nekodas-neko/TrainingAi_Open. Your session
title is `🚧 Implementation Agent (B) 🟢` — set it before anything else via get_session with
session_id omitted, then set_session_title.

Read in this order:
  1. CLAUDE.md (standing instructions, the lane split, the branch-name rule)
  2. docs/agents/README.md (the contract between the seven agents)
  3. docs/agents/state/implementation-lane-b.md (your baton — state, next ID, lessons)
  4. projectOverview.md (status + the live Known Issues tables)
  5. docs/handoffs/handoff-2026-10-05-platform-lane-b-comparative-checkin-and-idle-queue.md
     (the previous session's narrative — this file)

Then run the three production reads in docs/session-start-reads.md.

First concrete action: `node scripts/next-item.js --lane B`. Do not hand-scan the backlog and do
not trust any count in a doc — the tool owns the question.

  - If READY > 0: take the top entry, re-verify the plan against current main before building
    (plans go stale in the queue), implement, gate, and fold the journal entry +
    projectOverview.md update + backlog removal + version/changelog bump + baton rewrite into the
    SAME PR. Re-merge origin/main immediately before opening it, then enable auto-merge right
    after opening — it refuses on an already-green PR.
  - If READY is 0: that was the state for the five days to 2026-10-05 and it is real, not a
    stall. Do not un-park anything and do not invent work. The productive move is reconciling the
    KEEP list (47 entries, all shipped work owed a device look) — reading a residue against the
    code and either narrowing it or confirming the look is genuinely the only thing left. Report
    the idle lane rather than filling it.

Constraints you would otherwise rediscover:
  - The word `claude` NEVER appears in a branch name (owner, 2026-09-27). Use fix/ feat/ docs/
    chore/ bugfix/ security/ issue/ request/.
  - Never merge a PR we did not author. The ceiling is review, comment, approve.
  - Lane B owns app/** (except app/api/**), components/**, app/globals.css, lib/hooks/**,
    lib/stores/**. Anything reached by app/api/** or touching storage is Lane A's, including
    every migration number and local SQLite version.
  - pnpm check:rules is the custom-rules gate. Quote its `Ran N of N` count, never the word
    "pass". It was 86 of 86 on 2026-10-01.
  - Nothing this lane shipped since 2026-09-26 has been seen on the S25. Device sweep 5
    (docs/device-sweep-5-plan.md) is planned and covers fifteen of Lane B's owed looks; it is the
    unblock for most of the KEEP list.
  - The morning check-in's prompt and its vs_question marker move together, forever. The guard is
    components/checkin/__tests__/tn58-vs-normal-control.test.ts. The seeded neutral was the
    owner's explicit call against the recommendation — settled, do not re-propose.
```
