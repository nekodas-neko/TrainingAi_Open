# 2026-08-24 — a resurrected backlog entry, caught by a check this time

**Branch:** `fix/backlog-resurrection-check` · **Lane A** · docs + one checker script.

## The third occurrence

`docs/implementation-backlog.md` conflicts are almost always **two deletions** — each PR removes the
entry it finished, so when two land together the markers wrap *different* completed entries and
"keep both" restores both.

- **2026-08-23:** LB-4, Q-454, Q-455 and Q-465 came back after shipping. Removed in **#348**, which
  also wrote the rule into `CLAUDE.md`.
- **2026-08-24:** **LB-4 came back again**, four commits later, in **#349** — a branch cut before
  #348 landed.

A rule cannot reach a branch that predates it. That is an argument for a check, not against the rule.

## What made it checkable

All three resurrections restored **a heading with nothing under it**. A real entry always carries a
`Branch:` or `Added:` bullet; a bare heading followed by the next heading is not an entry anyone
wrote. So there are no false positives to weigh, and `check-backlog-pointers.js` now fails on it.

**Verified against the actual file on `main`**, not a synthetic case: it rejects it with exit 1 and
names LB-4, and returns 0 once the orphan heading is removed.

## What it deliberately does not catch

A resurrection that restores a *full* entry still passes. Two stronger checks were considered:

- **"Flag a queue id that also has a journal entry."** Already measured and rejected in `CLAUDE.md`:
  25 ids sit in both today and most are legitimate — an entry that shipped half its work stays queued
  with a `Keep:` line.
- **"Was this id ever deleted from the backlog on `main`?"** This is the precise signature and it
  wants git history. CI checks out at **depth 1** — the size ratchet already pays for a one-ref
  depth-1 fetch to compare file *content* — so answering it would mean a deepened fetch on every run,
  to catch a case that has not yet occurred.

Narrow and free beat general and speculative here. If the full-entry form ever lands, the deepened
fetch is the answer and this entry is the evidence for paying for it.

## Also: LB-7 has a second occurrence, and it is now blocking every lane

`e2e/recipe-url-to-meal.spec.ts` failed CI again — on **PR #363, a diff of test fixtures for a MET
table**, which no browser spec can see. A **different** assertion this time
(`:146 /from a 4-serve recipe/`, `element(s) not found`), on the first run **and** the retry.

That rules out a timing flake and rules out cross-worker interference —
`playwright.config.ts` is `workers: 1, fullyParallel: false`. What is left is **accumulated state**:
one worker in file order means ~50 specs share one database and one user, and this file runs near the
end. It is the one condition a local run cannot reproduce, and it explains a file that fails
*different* assertions on different runs while passing three runs in four.

Two reproduction attempts failed and are recorded in the entry so nobody repeats them: the file alone
(4 passed, twice) and `meal-label.spec.ts` → this file in order (7 passed). The untried one is the
whole suite in order against a fresh database.

## Verified

`check-backlog-pointers` 187 entries clean; `pnpm check:rules` 54 of 54.

**Failure surfaces NOT exercised:** nothing runtime is touched — this is a checker script and three
documentation files. The LB-7 finding is a diagnosis, not a fix; the spec is still failing
intermittently in CI and remains Lane B's.
