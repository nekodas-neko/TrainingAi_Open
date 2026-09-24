# 2026-09-24 — the Orchestrator's job is the owner-gated queue

Orchestrator. Docs-only. Branch `chore/or-143-process-owner-gate-triage`.

The owner set the process out explicitly. Recorded here because a role definition that lives only in
a chat is a role definition the next session does not have.

## The process, as he stated it

- **BugFix** is the intake. Reports arrive from him directly, **and it reads the app's feedback
  feature** so a user-reported error lands the same way a spoken one does. It files and lanes them.
- **Review** sweeps on its own, **or commissions a sweep** — handing the device agent a question and
  reading the answer back.
- **Orchestrator** reorganises, cleans and aggregates the backlog. **Its main job is the entries that
  need his input**: work out which genuinely do, put those to him, and **assign to a lane once
  unblocked**.
- **DV, Tuning, Lane A and Lane B** are unchanged.

**One ownership move:** the in-app feedback read shipped as the Orchestrator's in `#1486`. It is
BugFix's now — a report is intake, and intake is BugFix's. The Orchestrator keeps the read as a
backstop for when BugFix is not running rather than as the owner of it.

## First triage pass: 78 entries carry `Gate: owner`

By lane: **65 Lane A, 7 O, 6 B**. Read in one pass; the shape is what matters before the detail.

**Roughly 29 are scoring or calibration** — `expectedRpe`'s dead band, ACWR's windows, the Zone 2
floor, resilience, chronic stress, the Body Battery charge window, 1RM's non-monotonicity. These are
genuinely his by CLAUDE.md's rule, **but they should not reach him as bare gates**: Tuning proposes a
calibration with the number of other days it moves, and he signs off on that. A gate with no proposal
attached is a question he cannot answer.

**Roughly 25 are engineering calls wearing an owner gate** — a missing unique key, a route with no
callers, a dead column, an AI call with no data gate. Those are mine to decide under the standing
narrowing, not his.

**Three are already answered or deferred and should not be re-asked:**
- **`Q-547`** says so in its own field: *"Gate: owner — a READING, not a decision."* It wants a
  Railway CPU/RAM sample during a quiet window, and it feeds `Q-551` rather than asking anything.
- **`BF-106`** is *acknowledged and deferred* by him, 2026-09-15, deliberately still gated because
  `VACUUM FULL` cannot run from the app.
- **`Q-297`**'s first residue is done.

**The rest are genuine product preferences** — sharing meals with a partner, the cat collection's
art, battery chips on Home, an Apple HealthKit connector, the admin surface's unused buttons.

## What goes to him first, and why it is one question

`LB-52` and `Q-297`'s second residue were already batched as **`owner-branch-protection`** (OR-117,
2026-09-16): *"the same settings page … one trip, two toggles. Do not put them to the owner
separately."* That batching was right and this pass did not improve on it — it surfaced it.

It is also the highest-value thing on the list, for a reason this session demonstrated rather than
argued: **auto-merge does not work on this repo**, so every merge is hand-caught against a base that
moves every few minutes. One PR tonight lost **five** merge races; another lost two and had to be
split onto a zero-conflict branch to land at all.

## Not done

- **74 of the 78 are untriaged in detail.** The pass above is a shape, not a verdict on each entry,
  and it is deliberately labelled that way — an estimate of "how many are really his" was wrong by a
  factor of twenty-five earlier in this session, so the number stays a shape until each is read.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps, 814 test files passed.
