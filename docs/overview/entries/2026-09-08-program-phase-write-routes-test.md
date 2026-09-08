# 2026-09-08 — the two writes that reshape a running program (PS-39, 47 → 45)

**Branch:** `test/program-phase-write-routes` · **No product change.**

14 cases over `confirm-early-deload` and `phase-sets/clone`. Batched because both take a
client-supplied id and decide, from the user's own data, whether it may be acted on — and they
answer that question in two different and both-correct ways.

## What the cases decide

- **`confirm-early-deload` refuses a non-active program with 403, not 404.** The caller can already
  tell which of their programs is active, so there is nothing to conceal and "you may not deload a
  program you are not running" is the useful answer.
- **It checks for an active program FIRST**, so a user with none gets 400. A 403 there would send
  someone looking for a permissions problem they do not have — you cannot be told an id is not the
  active program when no program is active.
- **`phase-sets/clone` proves ownership by construction**, not by a check: the source is found
  inside `listPhaseSets(userId)`, so someone else's set is simply absent. No branch to forget, and
  no id oracle.
- **The `overrides` map is keyed on the SOURCE position**, which stops being the cloned position the
  moment `includeBaseline` shifts everything by one. Reading the shifted number would apply each
  override to its neighbour.
- The deload week is the user's today, and **the zone is threaded to the repository too** — the
  write needs it to resolve the week, not just the day.

## The fixture trap, in a new form

The 404 case originally mocked `listPhaseSets` to return an **empty list**. That makes "this id is
not yours" and "you own nothing" the same fixture — so a route that quietly fell back to
`phaseSets[0]` would still answer 404 and the test would pass. The mutation pass proved it: the
fallback survived.

The case now has the caller owning a *different* phase set, where a fallback clones the wrong one
and is visible; a second case covers the genuinely-empty list separately. This is the same shape as
the earlier traps — **when two situations produce the same observation, nothing that distinguishes
them is under test** — reached this time through an empty collection rather than through two equal
values.

## Mutation pass

**17 of 18 caught**, after that fix. The survivor is an equivalent mutant planted as a control — a
no-op TypeScript cast.

## Not exercised

The repository is mocked, so neither the deload's week arithmetic nor the clone's insert is run
against a database; what is pinned is which arguments reach them. Web/Node only — no device, no
native, safe-area, gesture or notification surface.
