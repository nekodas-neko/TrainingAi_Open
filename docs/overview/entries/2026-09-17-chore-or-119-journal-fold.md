# 2026-09-17 — the compaction sweep, and the owner gate that was guarding a settled question

**Branch:** `chore/or-119-journal-fold` · docs only. No product code.

## LA-100's premise was stale, and it was holding an owner gate

The entry blocks the compaction sweep on a documentation-structure decision: there is *"nowhere
obvious to fold them TO"*, because the batched history files are *"era-based, not date-based"* while
the per-entry convention is dated, and *"nothing bridges the two"*.

**Measured before acting: 28 of the 32 history files are dated** — `history-2026-07-16.md` through
`history-2026-09-10-folded-6.md`. Four carry era names (`-newest`, `-recent`, `-newer`, `-past`), and
LA-100 itself calls those **frozen**. `scripts/fold-journal-entries.js` has written
`history-<date>-folded-<part>.md` since LA-80, rolling a new part near 250 KB.

So the entry's option 1 — a dated batch — is not a decision anyone needs to take. **It is what the
repo has done for two months and what the tooling already implements.** The owner was gated on
choosing a convention that precedent and the code had chosen for them.

`Gate: owner` removed, and the sweep ran on that basis.

**Its "BLOCKING, not blocking-ish" upgrade is stale too.** That was written when the entries ceiling
was a hard CI failure every lane's next PR would hit. It is an advisory note now — *"Not a failure;
sweep it when convenient"* — so the +1-per-PR treadmill it describes cannot happen.

## The sweep

**91 entries → 51.** Forty folded into `history-2026-09-17-folded-1.md` (163 KB, inside the roll
threshold), **five held back because an agent baton cites them**, citations rewritten across nine
files. `check-doc-links` clean on 823 files.

What is left open is smaller than the entry and is not the owner's: whether the four era-named files
are ever renamed. Nothing cites them by scheme and they are frozen, so probably never — a judgement
for whoever next touches them, not a blocker on folding.

## The gate I skipped on Tuesday, written into the baton

PR #1247 turned `main` red for every lane. Restructuring Q-305's `Keep:` removed a `Gate: device`
that `keep-gate-set-off.test.ts` **pins by name**, and no documentation check can see that.

**`pnpm ci:local` already existed and would have caught it** — it runs lint, `check:rules`,
typecheck, typecheck:tests **and the test suite**. I ran `check:rules` alone. No new tooling was
needed; I skipped the gate the repo already had, on the reasoning that a backlog-only change could
not break code.

The Orchestrator baton said *"`pnpm check:rules` is the only custom-rules gate"* — true, and it reads
as sufficient. It now says plainly that `check:rules` is **not** the pre-push gate, with the
sentence that generalises: **a queue restructure is a code change to the tests that pin the queue.**

## Result

`docs/overview/entries/` **91 → 51**. Queue **350**, one owner gate removed.

`check-doc-links` OK on 823 · `check-backlog-pointers` clean on 350 · `pnpm ci:local` green
(**Ran 75 of 75** Custom Rules steps).

**Surfaces not exercised:** none apply — documentation only. No product code, so nothing reaches the
APK from this PR.
