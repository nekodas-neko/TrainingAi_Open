# Handoff — 2026-10-05 · BugFix intake: the prescription cluster, and four reads that outlived the session

_Domain: `workouts` (also touches `platform`, `devices`) · Branch: `chore/bugfix-session-wrapup` · PR: see below_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/workouts/README.md`, then `docs/implementation-backlog.md` (the queue).
> This file covers only what *this* session did and what it leaves behind.

## Goal

BugFix intake for a run of owner reports on the pre-workout and in-workout screens, plus the daily
inbound-GitHub watch and the session-start production reads. Intake files; it does not write
product code.

## Current status

- **Build/test:** docs-only throughout. `pnpm check:rules` run on every PR (83 of 83, then 84 of 84
  once a rule was added); `check-backlog-pointers` and `check-doc-index-size` exit 0. **`pnpm dev`
  was never run and no product code was changed by this session.**
- **Device-verified:** nothing by this session. Two findings were confirmed *by the owner on his own
  phone* — the `Full`-toggle workaround and that `Quick` returns one exercise — and those are the
  only on-device observations here.

## What shipped

| PR | What |
|---|---|
| #1936 | **BF-217** — 9 of 25 exercises in the active program have no progression style, `Lower` all five; dated the losses from `exercise_logs`. Since **shipped** (#1937). |
| #1940 | **BF-219** (`Lane: T`) 13.75 kg returned RPE 10 three times with reps falling 9→6; **BF-220** nothing in a live session consults RPE. BF-220 **shipped** (#1993). |
| #1942 | **BF-221** — the accessory rep band is advice to the model and a constraint on nothing. **Shipped** (#1999). |
| #1948, #2006 | Inbound-watch corrections; `BF-212`/`BF-213` removed once their PRs merged. **BF-224** filed. |
| #1955 | **BF-222** / **BF-223** from the database read, plus the `CLAUDE.md` growth-figure correction. |

## ⚠ One entry was LOST for a week, and this session recovered it

**BF-218** (`Quick` returns one exercise) was written 2026-09-28 and **never reached `main`.** Its
commit `68277da67` is timestamped **21:31:17Z**; PR #1936 had already **auto-merged at 21:28:44Z**.
The push landed on a branch whose PR was closed and whose head was auto-deleted, so the entry — and
an `LA-178` amendment in the same commit — were invisible until this wrap-up went looking.

Both are restored in this PR, recovered verbatim from the surviving remote branch.

**The mechanism is worth internalising: `enable_pr_auto_merge` fires the moment the required checks
pass, so a second push to the same branch races the merge and loses.** Finish the diff before
arming auto-merge, or open a second PR for the follow-up commit.

## Deliberately NOT done

- **No product code.** BugFix files; lanes build. Every recommendation here is a recommendation.
- **No comment posted on either inbound PR**, and nothing merged, closed or pushed on them — the
  ceiling on someone else's PR is review, comment, approve, and the owner was never asked.
- **BF-218's table was not re-measured** after `BF-221` shipped; the entry says so rather than
  quietly keeping numbers that may no longer reproduce.

## Key decisions (with rationale)

- **`BF-219` filed `Lane: T`, not `A`.** It is a load-selection calibration, and Tuning owes a
  proposal before anyone builds — scoring changes are the owner's to sign off.
- **`BF-220` recommended "offer, do not apply."** Reusing `computeRpeAdjustment` unchanged means the
  in-session suggestion and next week's prescription can never disagree; an automatic mid-session
  load change costs trust on the one screen that cannot afford it.
- **`BF-213` rewritten rather than appended to, twice.** It had grown three contradicting layers
  describing states that no longer existed. An entry about an inbound PR describes a moving object.
- **The `CLAUDE.md` database figure was replaced with a shape, not a new number.** It had been wrong
  three times (0.4 → 1.8 → 1.7 against a measured 2.56 MB/day).

## Gotchas / what did NOT work

- **A grep nearly published two false findings.** The Google-refresh-token scare on `#1607` died when
  the pinned package was read: `@auth/core@0.41.3` encrypts the JWT (`alg: "dir"`,
  `enc: "A256CBC-HS512"`), so the bearer token is opaque to its holder. Read the source, not memory.
