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

## A correction: my LB-7 diagnosis was wrong, and Lane B had already fixed it

`e2e/recipe-url-to-meal.spec.ts` failed CI again — on **PR #363, a diff of test fixtures for a MET
table**, which no browser spec can see. A different assertion this time
(`:146 /from a 4-serve recipe/`, `element(s) not found`), on the first run **and** the retry.

I reasoned from `playwright.config.ts` being `workers: 1, fullyParallel: false` to **accumulated
state across ~50 specs sharing one database**, and started writing that into the entry. It is wrong.

**Lane B found the real cause in #359, which merged at 00:25:36 UTC — two minutes after #363's run
began.** `public/sw-template.js` re-issues **every** `/api/` request with no method filter, so once
the service worker controls the page the request originates from the worker, and Playwright cannot
intercept service-worker fetches. The spec's `page.route` stub was therefore bypassed, the real
`POST /api/nutrition/scan` returned **400**, and the row fell into its could-not-resolve state —
where the host genuinely *is* the name. Whether the worker has taken control when the POST fires is a
race, which is why one run had three failures and one stubbed pass, why different assertions in the
same file fail on different runs, and why it passed locally every time. Fixed with
`test.use({ serviceWorkers: 'block' })`.

Two things worth keeping from this. **My original LB-7 entry pointed at a condition that was not
occurring** — the no-title fallback is real code, and it was not what fired — so chasing it would
have "fixed" the wrong thing; that is now written into the entry on `main`. And **#363 needed a
rebase, not a diagnosis**: its run predated the fix by two minutes. The merge conflict here is what
surfaced all of it, because resolving it meant reading `main`'s version rather than keeping my own.

## Verified

`check-backlog-pointers` 187 entries clean; `pnpm check:rules` 54 of 54.

**Failure surfaces NOT exercised:** nothing runtime is touched — this is a checker script and two
documentation files. The LB-7 work is Lane B's and already merged (#359); nothing about it is claimed
here beyond the correction above.
