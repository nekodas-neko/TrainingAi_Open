# 🪐 Orchestrator — baton

> **Successor sessions are titled `🪐 Orchestrator 🟢`** — exactly, emoji included. A renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-24 · **By:** the session that ran sweeps 1–2 and the first owner walkthrough ·
**Next ID:** `OR-1`

## Now

Nothing in flight. Full record:
[`handoff-2026-08-24-platform-orchestrator-first-run.md`](../../handoff-2026-08-24-platform-orchestrator-first-run.md)
— read it before this summary. Sweeps 1–2 done. This session then spent most of its time outside
the four sweeps: the owner asked to be walked through every `Gate: owner` entry, one at a time.
Seven got real answers; **two (Q-137, Q-393) needed no question — their own text had already
decided them and nobody had checked.** Read an entry fully before turning it into a question.

## Next — in this order

1. **Lane and readiness (sweep 3), now the priority.** `Lane: ?` grew **6 → 10** while this session
   worked (other lanes filing concurrently). Re-run `next-item.js --all` and resolve against §3.
2. **Docs against reality (sweep 4).** `Q-49` sits at 🔴 describing a public-repo migration that has
   already happened — needs the owner on what of Phase A remains. **3 of 85** device-verification
   rows carry no `needs:` tag, named by line in Q-254.
3. **Aggregation (sweep 2), continued.** One batch shipped and left the queue. Next axis: entries
   sharing one owner conversation, and `[nutrition]` now that Q-395's phased chain is a model.

## Do not re-litigate

- **Entry IDs are per-agent prefixes, not bands** (PR #254) — bands exhausted twice over.
- **The backlog is one file with one global order** — a per-pillar split destroys it.
- **The `/api/sync/pull` fan-out batching fix must not be built** — closed on a production read.
- **Heart rate has not made session RPE redundant for energy** (Q-420, owner correction) —
  `corr(avgBpm, mean set RPE) = +0.083` across 44 sessions. Combine, never override. The combining
  formula stays unpicked deliberately — it needs Q-422's fit, not a number chosen in chat.

## Gotchas worth carrying

- **The clone is shallow** — `git merge origin/main` fails `refusing to merge unrelated histories`
  past the boundary. Fix: `git fetch --deepen=300 origin main` first. Hit three times this session.
- **A squash-merged PR's own diff can show a whole file as "new"** — an internal merge-commit
  artifact, not data loss. Check what `main` actually contains before reacting to it.
- **A backlog conflict that looks like an ID collision may just be a stale base** — confirm with
  `git log --oneline origin/main -- <path>` before resolving, never on marker text alone.
- **Your own prose can defeat `next-item.js`** — a `⛔` in an entry's body parked an entry just
  unblocked. Re-check its output after editing a field-bearing entry, not only after adding one.
- **Confirm a completion claim against a merged diff or a production read, never the entry's own
  text** — ten of seventeen failed that in sweep 1; two "owner decisions" this session were already
  answered.
- **A blocker or a decision written as prose is neither** — convert to a field the moment it's found.
- **Archiving a Known Issue breaks its relative links**, and a heading naming a still-live ID trips
  the duplication check. `check:rules` catches both.
- **`total_count: 0` minutes after opening a PR is a stale base, not slow CI.**