- **`n_live_tup` read 135,306 against 148,811 real rows.** Use `count(*)`.
- **`session_exercises.updated_at` is useless for dating a loss** — all 25 rows read the same
  millisecond, because a program save rewrites every row.
- **A stored prescription outlives its fix.** `BF-198` shipped at 07:17 and the owner still hit the
  dead toggle at 07:13+ — his prescription was generated five days earlier and had a 7-day TTL.
  Changing the duration preset forces a regeneration; that is the workaround, and it worked.

## Files to look at

- `packages/shared/src/ai-periodization/time-budget.ts` — `dropToBudget`, BF-218's subject.
- `packages/shared/src/ai-periodization/autoregulation.ts` — the back-off/push rules behind BF-219.
- `lib/data/postgres/slices/oura.ts:566`, `:1070` — the two retention prunes of BF-222.
- `app/api/auth/exchange-mobile-token/route.ts` — the merged inbound auth change (BF-224).

## Open questions / blockers

- **BF-224** — the bearer token carries the session cookie's 7-day life and nothing revokes it before
  `exp`. Recommendation: a shorter expiry on the token branch. **Owner's call (auth).** Unchecked:
  whether any client already exchanges with `responseType: 'token'`, which decides whether that is
  free or breaking.
- **LA-178** — the duration double-count: fix it or leave it. Two of the owner's own answers point
  opposite ways; the restored BF-218 evidence is the sharpest case for fixing it.
- **BF-219** — awaiting a Tuning proposal.
- **BF-222** — two retention prunes fire for the first time around 2026-10-15 and 2026-12-19, and
  their failure path writes to stdout where nothing reads it.
- **BF-223** — a 7.2 MB index with zero lifetime scans; the drop is gated on the owner.

## Pickup prompt

```
You are the BugFix Intake Agent on nekodas-neko/TrainingAi_Open. Session title:
`🪲 BugFix Intake Agent 🟢`.

Read in this order: projectOverview.md → docs/agents/README.md → docs/domains/workouts/README.md →
docs/handoffs/handoff-2026-10-05-workouts-bugfix-intake-prescription-cluster.md.

Then run the three session-start production reads per docs/session-start-reads.md: error_events,
feedback_submissions (BugFix owns this one), and the database size. Every claude_ro view is
row-scoped to the owner, so a zero means "none of his", never "nobody's"; use count(*) rather than
n_live_tup for row counts. On the database read, compare against the SHAPE recorded in CLAUDE.md
(two retention horizons, ~300 MB plateau), not against a daily MB figure.

Your first concrete action after those reads: check whether BF-222's rr_intervals prune has fired.
Its 90-day horizon fell due around 2026-10-15, it had never run before, and its failure path writes
to stdout where nothing reads it. Query min(at) on claude_ro.rr_intervals — if it is still receding
past 90 days, the prune is not working and that is a live finding.

Constraints you would otherwise rediscover:
- You file entries; you never write product code. Lane A owns the engine, Lane B the surface.
- A question for the owner is an entry with `Lane: O` and NO `Gate:` field — Gate parks it.
- Scoring/calibration changes get `Lane: T` and owe a Tuning proposal first.
- Never merge, close, push to, or comment on a PR we did not author. Ask before any comment.
- Arm auto-merge only once your diff is finished: it fires the instant the required checks pass, and
  a later push to the same branch races it and is lost. That happened this session (BF-218).
- Verify with the tool that owns the question, never with a grep you wrote.
- The daily inbound GitHub watch fires ~22:56 UTC (trigger trig_01NqWJvqX1DegskXLgdvn26G); scope is
  issues and PRs we did not author only.

Waiting on the owner and not yours to decide: BF-224 (bearer-token expiry, auth), LA-178 (the
duration double-count), BF-223 (dropping a dead index on a live sensor table).
```
