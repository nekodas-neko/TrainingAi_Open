# 2026-08-13 — the resolved Known Issues move out of the orientation read (Q-220 Lever 1)

**Branch:** `claude/trainingai-backlog-v0abea`

53 fully-resolved entries (1,092 lines) moved from `projectOverview.md`'s Known Issues section to
[`docs/overview/known-issues-resolved.md`](../known-issues-resolved.md), and `CLAUDE.md`'s Session
Wrap-Up gained the rule that keeps it true: **striking a Known Issue means moving it to the archive,
not marking it ✅ in place.**

`projectOverview.md` is **9,184 → 8,105 lines, 748 KB → 668 KB (−11.7%)**. Every session reads it
before it can start, so that is ~20k tokens off the price of every session from here.

## Re-measured before starting, and the entry had aged in three days

Q-220 was filed 2026-08-10. Against `main` today:

| | filed | measured today |
|---|---|---|
| `CLAUDE.md` | 918 lines | 927 |
| `projectOverview.md` | 8,068 lines / 669 KB | **9,184 / 748 KB** |
| Known Issues section | 5,821 lines (72%) | 6,277 (68%) |
| entries | 267 (63 resolved / 204 open) | **279 (72 / 207)** |

It grew **~370 lines a day** while sitting in the queue, which is the argument for Lever 2 rather
than against Lever 1.

## 11.7%, not the 17% the entry predicted — and the gap is the finding

Of the 72 ✅-marked entries, **19 still had something owed** and stayed:

- the sign-out wipe that is **still not device-verified** — the very check the current handoff is
  chasing, because `clearLocalStoreData()` is a no-op in the browser so it has never executed
  anywhere;
- a triage entry with **2 real findings still blocked**;
- the DB index bloat with a **WAL restart still owed**;
- a review with **4 findings QUEUED** next to its 4 shipped CI rules;
- nine fixes marked **NOT verified on device**, and the rest similar.

A sweep keyed on the ✅ alone would have archived all 72 and taken the sign-out check with it. The
rule that shipped in `CLAUDE.md` is therefore not "archive what is ticked" but **"archive only when
nothing is still owed"** — a fix that shipped but is not device-verified stays, because that check
is the outstanding thing.

## Conservation was proved, not asserted

A move that quietly drops an entry is the failure mode worth ruling out, so it was:

- **885 non-blank lines removed, 885 archived — identical, and in order.**
- **Zero lines in the new `projectOverview.md` that were not in the original** (nothing was reworded
  on the way past).
- **284 headings before → 231 after + 53 archived.**

Whitespace is the only difference: joining the moved blocks drops one blank line that had separated
a moved entry from a kept one.

## Two things found on the way

- **A stale claim inside an archived entry.** The data-collection gap sweep says "a per-column
  null-rate sweep is the natural follow-up and has not been run" — it ran the same day, and its
  result is the entry three headings below it. Corrected in place with a dated note rather than
  silently rewritten.
- **20 links broke on the move and the CI rule caught them.** They were root-relative, which is
  correct from `projectOverview.md` and wrong from `docs/overview/`. Rewritten by *resolution* —
  compute the relative path for any link that fails from the new location and resolves from the repo
  root — rather than by pattern, so none could be missed. `check-doc-links` goes from 20 broken to
  OK across 1,007 files.

## Verified

`pnpm check:rules` 33 of 33. `check-doc-links` clean. No code changed — this is documentation only,
so there is no test, dev-server or device surface to exercise, and no version bump.

## What is left of Q-220

**Lever 2 is the one that changes the number** and is untouched: 207 open entries, ~6,000 lines,
still in `projectOverview.md`, to be routed into `docs/domains/<pillar>/known-issues.md`. Its real
cost is the multi-tag visibility problem — an entry tagged `[platform][sleep]` must not become
invisible to a platform session. Lever 3 (capping entry length) stays a habit, not a PR. The
`CLAUDE.md` split stays gated behind Lever 2 proving the domain docs get read.
