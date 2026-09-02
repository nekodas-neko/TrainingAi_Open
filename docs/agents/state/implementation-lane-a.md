# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-09-02 · **By:** the fourteenth session to run as Lane A · **Next ID:** `LA-55`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line.
`LA-54` was allocated and **withdrawn** — see Gotchas — so it is used, not free.)
**Migrations:** directory head **255**, next free **256** — claim against open PRs too, not just the
directory. Local SQLite **v34**.

## Now

**Ten PRs merged:** #775 (red-`main` fix), #781 (BF-69 stage 1), #770 (LB-37), #777 (LB-31),
#785 (queue hygiene), #786 (LB-48), #788 (LB-49 + journal ceiling), #791 (LB-50 prompt half),
#792 (BF-77 gate), #794 (LB-18 source). Full handoff:
[`docs/handoff-2026-09-02-nutrition-lane-a-session.md`](../../handoff-2026-09-02-nutrition-lane-a-session.md).

Start with `node scripts/next-item.js --lane A` and read its real output. **LA-47 should head it.**

## ⚠ Read this before building anything

**Six of the eight entries examined on 2026-09-02 were wrong about something load-bearing.** Not
stale — wrong at filing time. A function name that does not exist, a severity that does not
reproduce, a migration that was already built four months ago.

**The shape is consistent: line numbers have been accurate every time; names, conclusions and
"this needs a schema change" have not.** LB-49 cited three correct line numbers inside a function
whose name does not exist.

**So: grep the symbol, then grep its callers, then decide.** It costs two minutes and it removed a
whole migration from LB-18. The four-line fixes in this session are four lines *because* of it.

Another session hit the same class independently in #789 (a self-contradicting entry, two misfiled
lanes, a corrected sample size). It is a pattern worth raising with Orchestrator, not six
coincidences.

## What is startable, and what is not

- **LA-47** — the Coach plan widget, and the entry is right that it is **one change across two
  lanes**. `widget-registry.tsx` narrows by early return, so a new union member is a type error
  until a branch handles it; a branch rendering `null` **wedges the whole thread**, because the
  provider refuses a request containing an unanswered tool call. Design is settled in the entry.
  Take it under "Both → Lane A, engine half first".
- **Q-388, Q-289, Q-290, Q-275, Q-272** — the Tuning calibration block, owner-gated.
- **BF-77** — now correctly parked (`Gate: owner`, added #792). Needs the A-or-B choice: finish
  BF-57's QR path, or build a server-stored share code.

## Keeps a successor must read before touching the area

- **BF-69 stage 1 shipped; stages 2–4 are owed, and stage 2 gates the rest.** Nothing can write a
  dose amount yet — production holds 2 supplements and 1 log ever — so the trends overlay (stage 4)
  stays `Gate: data`. **`loggedToday` deliberately tracks the MANUAL contribution only**; a meal's
  dose turning it on would leave a control that refuses to turn off.
- **LB-18's source shipped; Lane B drops the query param.** Its claim that recency needs a schema
  change is false and the entry now says so.
- **LB-50's prompt half shipped; the exposed activity factor is owed**, and it needs the
  not-enough-data state the maintenance figure already has.

## Not device-verified (both have Known-Issues rows)

- **Local SQLite v34 rebuilds `supplement_logs`** — the first local migration here that creates,
  copies, drops and renames rather than adding a column. SQLite cannot drop an inline table
  constraint. Written so any prefix re-runs to completion; **read the comment before touching it.**
- **`getRecentFoodItems`** — `getLocalStore` returns null under vitest and in the web sandbox.

## Gotchas that cost time this session

- **`get_check_runs` returning `total_count: 0` was a STALE BASE every single time** — never slow
  CI. Confirm with `git merge-base --is-ancestor origin/main origin/<branch>`, re-merge, push.
- **A stale local `origin/main` looks exactly like a lost edit.** Fetch before believing anything
  vanished.
- **Expect a 405 merge conflict on nearly every PR** — `projectOverview.md`,
  `doc-size-baseline-history.md` and the two `.size` files. After resolving, verify
  `grep -c '\*\*Version:\*\*' projectOverview.md` is **1**; keeping both sides leaves two headers
  and only the first is true.
- **Guards find their own documentation.** Twice more this session. Strip comments before scanning;
  exempt by name with an assertion that the exemption is real.
- **I filed LA-54 and withdrew it** — a checker-gap entry resting on LB-48's false severity. Filing
  on an undemonstrated premise is the same failure as the entries above, and it is easy to do while
  correcting someone else's.

## The journal ceiling

Raised **250 → 320** (#788), owner-approved after being surfaced as a blocker: `main` had reached
250 and every agent's next PR would have failed CI. The check's *other* guard — **unlinked** entries,
the ones a sweep can fold — read **3 of 60**. The real compaction (folding *linked* entries,
repointing durable docs) is still owed and still Orchestrator's. **Reversal is one number in
`docs/doc-size-baseline.json`; the signal to do the real work instead of raising it again is the
floor rising from something other than journal citations.**
